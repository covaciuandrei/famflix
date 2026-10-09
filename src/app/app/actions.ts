"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { putOnList } from "@/lib/list-add";
import { saveTitle } from "@/lib/save-title";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MediaType, ReactionValue } from "@/lib/types";
import { cleanScore, MAX_TEXT, saveOwnNote, tooLong } from "@/lib/watch-input";

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

/** Add a TMDB title to a shared (groupId) or personal (null) list. */
export async function addToList(input: {
  tmdbId: number;
  mediaType: MediaType;
  groupId: string | null;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();

  const saved = await saveTitle(user.id, input);
  if ("error" in saved) return { error: saved.error };

  const res = await putOnList(supabase, user.id, saved.id, input.groupId);
  if (res.error) return res;
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

/** Marks a title watched on My list from its page, adding it there (or restoring it) first. Returns the list item. */
export async function markWatched(input: {
  tmdbId: number;
  mediaType: MediaType;
}): Promise<ActionResult & { itemId?: string }> {
  const { supabase, user } = await requireUser();

  const saved = await saveTitle(user.id, input);
  if ("error" in saved) return { error: saved.error };

  const { data: found } = await supabase
    .from("list_items")
    .select("id")
    .eq("media_id", saved.id)
    .is("group_id", null)
    .eq("added_by", user.id)
    .maybeSingle();
  let itemId = (found as { id: string } | null)?.id;

  if (!itemId) {
    const { data, error } = await supabase
      .from("list_items")
      .insert({
        group_id: null,
        added_by: user.id,
        media_id: saved.id,
        status: "watched",
      })
      .select("id")
      .single();
    if (error || !data) {
      return { error: error?.message ?? "Couldn't save this title." };
    }
    itemId = (data as { id: string }).id;
  }

  // Also brings back a title that was removed from My list.
  const { error } = await supabase
    .from("list_items")
    .update({
      status: "watched",
      watched_at: new Date().toISOString(),
      deleted_at: null,
    })
    .eq("id", itemId);
  if (error) return { error: error.message };

  revalidateApp();
  return { itemId };
}

export async function setRating(
  itemId: string,
  score: number | null,
  comment: string | null,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const cleanComment = comment && comment.trim() ? comment.trim() : null;
  if (cleanComment && tooLong(cleanComment)) {
    return { error: `Notes can be at most ${MAX_TEXT} characters.` };
  }
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
  /** The signed-in user's own note, when they're among the viewers and changed it. */
  note?: string;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
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

  // Only your own note: nobody writes notes for the others, they add theirs when they're asked to rate.
  if (input.note !== undefined && input.viewers.some((v) => v.userId === user.id)) {
    const res = await saveOwnNote(supabase, input.itemId, user.id, input.note);
    if (res.error) return res;
  }

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

/** "I wasn't there": removes the signed-in user from a title's watch records, and any score filled in for them. */
export async function removeMeFromWatch(itemId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("watches")
    .delete()
    .eq("list_item_id", itemId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  const { error: ratingError } = await supabase
    .from("ratings")
    .delete()
    .eq("list_item_id", itemId)
    .eq("user_id", user.id)
    .neq("rated_by", user.id);
  if (ratingError) return { error: ratingError.message };
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
  if (tooLong(name)) {
    return { error: `Family names can be at most ${MAX_TEXT} characters.` };
  }

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
  // No family has that code (join_group returns null so that wrong guesses still count toward its limit).
  if (!data) return { error: "Invalid invite code." };

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
  if (tooLong(name)) {
    return { error: `Names can be at most ${MAX_TEXT} characters.` };
  }

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
  if (tooLong(name.trim())) {
    return { error: `Family names can be at most ${MAX_TEXT} characters.` };
  }
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

/**
 * Deletes the signed-in user's account and everything of theirs. The database first takes them out of each
 * family, so the others keep the family and its titles (before_profile_delete in db_init.sql).
 */
export async function deleteAccount(confirmation: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (confirmation.trim().toUpperCase() !== "DELETE") {
    return { error: "Type DELETE to confirm." };
  }
  const admin = createAdminClient();
  if (!admin) {
    return { error: "Couldn't delete your account right now. Please try again later." };
  }
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("Deleting an account failed:", error.message);
    return { error: "Couldn't delete your account right now. Please try again later." };
  }
  // The account is gone; this just clears the sign-in cookies.
  await supabase.auth.signOut().catch(() => {});
  redirect("/?deleted=1");
}
