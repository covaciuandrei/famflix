"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { LIMITS, overRateLimit } from "@/lib/rate-limit";
import { saveMedia } from "@/lib/save-media";
import { MAX_EPISODES, MAX_SEASON, parseSeriesInfo, sameSeries } from "@/lib/series";
import type { createClient } from "@/lib/supabase/server";
import { detailsToMediaRow, getMediaDetails } from "@/lib/tmdb";
import { cleanScore, isDay, MAX_TEXT, tooLong } from "@/lib/watch-input";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface EpisodeResult {
  error?: string;
  /** The series' entry on My list. */
  itemId?: string;
  /** Ticking finished the series (it has ended and every episode is ticked): it is Watched now. */
  completed?: boolean;
}

interface EpisodeRef {
  s: number;
  e: number;
}

const isRef = (value: unknown): value is EpisodeRef => {
  const ref = value as EpisodeRef | null;
  return (
    !!ref &&
    Number.isInteger(ref.s) &&
    ref.s >= 1 &&
    ref.s <= MAX_SEASON &&
    Number.isInteger(ref.e) &&
    ref.e >= 1 &&
    ref.e <= MAX_EPISODES
  );
};

/** What the database says when its episode functions aren't there yet (the app was updated before it). */
function failure(error: { code?: string; message: string }): string {
  if (error.code === "PGRST202") return "Tracking episodes isn't available yet. Please try again in a little while.";
  return error.message;
}

/**
 * The series on the signed-in person's My list, ready for ticking: saved with the seasons TMDB lists today (the database
 * checks ticks against them, and an airing show gains episodes), and on My list (put there, or brought back if it was
 * removed) when `put` is true. Returns its list item, or nothing when it isn't on the list and `put` is false.
 */
async function mySeries(
  supabase: Supabase,
  userId: string,
  tmdbId: number,
  put: boolean,
): Promise<{ itemId: string | null } | { error: string }> {
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return { error: "That isn't a valid series." };

  let details;
  try {
    details = await getMediaDetails("tv", tmdbId);
  } catch {
    return { error: "Couldn't reach the movie database. Please try again." };
  }
  if (!details.series) return { error: "This series has no episodes listed yet." };

  const { data: stored } = await supabase
    .from("media")
    .select("id, series")
    .eq("tmdb_id", tmdbId)
    .eq("media_type", "tv")
    .maybeSingle();
  let mediaId = (stored as { id: string } | null)?.id;
  if (!mediaId || !sameSeries(parseSeriesInfo((stored as { series: unknown }).series), details.series)) {
    const saved = await saveMedia(detailsToMediaRow(details));
    if ("error" in saved) return saved;
    mediaId = saved.id;
  }

  const { data: found } = await supabase
    .from("list_items")
    .select("id, deleted_at")
    .eq("media_id", mediaId)
    .is("group_id", null)
    .eq("added_by", userId)
    .maybeSingle();
  const entry = found as { id: string; deleted_at: string | null } | null;
  if (entry && !entry.deleted_at) return { itemId: entry.id };
  if (!put) return { itemId: null };

  if (entry) {
    const { error } = await supabase.from("list_items").update({ deleted_at: null }).eq("id", entry.id);
    return error ? { error: error.message } : { itemId: entry.id };
  }
  const limited = await overRateLimit(userId, LIMITS.addTitle);
  if (limited) return { error: limited };
  const { data, error } = await supabase
    .from("list_items")
    .insert({ group_id: null, added_by: userId, media_id: mediaId, status: "want" })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Couldn't add this series to My list." };
  return { itemId: (data as { id: string }).id };
}

/**
 * Ticks (or unticks) the episodes from one to another, both included: one episode, a season (to episode 20000), or
 * everything up to an episode. Ticking puts the series on My list if it isn't there. `on` is the day, in the
 * person's own time (a date, not a moment). The database checks it all and says if the series became Watched.
 */
export async function tickEpisodes(input: {
  tmdbId: number;
  watched: boolean;
  from: EpisodeRef;
  to: EpisodeRef;
  on?: string;
}): Promise<EpisodeResult> {
  const { supabase, user } = await requireUser();
  if (
    typeof input?.watched !== "boolean" ||
    !isRef(input.from) ||
    !isRef(input.to) ||
    (input.on !== undefined && !isDay(input.on))
  ) {
    return { error: "Those episodes aren't valid." };
  }

  const mine = await mySeries(supabase, user.id, input.tmdbId, input.watched);
  if ("error" in mine) return mine;
  // Unticking on a series that isn't on My list: there is nothing ticked.
  if (!mine.itemId) return {};

  const { data, error } = await supabase.rpc("mark_episodes", {
    p_item: mine.itemId,
    p_watched: input.watched,
    p_from_season: input.from.s,
    p_from_episode: input.from.e,
    p_to_season: input.to.s,
    p_to_episode: input.to.e,
    ...(input.on ? { p_on: input.on } : {}),
  });
  if (error) return { error: failure(error) };
  revalidatePath("/app", "layout");
  return { itemId: mine.itemId, completed: (data as { completed?: boolean } | null)?.completed === true };
}

/** Ticks the first aired episode that isn't ticked yet, putting the series on My list if it isn't there. */
export async function tickNextEpisode(input: { tmdbId: number; on?: string }): Promise<EpisodeResult> {
  const { supabase, user } = await requireUser();
  if (input?.on !== undefined && !isDay(input.on)) return { error: "That day isn't valid." };

  const mine = await mySeries(supabase, user.id, input?.tmdbId, true);
  if ("error" in mine) return mine;

  const { data, error } = await supabase.rpc("mark_next_episode", {
    p_item: mine.itemId,
    ...(input.on ? { p_on: input.on } : {}),
  });
  if (error) return { error: failure(error) };
  revalidatePath("/app", "layout");
  return { itemId: mine.itemId ?? undefined, completed: (data as { completed?: boolean } | null)?.completed === true };
}

/**
 * Saves the signed-in person's own score (1 to 10) and/or note for an aired episode, putting the series on My list if it
 * isn't there. Rating an episode ticks it; with neither a score nor a note, the old ones are only taken off.
 */
export async function rateEpisode(input: {
  tmdbId: number;
  season: number;
  episode: number;
  score: number | null;
  comment: string | null;
}): Promise<EpisodeResult> {
  const { supabase, user } = await requireUser();
  if (!isRef({ s: input?.season, e: input?.episode })) return { error: "That episode isn't valid." };
  const score = cleanScore(input.score ?? null);
  if (score === undefined) return { error: "Scores must be between 1 and 10." };
  const comment = typeof input.comment === "string" ? input.comment : null;
  if (comment !== null && tooLong(comment.trim())) {
    return { error: `Notes can be at most ${MAX_TEXT} characters.` };
  }

  const mine = await mySeries(supabase, user.id, input.tmdbId, true);
  if ("error" in mine) return mine;

  const { data, error } = await supabase.rpc("rate_episode", {
    p_item: mine.itemId,
    p_season: input.season,
    p_episode: input.episode,
    p_score: score,
    p_comment: comment,
  });
  if (error) return { error: failure(error) };
  revalidatePath("/app", "layout");
  return { itemId: mine.itemId ?? undefined, completed: (data as { completed?: boolean } | null)?.completed === true };
}
