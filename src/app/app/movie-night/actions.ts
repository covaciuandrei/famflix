"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getMovieNightState } from "@/lib/data";
import { buildFamilyCandidates, type LikeTitle } from "@/lib/deck";
import {
  cardKey,
  MAX_STACKS,
  movieNightMood,
  nightMood,
  parseMood,
  validVotes,
  type Vote,
} from "@/lib/movie-night";
import { LIMITS, overRateLimit } from "@/lib/rate-limit";
import { MAX_PLAN_NOTE, PLAN_ANSWERS, planTimeProblem, type PlanAnswer } from "@/lib/movie-night-plans";
import { putOnList } from "@/lib/list-add";
import { saveTitle } from "@/lib/save-title";
import type { createClient } from "@/lib/supabase/server";
import type { MediaType, MemberSummary, RatingWithProfile } from "@/lib/types";
import { cleanScore, isDay, MAX_TEXT, saveOwnNote, tooLong } from "@/lib/watch-input";

export interface ActionResult {
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A family is never this big; it only keeps a request from carrying a huge list. */
const MAX_VIEWERS = 50;

type Supabase = Awaited<ReturnType<typeof createClient>>;

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** The database's own message, except for the one case it can't word well (two people starting at once). */
function friendly(error: { code?: string; message: string }): string {
  return error.code === "23505" ? "This family already has a movie night open." : error.message;
}

/** The same for plans, which also say plainly when the database hasn't been given the update that adds them yet. */
function planFriendly(error: { code?: string; message: string }): string {
  return error.code === "PGRST202"
    ? "Planning movie nights isn't set up yet: the database update hasn't been run."
    : friendly(error);
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
 * suggestions; movies only, series are tracked on My list), creates the night and sends the starter to it. Only
 * returns when something is wrong. With a plan of the family's (`planId`) the night has the plan's mood, whatever else
 * is passed, and the plan is marked started in the same go.
 */
export async function startMovieNight(input: {
  groupId: string;
  genres?: string[];
  count?: number;
  max?: number | null;
  planId?: string;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!UUID.test(String(input?.groupId))) return { error: "That isn't one of your families." };
  if (input.planId !== undefined && !UUID.test(String(input.planId))) return { error: "That isn't one of your plans." };

  let moodInput: { genres: string[]; count?: number | null; max?: number | null } = {
    genres: Array.isArray(input.genres) ? input.genres.map(String) : [],
    count: input.count,
    max: input.max,
  };
  if (input.planId) {
    // The plan's own mood, read from the plan (the database starts the night with it too).
    const { data: plan } = await supabase
      .from("movie_night_plans")
      .select("group_id, status, genres, options")
      .eq("id", input.planId)
      .maybeSingle();
    if (!plan || plan.group_id !== input.groupId) return { error: "That plan isn't available." };
    if (plan.status !== "planned") {
      return {
        error:
          plan.status === "started"
            ? "That movie night has already started."
            : plan.status === "cancelled"
              ? "That plan was cancelled."
              : "That plan has passed.",
      };
    }
    const options = (plan.options ?? {}) as { count?: unknown; max?: unknown };
    moodInput = {
      genres: Array.isArray(plan.genres) ? plan.genres.map(String) : [],
      count: Number(options.count),
      max: typeof options.max === "number" ? options.max : null,
    };
  }
  const mood = movieNightMood(parseMood(moodInput));

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
    p_options: { series: false, count: mood.count, max: mood.maxRuntime },
    p_candidates: built.candidates,
    // Left out when there is no plan, so a start with none works on a database that hasn't had the plans update yet.
    ...(input.planId ? { p_plan: input.planId } : {}),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/app", "layout");
  redirect(`/app/movie-night/${data as string}`);
}

/**
 * Plans a movie night for a family: a moment (an ISO instant, which the person's own browser worked out from their own
 * time zone), an optional note and an optional mood, the same as when a night starts. The database checks it all again
 * (in the future, within a year, at most 5 planned) and says what is wrong.
 */
export async function planNight(input: {
  groupId: string;
  startsAt: string;
  note: string;
  genres: string[];
  count: number;
  max: number | null;
}): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(input?.groupId))) return { error: "That isn't one of your families." };
  const when = typeof input.startsAt === "string" ? Date.parse(input.startsAt) : Number.NaN;
  const problem = planTimeProblem(Number.isFinite(when) ? new Date(when).toISOString() : null, Date.now());
  if (problem) return { error: problem };
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > MAX_PLAN_NOTE) return { error: `A note can be ${MAX_PLAN_NOTE} characters at most.` };
  const mood = movieNightMood(
    parseMood({
      genres: Array.isArray(input.genres) ? input.genres.map(String) : [],
      count: input.count,
      max: input.max,
    }),
  );

  const { error } = await supabase.rpc("plan_movie_night", {
    p_group: input.groupId,
    p_starts_at: new Date(when).toISOString(),
    p_note: note || null,
    p_genres: mood.genres,
    p_options: { series: false, count: mood.count, max: mood.maxRuntime },
  });
  if (error) return { error: planFriendly(error) };
  revalidatePath("/app", "layout");
  return {};
}

/** Answers a plan: Going, Maybe or Can't; null takes the answer back. */
export async function rsvpPlan(planId: string, answer: PlanAnswer | null): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(planId))) return { error: "That isn't one of your plans." };
  if (answer !== null && !PLAN_ANSWERS.includes(answer)) return { error: "Answer Going, Maybe or Can't." };
  const { error } = await supabase.rpc("rsvp_movie_night_plan", { p_plan: planId, p_answer: answer });
  if (error) return { error: planFriendly(error) };
  revalidatePath("/app", "layout");
  return {};
}

/** Cancels a plan (any member of the family can). */
export async function cancelPlan(planId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(planId))) return { error: "That isn't one of your plans." };
  const { error } = await supabase.rpc("cancel_movie_night_plan", { p_plan: planId });
  if (error) return { error: planFriendly(error) };
  revalidatePath("/app", "layout");
  return {};
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
  if (!UUID.test(String(stackId)) || !validVotes(votes)) return { error: "Those votes aren't valid." };
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

// ---------------------------------------------------------------------------------------------------------------
//  Guests: people without an account who vote through the night's link. Any member can make or turn off the link
//  and take a guest out. The link's token is a secret, so it is only ever handed to a member of the family.
// ---------------------------------------------------------------------------------------------------------------

/** The night's guest link, made if it has none (the secret part of /guest/<token>). */
export async function getGuestLink(nightId: string): Promise<ActionResult & { token?: string }> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(nightId))) return { error: "That isn't a movie night." };
  const { data, error } = await supabase.rpc("get_movie_night_guest_link", { p_night: nightId });
  return error ? { error: error.message } : { token: String(data) };
}

/** A new link: the old one stops working (guests who are in already stay in). */
export async function newGuestLink(nightId: string): Promise<ActionResult & { token?: string }> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(nightId))) return { error: "That isn't a movie night." };
  const { data, error } = await supabase.rpc("replace_movie_night_guest_link", { p_night: nightId });
  return error ? { error: error.message } : { token: String(data) };
}

/** No more guests can join (the ones who are in stay in). */
export async function turnOffGuestLink(nightId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(nightId))) return { error: "That isn't a movie night." };
  const { error } = await supabase.rpc("turn_off_movie_night_guest_link", { p_night: nightId });
  return error ? { error: error.message } : {};
}

/** Takes a guest out of an open night, with their votes. */
export async function removeGuest(nightId: string, guestId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(nightId)) || !UUID.test(String(guestId))) return { error: "That isn't a guest of this night." };
  const { error } = await supabase.rpc("remove_movie_night_guest", { p_night: nightId, p_guest: guestId });
  return error ? { error: error.message } : {};
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

// ---------------------------------------------------------------------------------------------------------------
//  A night that is over: change who watched it and when, or delete it
// ---------------------------------------------------------------------------------------------------------------

/** The database's own message, except when it hasn't had the update that adds editing and deleting yet, or two people changed the same title at once. */
function manageFriendly(error: { code?: string; message: string }): string {
  if (error.code === "PGRST202") {
    return "Editing and deleting movie nights isn't set up yet: the database update hasn't been run.";
  }
  // The database stopped one of two changes to the same title made in the same instant: the other went through.
  if (error.code === "40P01" || error.code === "40001") {
    return "Someone changed this title at the same moment. Please try again.";
  }
  return error.message;
}

/** What the "Who watched?" window of a night needs: the family, who is on the record now, and the scores they have. */
export interface NightEditInfo {
  /** The day it is for now. */
  watchedOn: string;
  members: MemberSummary[];
  /** Members of the family who are on the title's record now. */
  viewerIds: string[];
  ratings: RatingWithProfile[];
}

/**
 * Reads what the edit window starts from, as the signed-in member may see it (row level security keeps everyone else
 * out). Read when the window opens, so it is what the night is now, and handed back with the changes so the database
 * can tell if someone else changed the night in between.
 */
export async function getNightEditInfo(nightId: string): Promise<ActionResult & { info?: NightEditInfo }> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(nightId))) return { error: "That isn't a movie night." };
  const { data: night } = await supabase
    .from("movie_nights")
    .select("group_id, picked_list_item_id, happened_on")
    .eq("id", nightId)
    .maybeSingle();
  const row = night as { group_id: string; picked_list_item_id: string | null; happened_on: string } | null;
  if (!row?.picked_list_item_id) return { error: "This movie night isn't available." };

  const [members, watches, ratings] = await Promise.all([
    supabase.from("group_members").select("user_id, profiles(id, display_name, avatar_url)").eq("group_id", row.group_id),
    supabase.from("watches").select("user_id").eq("list_item_id", row.picked_list_item_id),
    supabase.from("ratings").select("*, profiles(id, display_name, avatar_url)").eq("list_item_id", row.picked_list_item_id),
  ]);
  if (members.error || watches.error || ratings.error) {
    console.error("Could not read a movie night to edit:", members.error?.message ?? watches.error?.message ?? ratings.error?.message);
    return { error: "Couldn't open this movie night. Please try again." };
  }
  const family = ((members.data ?? []) as unknown as { user_id: string; profiles: MemberSummary | null }[])
    .map((m) => m.profiles)
    .filter((profile): profile is MemberSummary => profile !== null)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const inFamily = new Set(family.map((m) => m.id));
  return {
    info: {
      watchedOn: row.happened_on,
      members: family,
      viewerIds: ((watches.data ?? []) as { user_id: string }[]).map((w) => w.user_id).filter((id) => inFamily.has(id)),
      ratings: (ratings.data ?? []) as unknown as RatingWithProfile[],
    },
  };
}

/**
 * Changes who watched the title a night picked, and on which day: `viewers` is everyone who watched (with a score for
 * anyone who had none), as when the title was picked, and `expectedOn` and `expectedViewers` are what the person saw
 * when they opened the window. The database adds the people who are new (to their My list too, and they are asked to
 * rate it), takes off the people who are left out, and refuses if someone changed the night since or the night can't be
 * edited. Then the person's own note, if they changed it.
 */
export async function editNight(
  input: PickInput & { expectedOn: string; expectedViewers: string[] },
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const checked = checkPick(input);
  if ("error" in checked) return checked;
  const expected = Array.isArray(input?.expectedViewers) ? input.expectedViewers : null;
  if (
    !isDay(input?.expectedOn) ||
    !expected ||
    expected.length > MAX_VIEWERS ||
    expected.some((id) => !UUID.test(String(id)))
  ) {
    return { error: "This movie night couldn't be read. Close this window and open it again." };
  }

  const { data: night } = await supabase.from("movie_nights").select("picked_list_item_id").eq("id", input.nightId).maybeSingle();
  const { error } = await supabase.rpc("update_movie_night", {
    p_night: input.nightId,
    p_watched_on: input.watchedOn,
    p_viewers: checked.viewers,
    p_expected_on: input.expectedOn,
    p_expected_viewers: expected,
  });
  if (error) return { error: manageFriendly(error) };
  const itemId = (night as { picked_list_item_id: string | null } | null)?.picked_list_item_id;
  if (!itemId) {
    revalidatePath("/app", "layout");
    return {};
  }
  return finishPick(supabase, user.id, itemId, checked.viewers, checked.note);
}

/**
 * Deletes a night that is over from the family's history. With `undoWatch` the title also goes off Watched together,
 * back to To watch, which the database only allows while nobody on it rated, noted or reacted to it themselves. Whether this
 * person may is the database's call (the owner, whoever started the night or whoever ended it).
 */
export async function deleteNight(input: { nightId: string; undoWatch: boolean }): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(String(input?.nightId))) return { error: "That isn't a movie night." };
  const { error } = await supabase.rpc("delete_movie_night", {
    p_night: input.nightId,
    p_undo_watch: input.undoWatch === true,
  });
  if (error) return { error: manageFriendly(error) };
  revalidatePath("/app", "layout");
  return {};
}
