"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { cardKey, moodParams, parseMood } from "@/lib/movie-night";
import { LIMITS, overRateLimit } from "@/lib/rate-limit";
import { saveTitle } from "@/lib/save-title";
import type { createClient } from "@/lib/supabase/server";
import type { MediaType } from "@/lib/types";

export interface ActionResult {
  error?: string;
}

/** Most titles sent to My list in one go. */
const MAX_BATCH = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts a solo stack: counts it against the person's limit, picks a seed and sends them to the stack. The seed is in
 * the address, so refreshing the page shows the same stack. Only returns when something is wrong.
 */
export async function startSoloStack(input: {
  genres: string[];
  series: boolean;
  count: number;
  max: number | null;
}): Promise<ActionResult> {
  const { user } = await requireUser();
  const mood = parseMood({
    genres: Array.isArray(input?.genres) ? input.genres.map(String) : [],
    series: input?.series === true ? "1" : "0",
    count: input?.count,
    max: input?.max,
  });
  const limited = await overRateLimit(user.id, LIMITS.deck);
  if (limited) return { error: limited };

  const params = moodParams(mood);
  params.set("seed", String(Math.floor(Math.random() * 2 ** 31)));
  redirect(`/app/movie-night/solo?${params}`);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The signed-in person's My list entry for a title, added (or brought back from removed) if it isn't there. */
async function ensureOnMyList(supabase: Supabase, userId: string, mediaId: string): Promise<string | null> {
  const find = () =>
    supabase
      .from("list_items")
      .select("id, deleted_at")
      .eq("media_id", mediaId)
      .is("group_id", null)
      .eq("added_by", userId)
      .maybeSingle();

  let { data: found } = await find();
  if (!found) {
    const { data: inserted, error } = await supabase
      .from("list_items")
      .insert({ group_id: null, added_by: userId, media_id: mediaId, status: "want" })
      .select("id")
      .single();
    if (inserted) return (inserted as { id: string }).id;
    // Added a moment ago from another tab: use that one.
    if (error) ({ data: found } = await find());
    if (!found) return null;
  }
  const entry = found as { id: string; deleted_at: string | null };
  if (entry.deleted_at) {
    const { error } = await supabase.from("list_items").update({ deleted_at: null }).eq("id", entry.id);
    if (error) return null;
  }
  return entry.id;
}

/**
 * Adds the titles someone swiped right (or loved) on a solo stack to My list; a title they loved also gets a thumbs up.
 * Returns the list item of each title that went in, so a later undo can take it back out. Stops at the first problem,
 * keeping what was already added. Doesn't refresh the page: the stack on screen must not change under their thumb.
 */
export async function addSwipedToMyList(
  items: { tmdbId: number; mediaType: MediaType; love: boolean }[],
): Promise<{ added: { key: string; itemId: string }[]; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH) {
    return { added: [], error: "Too many titles at once." };
  }

  const added: { key: string; itemId: string }[] = [];
  for (const item of items) {
    const saved = await saveTitle(user.id, { tmdbId: item?.tmdbId, mediaType: item?.mediaType });
    if ("error" in saved) return { added, error: saved.error };
    const itemId = await ensureOnMyList(supabase, user.id, saved.id);
    if (!itemId) return { added, error: "Couldn't add a title to My list. Please try again." };
    if (item.love === true) {
      await supabase
        .from("reactions")
        .upsert({ list_item_id: itemId, user_id: user.id, value: "like" }, { onConflict: "list_item_id,user_id" });
    }
    added.push({ key: cardKey({ mediaType: item.mediaType, tmdbId: item.tmdbId }), itemId });
  }
  return { added };
}

/** Takes titles back off My list after an undo (they are only hidden, so voting yes again brings them back). */
export async function removeSwipedFromMyList(itemIds: string[]): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > MAX_BATCH || !itemIds.every((id) => UUID.test(id))) {
    return { error: "That isn't a valid title." };
  }
  const { error } = await supabase
    .from("list_items")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", itemIds)
    .is("group_id", null)
    .eq("added_by", user.id)
    .is("deleted_at", null);
  return error ? { error: error.message } : {};
}
