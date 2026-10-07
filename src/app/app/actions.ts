"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { detailsToMediaRow, getMediaDetails } from "@/lib/tmdb";
import type { MediaType, ReactionValue } from "@/lib/types";

export interface ActionResult {
  error?: string;
}
export interface FormState {
  error?: string;
  message?: string;
}

function revalidateApp() {
  revalidatePath("/app", "layout");
}

/** Scores run from 1 to 10 with one decimal (6.7); returns undefined if out of range. */
function cleanScore(score: number | null): number | null | undefined {
  if (score === null) return null;
  if (!Number.isFinite(score) || score < 1 || score > 10) return undefined;
  return Math.round(score * 10) / 10;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return { supabase, user };
}

/** Add a TMDB title to a shared (groupId) or personal (null) list. */
export async function addToList(input: {
  tmdbId: number;
  mediaType: MediaType;
  groupId: string | null;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();

  const details = await getMediaDetails(input.mediaType, input.tmdbId);
  const { data: media, error: mediaError } = await supabase
    .from("media")
    .upsert(detailsToMediaRow(details), { onConflict: "tmdb_id,media_type" })
    .select("id")
    .single();

  if (mediaError || !media) {
    return { error: mediaError?.message ?? "Could not save this title." };
  }
  const mediaId = (media as { id: string }).id;

  let existing = supabase
    .from("list_items")
    .select("id, deleted_at")
    .eq("media_id", mediaId);
  existing = input.groupId
    ? existing.eq("group_id", input.groupId)
    : existing.is("group_id", null).eq("added_by", user.id);

  const { data: found } = await existing.maybeSingle();
  const prior = found as { id: string; deleted_at: string | null } | null;
  if (prior && !prior.deleted_at) {
    return { error: "It's already on this list." };
  }
  // Removed titles are only hidden, so re-adding one restores it with its ratings.
  if (prior) {
    const { error } = await supabase
      .from("list_items")
      .update({ deleted_at: null })
      .eq("id", prior.id);
    if (error) return { error: error.message };
    revalidateApp();
    return {};
  }

  const { error: insertError } = await supabase.from("list_items").insert({
    group_id: input.groupId,
    added_by: user.id,
    media_id: mediaId,
    status: "want",
  });
  if (insertError) return { error: insertError.message };

  revalidateApp();
  return {};
}

/** Hides a title from its list; it can be restored for 30 days. */
export async function removeListItem(itemId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("list_items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", itemId)
    .is("deleted_at", null);
  if (error) return { error: error.message };
  revalidateApp();
  return {};
}

export async function restoreListItem(itemId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("list_items")
    .update({ deleted_at: null })
    .eq("id", itemId);
  if (error) return { error: error.message };
  revalidateApp();
  return {};
}

export async function toggleWatched(
  itemId: string,
  watched: boolean,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("list_items")
    .update({
      status: watched ? "watched" : "want",
      watched_at: watched ? new Date().toISOString() : null,
    })
    .eq("id", itemId);
  if (error) return { error: error.message };
  revalidateApp();
  return {};
}

export async function setRating(
  itemId: string,
  score: number | null,
  comment: string | null,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const cleanComment = comment && comment.trim() ? comment.trim() : null;
  const cleanedScore = cleanScore(score);
  if (cleanedScore === undefined) {
    return { error: "Scores must be between 1 and 10." };
  }

  if (cleanedScore === null && !cleanComment) {
    const { error } = await supabase
      .from("ratings")
      .delete()
      .eq("list_item_id", itemId)
      .eq("user_id", user.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("ratings").upsert(
      {
        list_item_id: itemId,
        user_id: user.id,
        score: cleanedScore,
        comment: cleanComment,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "list_item_id,user_id" },
    );
    if (error) return { error: error.message };
  }

  revalidateApp();
  return {};
}

/** Toggle a like/dislike. Selecting the same value again clears it. */
export async function setReaction(
  itemId: string,
  value: ReactionValue,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();

  const { data: existing } = await supabase
    .from("reactions")
    .select("id,value")
    .eq("list_item_id", itemId)
    .eq("user_id", user.id)
    .maybeSingle();

  const current = existing as { id: string; value: ReactionValue } | null;

  if (current && current.value === value) {
    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("id", current.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("reactions")
      .upsert(
        { list_item_id: itemId, user_id: user.id, value },
        { onConflict: "list_item_id,user_id" },
      );
    if (error) return { error: error.message };
  }

  revalidateApp();
  return {};
}

/** Log that family members watched a family title together, optionally filling in their scores. */
export async function logWatchTogether(input: {
  itemId: string;
  watchedOn: string;
  viewers: { userId: string; score: number | null }[];
}): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const viewers = input.viewers.map((v) => ({
    user_id: v.userId,
    score: cleanScore(v.score),
  }));
  if (viewers.some((v) => v.score === undefined)) {
    return { error: "Scores must be between 1 and 10." };
  }
  // log_watch() checks membership, the date and the scores.
  const { error } = await supabase.rpc("log_watch", {
    p_item: input.itemId,
    p_watched_on: input.watchedOn,
    p_viewers: viewers,
  });
  if (error) return { error: error.message };
  revalidateApp();
  return {};
}

export async function skipRatingRequest(itemId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("watches")
    .update({ skipped_at: new Date().toISOString() })
    .eq("list_item_id", itemId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidateApp();
  return {};
}

/** "I wasn't there": removes the signed-in user from a title's watch records. */
export async function removeMeFromWatch(itemId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("watches")
    .delete()
    .eq("list_item_id", itemId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidateApp();
  return {};
}

export async function createGroupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Please enter a family name." };

  const { data, error } = await supabase.rpc("create_group", { p_name: name });
  if (error) return { error: error.message };

  revalidateApp();
  redirect(`/app/family/${(data as { id: string }).id}`);
}

export async function joinGroupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase } = await requireUser();
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Please enter an invite code." };

  const { data, error } = await supabase.rpc("join_group", {
    p_invite_code: code,
  });
  if (error) return { error: error.message };

  revalidateApp();
  redirect(`/app/family/${data as string}`);
}

export async function updateDisplayName(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("display_name") ?? "").trim();
  if (!name) return { error: "Name cannot be empty." };

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidateApp();
  return { message: "Saved." };
}

// Family settings: the database functions check that the caller is the owner.

export async function renameGroup(
  groupId: string,
  name: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("rename_group", {
    p_group: groupId,
    p_name: name,
  });
  if (error) return { error: error.message };
  revalidateApp();
  return {};
}

export async function regenerateInviteCode(
  groupId: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("regenerate_invite_code", {
    p_group: groupId,
  });
  if (error) return { error: error.message };
  revalidateApp();
  return {};
}

export async function removeMember(
  groupId: string,
  userId: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("remove_member", {
    p_group: groupId,
    p_user: userId,
  });
  if (error) return { error: error.message };
  revalidateApp();
  return {};
}

export async function leaveGroup(groupId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("leave_group", { p_group: groupId });
  if (error) return { error: error.message };
  revalidateApp();
  redirect("/app/groups");
}
