/**
 * Shared pieces of the swipe-and-vote movie night: the votes and their points, the limits, the mood presets, the
 * options a night is started with, and the order each person sees a stack in. Client-safe (no server-only imports).
 */
import { GENRE_SLUGS } from "@/lib/genres";
import { seededShuffle } from "@/lib/random";
import type { MediaType } from "@/lib/types";

// ---------------------------------------------------------------------------------------------------------------
//  Votes
// ---------------------------------------------------------------------------------------------------------------

/** nope (✕, swipe left), yes (✓, swipe right), love (♥, button only), seen it (a button: seen it, would watch again). */
export type Vote = "nope" | "yes" | "love" | "seen";

/** What each vote adds to a title's score on the leaderboard. */
export const POINTS: Record<Vote, number> = { love: 2, yes: 1, seen: 1, nope: -1 };

export const LOVES_PER_STACK = 3;

// ---------------------------------------------------------------------------------------------------------------
//  Limits (the database enforces the same numbers)
// ---------------------------------------------------------------------------------------------------------------

export const STACK_SIZES = [20, 25, 30] as const;
export type StackSize = (typeof STACK_SIZES)[number];
export const DEFAULT_STACK_SIZE: StackSize = 25;
/** The database accepts stacks of 8 to 40 cards. */
export const MIN_STACK_SIZE = 8;
export const MAX_STACK_SIZE = 40;
/** A stack always has at least this many suggestions, so the family list can't fill all of it. */
export const MIN_SUGGESTIONS = 5;
export const MAX_STACKS = 5;
export const MAX_GENRES = 5;
export const MAX_VOTES_PER_SAVE = 60;
/** A night with no activity for this long expires. */
export const INACTIVITY_HOURS = 12;
/** On a pick, this many of the best titles join the family list. */
export const TOP_TITLES = 7;
export const HISTORY_PAGE = 20;
/** Movies up to these lengths (in minutes) can be asked for. */
export const RUNTIME_LIMITS = [100, 130] as const;

// ---------------------------------------------------------------------------------------------------------------
//  Cards
// ---------------------------------------------------------------------------------------------------------------

/** What a swipe card shows. */
export interface DeckCard {
  /** A candidate's id on a family night; "movie:123" or "tv:456" on a solo deck. */
  id: string;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  /** TMDB's average score, out of 10. */
  rating: number | null;
  runtime: number | null;
  genres: string[];
  trailerKey: string | null;
  /** From the family's or the person's list, or suggested by the app. */
  origin: "list" | "suggested";
}

/** One title across lists and TMDB. */
export function cardKey(card: { mediaType: MediaType; tmdbId: number }): string {
  return `${card.mediaType}:${card.tmdbId}`;
}

function hashString(text: string): number {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Each person sees a stack in their own order, which is the same every time they open it (it depends only on who
 * they are and which stack it is). That spreads the first-card advantage around the family.
 */
export function deckOrder<T>(userId: string, stackId: string, cards: readonly T[]): T[] {
  return seededShuffle(cards, hashString(`${userId}:${stackId}`));
}

// ---------------------------------------------------------------------------------------------------------------
//  Mood: what a night is started with
// ---------------------------------------------------------------------------------------------------------------

/** One tap fills in these genre chips. Slugs are the browse categories in genres.ts. */
export const MOODS = [
  { slug: "laugh", label: "Laugh", genres: ["comedy"] },
  { slug: "cozy", label: "Cozy", genres: ["comedy", "romance", "family"] },
  { slug: "edge", label: "Edge of the seat", genres: ["thriller", "crime", "mystery"] },
  { slug: "mind", label: "Mind-bending", genres: ["science-fiction", "mystery", "thriller"] },
  { slug: "adventure", label: "Big adventure", genres: ["adventure", "action", "fantasy"] },
  { slug: "scare", label: "Scare us", genres: ["horror", "thriller"] },
  { slug: "family", label: "Family night", genres: ["family", "animation", "adventure"] },
  { slug: "true", label: "True stories", genres: ["history", "documentary", "drama"] },
] as const satisfies readonly { slug: string; label: string; genres: readonly string[] }[];

export interface MoodOptions {
  /** Category slugs; none means anything goes. */
  genres: string[];
  /** Include series (movies only by default). */
  series: boolean;
  count: StackSize;
  /** Movies up to this many minutes, or null for any length. */
  maxRuntime: number | null;
}

export const DEFAULT_MOOD: MoodOptions = {
  genres: [],
  series: false,
  count: DEFAULT_STACK_SIZE,
  maxRuntime: null,
};

/** Reads a mood from URL parameters or a form, keeping only values that make sense. */
export function parseMood(input: {
  genres?: string | readonly string[] | null;
  series?: string | null;
  count?: string | number | null;
  max?: string | number | null;
}): MoodOptions {
  const raw = Array.isArray(input.genres) ? input.genres.join(",") : String(input.genres ?? "");
  const genres = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => GENRE_SLUGS.includes(s)),
    ),
  ].slice(0, MAX_GENRES);
  const count = Number(input.count);
  const max = Number(input.max);
  return {
    genres,
    series: input.series === "1",
    count: (STACK_SIZES as readonly number[]).includes(count) ? (count as StackSize) : DEFAULT_STACK_SIZE,
    maxRuntime: (RUNTIME_LIMITS as readonly number[]).includes(max) ? max : null,
  };
}

/** The URL parameters for a mood (empty ones are left out). */
export function moodParams(mood: MoodOptions): URLSearchParams {
  const params = new URLSearchParams();
  if (mood.genres.length) params.set("genres", mood.genres.join(","));
  if (mood.series) params.set("series", "1");
  if (mood.count !== DEFAULT_STACK_SIZE) params.set("count", String(mood.count));
  if (mood.maxRuntime !== null) params.set("max", String(mood.maxRuntime));
  return params;
}

// ---------------------------------------------------------------------------------------------------------------
//  A family's night, as movie_night_state() and active_movie_nights() in db_init.sql describe it
// ---------------------------------------------------------------------------------------------------------------

export type NightStatus = "open" | "closed" | "cancelled" | "expired";

export interface NightInfo {
  id: string;
  group_id: string;
  group_name: string;
  status: NightStatus;
  /** "swipe" is a night started from the Movie night page; "logged" one made by logging Watched together. */
  source: "swipe" | "logged";
  started_by: string | null;
  started_by_name: string | null;
  genres: string[];
  options: { series: boolean; count: number; max: number | null };
  created_at: string;
  last_activity_at: string;
  ended_at: string | null;
  /** Who picked or cancelled it. */
  ended_by: string | null;
  ended_by_name: string | null;
  picked_media_id: string | null;
  picked_title: string | null;
  picked_list_item_id: string | null;
  happened_on: string;
}

export interface StackInfo {
  id: string;
  position: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  /** Someone showed the results: voting on this stack is over. */
  revealed: boolean;
  total: number;
  my_voted: number;
  my_loves: number;
  my_finished: boolean;
  /** I may see this stack's results: I finished it, they were shown, or the night is over. */
  can_see_results: boolean;
}

/** How far someone is, never what they voted. */
export interface MemberProgress {
  user_id: string;
  name: string;
  avatar_url: string | null;
  joined: boolean;
  /** Watched the picked title. */
  watched: boolean;
  stacks: { stack_id: string; voted: number; finished: boolean }[];
}

export interface NightCandidate {
  id: string;
  stack_id: string;
  position: number;
  origin: "list" | "suggested";
  list_item_id: string | null;
  media_id: string;
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  year: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string | null;
  rating: number | null;
  runtime: number | null;
  genres: string[];
  trailer_key: string | null;
}

export interface ResultRow {
  candidate_id: string;
  rank: number;
  points: number;
  loves: number;
  yes: number;
  seen: number;
  nopes: number;
  votes: { user_id: string; name: string; vote: Vote }[];
  on_family_list: boolean;
  family_item_id: string | null;
  on_my_list: boolean;
}

export interface NightState {
  me: string;
  night: NightInfo;
  stacks: StackInfo[];
  members: MemberProgress[];
  /** Only in the full state. */
  candidates: NightCandidate[];
  /** My own votes, by candidate. */
  my_votes: Record<string, Vote>;
  /** Ranked, for the stacks I may see. */
  results: ResultRow[];
}

/** An open night in one of my families (for the invite, the dot on the menu and the banners). */
export interface ActiveNight {
  night_id: string;
  group_id: string;
  group_name: string;
  started_by: string | null;
  started_by_name: string | null;
  created_at: string;
  genres: string[];
  joined: boolean;
  stacks: number;
  /** Stacks still open for voting that I haven't finished. */
  waiting_stacks: number;
  members: number;
  /** Members who have finished every stack that is still open. */
  done_members: number;
}

/** Who voted what on one title: the strongest vote first, and within a vote you first, then by name. */
export function groupVotes(votes: ResultRow["votes"], meId: string): { vote: Vote; names: string[] }[] {
  const order: Vote[] = ["love", "yes", "seen", "nope"];
  return order
    .map((vote) => ({
      vote,
      names: votes
        .filter((v) => v.vote === vote)
        .map((v) => ({ mine: v.user_id === meId, name: v.name }))
        .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name))
        .map((v) => (v.mine ? "You" : v.name)),
    }))
    .filter((group) => group.names.length > 0);
}

/** One finished night in a family's history: a pick, a night nobody picked from, or a Watched together log. */
export interface HistoryEntry {
  id: string;
  /** "logged" is a Watched together log with no swiping behind it. */
  source: "swipe" | "logged";
  status: Exclude<NightStatus, "open">;
  /** When it started, or once a title was picked, the day it was watched. */
  happenedOn: string;
  /** The mood a swipe night started with (category slugs). */
  genres: string[];
  /** Who cancelled it. */
  endedByName: string | null;
  picked: { title: string; posterPath: string | null; tmdbId: number; mediaType: MediaType; year: number | null } | null;
  /** Who watched the pick, or for a night nobody picked from, who took part. */
  people: { name: string; avatarUrl: string | null }[];
  stacks: number;
  cards: number;
}

/** A night's card as the swipe stack shows it. */
export function candidateToCard(c: NightCandidate): DeckCard {
  return {
    id: c.id,
    mediaType: c.media_type,
    tmdbId: c.tmdb_id,
    title: c.title,
    year: c.year,
    posterPath: c.poster_path,
    backdropPath: c.backdrop_path,
    overview: c.overview ?? "",
    rating: c.rating && c.rating > 0 ? c.rating : null,
    runtime: c.runtime,
    genres: c.genres,
    trailerKey: c.trailer_key,
    origin: c.origin,
  };
}

/** The mood a night was started with, for asking for more suggestions in the same spirit. */
export function nightMood(night: NightInfo): MoodOptions {
  return parseMood({
    genres: night.genres,
    series: night.options.series ? "1" : "0",
    count: night.options.count,
    max: night.options.max,
  });
}
