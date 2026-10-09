"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getMovieNightState } from "@/lib/data";
import { buildFamilyCandidates, type LikeTitle } from "@/lib/deck";
import {
  cardKey,
  MAX_STACKS,
  MAX_VOTES_PER_SAVE,
  moodParams,
  nightMood,
  parseMood,
  type Vote,
} from "@/lib/movie-night";
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

const VOTE_WORDS = new Set<string>(["nope", "yes", "love", "seen"]);

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** The database's own message, except for the one case it can't word well (two people starting at once). */
function friendly(error: { code?: string; message: string }): string {
  return error.code === "23505" ? "This family already has a movie night open." : error.message;
}

/** Titles the family's last three movie nights already showed, so a new one doesn't repeat them. */
async function recentTitles(supabase: Supabase, groupId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("movie_nights")
    .select("movie_night_candidates(media(tmdb_id, media_type))")
    .eq("group_id", groupId)
    .eq("source", "swipe")
    .order("created_at", { ascending: false })
    .limit(3);
  const keys = new Set<string>();
  const nights = (data ?? []) as unknown as {
    movie_night_candidates: { media: { tmdb_id: number; media_type: MediaType } | null }[];
  }[];
  for (const night of nights) {
    for (const card of night.movie_night_candidates) {
      if (card.media) keys.add(cardKey({ mediaType: card.media.media_type, tmdbId: card.media.tmdb_id }));
    }
  }
  return keys;
}

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

// ---------------------------------------------------------------------------------------------------------------
//  A family's movie night
// ---------------------------------------------------------------------------------------------------------------

/**
 * Starts a movie night for a family: builds its first stack (the family's To watch titles that fit the mood, then
 * suggestions), creates the night and sends the starter to it. Only returns when something is wrong.
 */
export async function startMovieNight(input: {
  groupId: string;
  genres: string[];
  series: boolean;
  count: number;
  max: number | null;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!UUID.test(String(input?.groupId))) return { error: "That isn't one of your families." };
  const mood = parseMood({
    genres: Array.isArray(input.genres) ? input.genres.map(String) : [],
    series: input.series === true ? "1" : "0",
    count: input.count,
    max: input.max,
  });

  const { data: member } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", input.groupId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { error: "You're not in that family." };
  const limited = await overRateLimit(user.id, LIMITS.deck);
  if (limited) return { error: limited };

  const built = await buildFamilyCandidates({
    userId: user.id,
    groupId: input.groupId,
    mood,
    seed: randomSeed(),
    exclude: await recentTitles(supabase, input.groupId),
  });
  if ("error" in built) return { error: built.error };

  const { data, error } = await supabase.rpc("start_movie_night", {
    p_group: input.groupId,
    p_genres: mood.genres,
    p_options: { series: mood.series, count: mood.count, max: mood.maxRuntime },
    p_candidates: built.candidates,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/app", "layout");
  redirect(`/app/movie-night/${data as string}`);
}

/** Takes part in a night without voting yet. */
export async function joinNight(nightId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(nightId))) return { error: "That isn't a movie night." };
  const { error } = await supabase.rpc("join_movie_night", { p_night: nightId });
  return error ? { error: error.message } : {};
}

/**
 * Saves a batch of votes on one stack (a null vote takes one back) and returns the loves used in it. Like the other
 * swipe actions it doesn't refresh the page: the stack on screen must not change under someone's thumb.
 */
export async function castVotes(
  stackId: string,
  votes: { candidateId: string; vote: Vote | null }[],
): Promise<ActionResult & { loves?: number }> {
  const { supabase } = await requireUser();
  if (
    !UUID.test(String(stackId)) ||
    !Array.isArray(votes) ||
    votes.length === 0 ||
    votes.length > MAX_VOTES_PER_SAVE ||
    !votes.every((v) => v && UUID.test(String(v.candidateId)) && (v.vote === null || VOTE_WORDS.has(String(v.vote))))
  ) {
    return { error: "Those votes aren't valid." };
  }
  const { data, error } = await supabase.rpc("cast_movie_night_votes", {
    p_stack: stackId,
    p_votes: votes.map((v) => ({ candidate_id: v.candidateId, vote: v.vote })),
  });
  return error ? { error: error.message } : { loves: Number(data) };
}

/** Marks the caller as done with a stack. */
export async function finishStack(stackId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(stackId))) return { error: "That isn't a stack." };
  const { error } = await supabase.rpc("finish_movie_night_stack", { p_stack: stackId });
  return error ? { error: error.message } : {};
}

/** Shows the results now: voting on the stacks still open ends. Any member can. */
export async function revealNight(nightId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(nightId))) return { error: "That isn't a movie night." };
  const { error } = await supabase.rpc("reveal_movie_night", { p_night: nightId });
  return error ? { error: error.message } : {};
}

/** Cancels the night. Any member can. */
export async function cancelNight(nightId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(nightId))) return { error: "That isn't a movie night." };
  const { error } = await supabase.rpc("cancel_movie_night", { p_night: nightId });
  if (error) return { error: error.message };
  revalidatePath("/app", "layout");
  return {};
}

/**
 * Asks for another stack of suggestions in the same spirit as the night (same genres and options, nothing it or its
 * family's last nights already showed), or, with `likeCandidateId`, titles like one of its cards. `knownStacks` is
 * how many stacks the caller can see: if someone added one in the meantime, the caller gets that one back instead
 * of a second.
 */
export async function requestMoreStack(input: {
  nightId: string;
  knownStacks: number;
  /** One of the night's cards to find more titles like, instead of more in the night's mood. */
  likeCandidateId?: string;
}): Promise<ActionResult & { stackId?: string }> {
  const { supabase, user } = await requireUser();
  if (
    !UUID.test(String(input?.nightId)) ||
    !Number.isInteger(input.knownStacks) ||
    input.knownStacks < 1 ||
    input.knownStacks > MAX_STACKS
  ) {
    return { error: "That isn't a movie night." };
  }
  const state = await getMovieNightState(input.nightId, true).catch(() => null);
  if (!state) return { error: "This movie night isn't available." };
  if (state.night.status !== "open") return { error: "This movie night is over." };
  if (input.knownStacks >= MAX_STACKS) return { error: `A movie night has at most ${MAX_STACKS} stacks.` };
  let like: LikeTitle | undefined;
  if (input.likeCandidateId !== undefined) {
    const base = UUID.test(String(input.likeCandidateId))
      ? state.candidates.find((c) => c.id === input.likeCandidateId)
      : undefined;
    if (!base) return { error: "That title isn't in this movie night." };
    like = { mediaType: base.media_type, tmdbId: base.tmdb_id };
  }
  const limited = await overRateLimit(user.id, LIMITS.deck);
  if (limited) return { error: limited };

  const mood = nightMood(state.night);
  const exclude = await recentTitles(supabase, state.night.group_id);
  for (const card of state.candidates) {
    exclude.add(cardKey({ mediaType: card.media_type, tmdbId: card.tmdb_id }));
  }
  const built = await buildFamilyCandidates({
    userId: user.id,
    groupId: state.night.group_id,
    mood,
    seed: randomSeed(),
    suggestionsOnly: true,
    exclude,
    like,
  });
  if ("error" in built) return { error: built.error };

  const { data, error } = await supabase.rpc("add_movie_night_stack", {
    p_night: input.nightId,
    p_known_stacks: input.knownStacks,
    p_candidates: built.candidates,
  });
  return error ? { error: error.message } : { stackId: data as string };
}
