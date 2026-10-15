/**
 * The rows of titles on Browse and on a title's page, and how to ask TMDB for any page of one. A row shows the first
 * page and loads the next ones as it is scrolled to its end, so what a row is made of (its source) has to be written
 * as an address, read back, and checked: it comes from the browser. Client-safe (no server-only imports).
 */
import { libraryKey } from "@/lib/constants";
import { findDecade } from "@/lib/decades";
import { findGenre } from "@/lib/genres";
import type { MediaType } from "@/lib/types";

/**
 * The fewest votes a title may have to be in a filtered row, strictest first. Vote minimums keep out obscure titles and
 * ones rated by a handful of people (a "top rated" row most of all), but a narrow filter (westerns of the eighties) has
 * few titles with many votes: so a row asks for the strictest minimum that still leaves it enough titles, and goes down
 * these steps only as far as it has to. Series get fewer votes than movies, so theirs are lower.
 */
export const VOTE_STEPS = {
  movie: { popular: [100, 30, 10, 5], top: [1000, 300, 100, 50] },
  tv: { popular: [100, 30, 10, 5], top: [300, 100, 40, 15] },
} as const satisfies Record<MediaType, Record<"popular" | "top", readonly number[]>>;

/** How many titles a filtered row should have, when TMDB has that many, before it may ask for ones with fewer votes. */
export const ENOUGH_TITLES = 200;

/** Where a row's titles come from. */
export type RowSource =
  /** What is trending this week (both kinds of title with no type). */
  | { kind: "trending"; type: MediaType | null }
  | { kind: "popular"; type: MediaType }
  | { kind: "top"; type: MediaType }
  /**
   * Popular or best rated titles, in a category (a Browse genre slug) and a decade (a decade value), either or both,
   * that have at least `votes` votes (one of VOTE_STEPS).
   */
  | {
      kind: "discover";
      type: MediaType;
      sort: "popular" | "top";
      genre: string | null;
      decade: string | null;
      votes: number;
    }
  /** What TMDB recommends for one title ("Because you liked it", "More like this"). */
  | { kind: "like"; type: MediaType; id: number };

/** What a card needs of a title. Smaller than everything TMDB says, since a loaded page travels to the browser as it is. */
export interface CardItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
  voteAverage: number;
}

/** TMDB answers no page after the 500th, however many it says there are. */
export const MAX_PAGE = 500;

/** Whether TMDB has pages after this one. Not told how many there are, there is no guessing. */
export function hasMorePages(page: number, totalPages: number | undefined): boolean {
  return Number.isInteger(totalPages) && page < Math.min(totalPages as number, MAX_PAGE);
}

/** A page number asked for: a plain whole number from 1 to the last page TMDB has. */
export function parsePage(value: string | null): number | null {
  if (value === null || !/^[1-9]\d{0,2}$/.test(value)) return null;
  const page = Number(value);
  return page <= MAX_PAGE ? page : null;
}

const TYPES = ["movie", "tv"] as const;
const typeOf = (value: string | null): MediaType | null => TYPES.find((t) => t === value) ?? null;

/** The address parameters of a source (what it does not use is left out). */
export function rowSourceToParams(source: RowSource): URLSearchParams {
  const params = new URLSearchParams({ kind: source.kind });
  if (source.type) params.set("type", source.type);
  if (source.kind === "discover") {
    params.set("sort", source.sort);
    if (source.genre) params.set("genre", source.genre);
    if (source.decade) params.set("decade", source.decade);
    params.set("votes", String(source.votes));
  }
  if (source.kind === "like") params.set("id", String(source.id));
  return params;
}

/** Which row this is, to tell it from the others. */
export function rowSourceKey(source: RowSource): string {
  return rowSourceToParams(source).toString();
}

/** The votes asked for: one of the row's steps, or (left out) the strictest, which is what every row had before it could ask for fewer. */
function parseVotes(value: string | null, type: MediaType, sort: "popular" | "top"): number | null {
  const steps: readonly number[] = VOTE_STEPS[type][sort];
  if (value === null) return steps[0];
  if (!/^[1-9]\d{0,3}$/.test(value)) return null;
  return steps.find((step) => step === Number(value)) ?? null;
}

/**
 * Reads a source from address parameters, or null when they are not a row of ours: an unknown kind, sort, category,
 * decade or vote minimum, a category the type does not have, or an id that is not a plain positive whole number.
 * Parameters a kind does not use are ignored.
 */
export function rowSourceFromParams(params: URLSearchParams): RowSource | null {
  const kind = params.get("kind");
  const typeParam = params.get("type");
  const type = typeOf(typeParam);

  if (kind === "trending") {
    return typeParam === null || type ? { kind, type } : null;
  }
  if (!type) return null;
  if (kind === "popular" || kind === "top") return { kind, type };

  if (kind === "discover") {
    const sort = params.get("sort");
    if (sort !== "popular" && sort !== "top") return null;
    const genre = params.get("genre");
    const decade = params.get("decade");
    if (genre !== null) {
      const known = findGenre(genre);
      if (!known || known[type] === null) return null;
    }
    if (decade !== null && !findDecade(decade)) return null;
    const votes = parseVotes(params.get("votes"), type, sort);
    return votes === null ? null : { kind, type, sort, genre, decade, votes };
  }

  if (kind === "like") {
    const id = params.get("id");
    return id !== null && /^[1-9]\d{0,8}$/.test(id) ? { kind, type, id: Number(id) } : null;
  }
  return null;
}

/**
 * The strictest of a row's vote minimums that still leaves it enough titles, or the loosest when none does. `totalAt`
 * says how many titles a minimum leaves. A row ends when TMDB runs out of titles, and a strict minimum can leave a narrow
 * filter with a handful. Every minimum is asked about at once, since the row is shown when the slowest has answered, and
 * one that can't be asked about counts as not enough.
 */
export async function chooseVotes(
  steps: readonly number[],
  totalAt: (votes: number) => Promise<number>,
): Promise<number> {
  const totals = await Promise.all(
    steps.slice(0, -1).map((votes) => (async () => totalAt(votes))().catch(() => 0)),
  );
  const enough = totals.findIndex((total) => total >= ENOUGH_TITLES);
  return enough === -1 ? steps[steps.length - 1] : steps[enough];
}

/** The TMDB request for one page of a row, and the kind its titles are when TMDB doesn't say. */
export function rowRequest(
  source: RowSource,
  page: number,
): { path: string; params: Record<string, string>; fallbackType: MediaType | undefined } {
  const paged = { page: String(page) };
  switch (source.kind) {
    case "trending":
      return { path: `/trending/${source.type ?? "all"}/week`, params: paged, fallbackType: source.type ?? undefined };
    case "popular":
      return { path: `/${source.type}/popular`, params: paged, fallbackType: source.type };
    case "top":
      return { path: `/${source.type}/top_rated`, params: paged, fallbackType: source.type };
    case "like":
      return { path: `/${source.type}/${source.id}/recommendations`, params: paged, fallbackType: source.type };
    case "discover": {
      const genre = source.genre ? findGenre(source.genre) : null;
      const genreId = genre ? genre[source.type] : null;
      const decade = source.decade ? findDecade(source.decade) : null;
      const dateField = source.type === "movie" ? "primary_release_date" : "first_air_date";
      return {
        path: `/discover/${source.type}`,
        params: {
          ...(genreId !== null && { with_genres: String(genreId) }),
          // Talk, news, reality and soap shows would otherwise fill the Comedy and Drama series rows.
          ...(source.type === "tv" && { without_genres: "10763,10764,10766,10767" }),
          ...(decade?.from != null && { [`${dateField}.gte`]: `${decade.from}-01-01` }),
          ...(decade?.to != null && { [`${dateField}.lte`]: `${decade.to}-12-31` }),
          include_adult: "false",
          // Vote minimums keep out obscure titles and ones rated by a handful of people.
          sort_by: source.sort === "popular" ? "popularity.desc" : "vote_average.desc",
          "vote_count.gte": String(source.votes),
          ...paged,
        },
        fallbackType: source.type,
      };
    }
  }
}

/** The titles of a page that are not in `seen` yet, which then counts them as shown (a list can repeat a title between pages). */
export function takeNew<T extends { tmdbId: number; mediaType: MediaType }>(seen: Set<string>, items: readonly T[]): T[] {
  const fresh: T[] = [];
  for (const item of items) {
    const key = libraryKey(item.mediaType, item.tmdbId);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(item);
  }
  return fresh;
}

/** How many pages in a row may bring nothing new before a row gives up on getting more. */
const MAX_PAGES_WITHOUT_NEW = 3;

/**
 * Loads what a row shows next: the new titles of the page after `afterPage`. A page can hold only titles the row has
 * already (the lists shift between requests), so it asks on for the next page, but gives up after a few of those
 * rather than ask for ever. Resolves with the new titles, the last page asked for, and whether there is more after it;
 * rejects when a page can't be loaded.
 */
export async function loadNextTitles<T extends { tmdbId: number; mediaType: MediaType }>({
  fetchPage,
  afterPage,
  seen,
}: {
  fetchPage: (page: number) => Promise<{ items: T[]; hasMore: boolean }>;
  afterPage: number;
  seen: Set<string>;
}): Promise<{ items: T[]; page: number; hasMore: boolean }> {
  let page = afterPage;
  for (let withoutNew = 0; withoutNew < MAX_PAGES_WITHOUT_NEW; withoutNew++) {
    page += 1;
    const result = await fetchPage(page);
    const items = takeNew(seen, result.items);
    if (items.length > 0 || !result.hasMore) return { items, page, hasMore: result.hasMore };
  }
  return { items: [], page, hasMore: false };
}
