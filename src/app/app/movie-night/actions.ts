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
  nightMood,
  parseMood,
  type Vote,
} from "@/lib/movie-night";
import { LIMITS, overRateLimit } from "@/lib/rate-limit";
import { putOnList } from "@/lib/list-add";
import { saveTitle } from "@/lib/save-title";
import type { createClient } from "@/lib/supabase/server";
import type { MediaType } from "@/lib/types";
import { cleanScore, MAX_TEXT, saveOwnNote, tooLong } from "@/lib/watch-input";

export interface ActionResult {
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written as YYYY-MM-DD (not 2026-13-45). */
function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** A family is never this big; it only keeps a request from carrying a huge list. */
const MAX_VIEWERS = 50;

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

/** What every pick sends: the night, the day, who watched (with a score for anyone who had none) and the picker's note. */
interface PickInput {
  nightId: string;
  watchedOn: string;
  viewers: { userId: string; score: number | null }[];
  /** The signed-in user's own note, when they are among the viewers and wrote one. */
  note?: string;
}

/** Checks what a pick sends before the database is asked, and puts the viewers the way the database wants them. */
function checkPick(
  input: PickInput,
): { error: string } | { viewers: { user_id: string; score: number | null }[]; note: string | undefined } {
  const viewers = Array.isArray(input?.viewers) ? input.viewers : [];
  if (
    !UUID.test(String(input?.nightId)) ||
    !isDay(input?.watchedOn) ||
    viewers.length === 0 ||
    viewers.length > MAX_VIEWERS ||
    viewers.some((v) => !UUID.test(String(v?.userId))) ||
    new Set(viewers.map((v) => v.userId)).size !== viewers.length
  ) {
    return { error: "Pick at least one person who watched it, and a date." };
  }
  const scores = viewers.map((v) => cleanScore(v.score ?? null));
  if (scores.some((score) => score === undefined)) return { error: "Scores must be between 1 and 10." };
  // Checked before the pick, so a note that is too long can't leave a night picked and its note missing.
  const note = typeof input.note === "string" ? input.note : undefined;
  if (note !== undefined && tooLong(note.trim())) {
    return { error: `Notes can be at most ${MAX_TEXT} characters.` };
  }
  return { viewers: viewers.map((v, i) => ({ user_id: v.userId, score: scores[i] ?? null })), note };
}

/** After a pick: only your own note (the others add theirs when they're asked to rate it), and the app refreshes. */
async function finishPick(
  supabase: Supabase,
  userId: string,
  itemId: string,
  viewers: { user_id: string }[],
  note: string | undefined,
): Promise<ActionResult> {
  if (note !== undefined && viewers.some((v) => v.user_id === userId)) {
    const saved = await saveOwnNote(supabase, itemId, userId, note);
    if (saved.error) return saved;
  }
  revalidatePath("/app", "layout");
  return {};
}

/**
 * Picks a title from the leaderboard: whoever picks says who watched it and when, like Watched together on the family
 * list. In one go the title joins the family list if it isn't there, the watch is logged and the night ends (the best
 * titles join the list too). Then the picker's own note is saved. Nothing changes if the watch is refused, and a night
 * that someone already picked gets "Ana already picked Dune".
 */
export async function pickCard(input: PickInput & { candidateId: string }): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const checked = UUID.test(String(input?.candidateId)) ? checkPick(input) : { error: "Pick at least one person who watched it, and a date." };
  if ("error" in checked) return checked;

  const { data: itemId, error } = await supabase.rpc("pick_movie_night_card", {
    p_night: input.nightId,
    p_candidate: input.candidateId,
    p_watched_on: input.watchedOn,
    p_viewers: checked.viewers,
  });
  if (error) return { error: error.message };
  return finishPick(supabase, user.id, itemId as string, checked.viewers, checked.note);
}

/**
 * Picks a title that isn't one of the night's cards: after the swiping the family decided on something else. The title
 * comes from a TMDB search, so it is looked up and saved to the shared movie info here (like any title added to a
 * list); from there it is the same as picking a card, and the night ends with it.
 */
export async function pickTitle(
  input: PickInput & { tmdbId: number; mediaType: MediaType },
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const checked = checkPick(input);
  if ("error" in checked) return checked;

  const saved = await saveTitle(user.id, { tmdbId: input?.tmdbId, mediaType: input?.mediaType });
  if ("error" in saved) return { error: saved.error };

  const { data: itemId, error } = await supabase.rpc("pick_movie_night_title", {
    p_night: input.nightId,
    p_media: saved.id,
    p_watched_on: input.watchedOn,
    p_viewers: checked.viewers,
  });
  if (error) {
    // PGRST202: the database doesn't have the function yet (the app was updated before it).
    if (error.code === "PGRST202") return { error: "Picking another title isn't available yet. Please try again in a little while." };
    return { error: error.message };
  }
  return finishPick(supabase, user.id, itemId as string, checked.viewers, checked.note);
}

/**
 * Adds one title of a night to the family's list or to My list, restoring it if it was removed. The title is looked up
 * from the night, so only cards of a night you belong to can be added.
 */
export async function addNightTitle(input: {
  nightId: string;
  candidateId: string;
  target: "family" | "mine";
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (
    !UUID.test(String(input?.nightId)) ||
    !UUID.test(String(input?.candidateId)) ||
    (input.target !== "family" && input.target !== "mine")
  ) {
    return { error: "That isn't a title of a movie night." };
  }
  const limited = await overRateLimit(user.id, LIMITS.addTitle);
  if (limited) return { error: limited };

  // Members only (row level security), and the card has to belong to this night.
  const { data } = await supabase
    .from("movie_night_candidates")
    .select("media_id, movie_nights!inner(group_id)")
    .eq("id", input.candidateId)
    .eq("night_id", input.nightId)
    .maybeSingle();
  const card = data as { media_id: string; movie_nights: { group_id: string } } | null;
  if (!card) return { error: "That title isn't in this movie night." };

  const res = await putOnList(supabase, user.id, card.media_id, input.target === "family" ? card.movie_nights.group_id : null);
  if (res.error) return res;
  revalidatePath("/app", "layout");
  return {};
}

/**
 * For a night that ended with nobody picking (cancelled, or 12 hours of nothing): adds its best titles to the family
 * list, the same ones a pick adds. Says how many were new.
 */
export async function addTopTitles(nightId: string): Promise<ActionResult & { added?: number }> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(nightId))) return { error: "That isn't a movie night." };
  const { data, error } = await supabase.rpc("add_movie_night_top_titles", { p_night: nightId });
  if (error) return { error: error.message };
  revalidatePath("/app", "layout");
  return { added: Number(data) };
}
