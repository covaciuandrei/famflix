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
