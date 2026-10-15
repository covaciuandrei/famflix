import "server-only";

import { chooseVotes, hasMorePages, rowRequest, VOTE_STEPS, type RowSource } from "@/lib/browse-rows";
import type { Decade } from "@/lib/decades";
import { findGenre, type BrowseGenre } from "@/lib/genres";
import { interleave } from "@/lib/deck-compose";
import { seriesFromTmdb, seriesToJson, type RawSeries, type SeriesInfo } from "@/lib/series";
import { titleExtrasFrom, type RawTitleExtras, type TitleExtras } from "@/lib/title-details";
import type { MediaType } from "@/lib/types";

/**
 * Minimal server-side TMDB (The Movie Database) client.
 *
 * Uses a v4 Read Access Token supplied via the `TMDB_ACCESS_TOKEN` env var.
 * All calls happen on the server so the token is never exposed to the browser.
 */

const TMDB_BASE = "https://api.themoviedb.org/3";

export interface TmdbItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  voteAverage: number;
}

export interface TmdbDetails extends TmdbItem {
  genres: string[];
  runtime: number | null;
  trailerKey: string | null;
  /** A series' seasons and how far it has aired; null for a movie. */
  series: SeriesInfo | null;
}

/** What a title's page shows besides the basics: the cast, who made it, its age rating, its collection and similar titles. */
export interface TmdbExtras extends TitleExtras {
  /** TMDB's "if you liked this" titles, with a poster, without the title itself (the first page of them). */
  similar: TmdbItem[];
  /** Whether TMDB has more of them after those. */
  similarHasMore: boolean;
}

export interface TmdbRow {
  title: string;
  /** The first page of the row. */
  items: TmdbItem[];
  /** Where the row's titles come from, so the pages after the first can be asked for as the row is scrolled. */
  source: RowSource;
  /** Whether TMDB has pages after the first. */
  hasMore: boolean;
}

interface RawResult {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
}

interface RawDetails extends RawResult, RawSeries, RawTitleExtras {
  genres?: { id: number; name: string }[];
  runtime?: number;
  episode_run_time?: number[];
  videos?: { results: { key: string; site: string; type: string }[] };
  recommendations?: { results?: RawResult[]; total_pages?: number };
}

function token(): string {
  const t = process.env.TMDB_ACCESS_TOKEN;
  if (!t) {
    throw new Error(
      "TMDB_ACCESS_TOKEN is not set. Add it to your environment (see .env.local.example).",
    );
  }
  return t;
}

export class TmdbError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`TMDB request failed (${status}) for ${path}`);
  }
}

/**
 * TMDB answers are the same for everyone, so each one is kept in memory for `ttl` seconds (TMDB allows and
 * encourages caching). Browse then costs one TMDB request per row per hour instead of up to 8 per visit;
 * TMDB allows about 40 a second. (Next's fetch cache can't do this here: the app renders every page fresh,
 * and each server action clears it.) Concurrent requests for the same thing share one TMDB call.
 */
const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
const MAX_CACHED = 500;
/**
 * How long TMDB gets to answer. A request that is never answered would otherwise stay in the cache as the answer for
 * everyone who asks for that page, and hang them all as long as the platform lets it.
 */
const TMDB_TIMEOUT_MS = 10_000;

async function tmdbFetch<T>(
  path: string,
  params: Record<string, string> = {},
  ttl = 3600,
): Promise<T> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const key = url.toString();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;

  const value = (async () => {
    const res = await fetch(url, {
      headers: {
      Authorization: `Bearer ${token()}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new TmdbError(res.status, path);
    }
    return (await res.json()) as T;
  })();

  cache.delete(key);
  cache.set(key, { expires: Date.now() + ttl * 1000, value });
  // Failures aren't kept, so the next visit tries again.
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  // The oldest answers go first once the cache is full.
  while (cache.size > MAX_CACHED) {
    cache.delete(cache.keys().next().value as string);
  }
  return value;
}

function yearFromDate(date?: string): number | null {
  if (!date) return null;
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

/** Normalize a raw TMDB result into our common shape. Returns null for people. */
function normalize(raw: RawResult, fallbackType?: MediaType): TmdbItem | null {
  const mediaType = (raw.media_type ?? fallbackType) as string | undefined;
  if (mediaType !== "movie" && mediaType !== "tv") return null;

  return {
    tmdbId: raw.id,
    mediaType,
    title: raw.title ?? raw.name ?? "Untitled",
    year: yearFromDate(raw.release_date ?? raw.first_air_date),
    posterPath: raw.poster_path ?? null,
    backdropPath: raw.backdrop_path ?? null,
    overview: raw.overview ?? "",
    voteAverage: raw.vote_average ?? 0,
  };
}

function normalizeMany(
  results: RawResult[],
  fallbackType?: MediaType,
): TmdbItem[] {
  return results
    .map((r) => normalize(r, fallbackType))
    .filter((x): x is TmdbItem => x !== null);
}

/** Search movies and TV shows by title, or only movies (`only: "movie"`). */
export async function searchMedia(query: string, only?: MediaType): Promise<TmdbItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const data = await tmdbFetch<{ results: RawResult[] }>(
    only ? `/search/${only}` : "/search/multi",
    { query: trimmed, include_adult: "false", page: "1" },
    600,
  );
  return normalizeMany(data.results, only);
}

/**
 * One page of a row: its titles (a recommendation row leaves out titles without a poster, and the title itself),
 * whether TMDB has pages after it, and how many titles the whole row has. Throws if TMDB can't be reached.
 */
export async function getRowPage(
  source: RowSource,
  page: number,
): Promise<{ items: TmdbItem[]; hasMore: boolean; total: number }> {
  const { path, params, fallbackType } = rowRequest(source, page);
  const data = await tmdbFetch<{ results: RawResult[]; total_pages?: number; total_results?: number }>(
    path,
    params,
    // What TMDB recommends for a title hardly changes.
    source.kind === "like" ? 86_400 : 3600,
  );
  const items = normalizeMany(data.results, fallbackType);
  return {
    items:
      source.kind === "like"
        ? items.filter((i) => i.posterPath && !(i.mediaType === source.type && i.tmdbId === source.id))
        : items,
    hasMore: hasMorePages(page, data.total_pages),
    total: data.total_results ?? 0,
  };
}

/** A row as it is first shown: its first page, and what is needed to ask for the rest. */
async function firstPageOf(title: string, source: RowSource): Promise<TmdbRow> {
  const { items, hasMore } = await getRowPage(source, 1);
  return { title, source, items, hasMore };
}

/** Curated browse rows for the discover page, or with a type only that kind of title. */
export async function getBrowseRows(type: MediaType | null = null): Promise<TmdbRow[]> {
  const kind = type === "movie" ? "movies" : "series";
  const rows: [string, RowSource][] = type
    ? [
        [`Trending ${kind} this week`, { kind: "trending", type }],
        [`Popular ${kind}`, { kind: "popular", type }],
        [`Top rated ${kind}`, { kind: "top", type }],
      ]
    : [
        ["Trending this week", { kind: "trending", type: null }],
        ["Popular movies", { kind: "popular", type: "movie" }],
        ["Popular series", { kind: "popular", type: "tv" }],
        ["Top rated movies", { kind: "top", type: "movie" }],
        ["Top rated series", { kind: "top", type: "tv" }],
      ];
  return Promise.all(rows.map(([title, source]) => firstPageOf(title, source)));
}

/**
 * Popular and top rated movies and series in a Browse category, release decade, or both; with a type, only that kind
 * of title. Each row asks for the strictest vote minimum that still leaves it enough titles (see chooseVotes), so a
 * narrow filter doesn't end after a few of them.
 */
export async function getDiscoverRows({
  genre,
  decade,
  type = null,
}: {
  genre: BrowseGenre | null;
  decade: Decade | null;
  type?: MediaType | null;
}): Promise<TmdbRow[]> {
  const what = genre ? `${genre.label.toLowerCase()} ` : "";
  const when = !decade
    ? ""
    : decade.from === null
      ? ` from before ${decade.to + 1}`
      : ` from the ${decade.label}`;

  const discover = async (mediaType: MediaType, sort: "popular" | "top"): Promise<RowSource> => {
    const row = {
      kind: "discover",
      type: mediaType,
      sort,
      genre: genre?.slug ?? null,
      decade: decade?.value ?? null,
    } as const;
    const votes = await chooseVotes(VOTE_STEPS[mediaType][sort], async (minimum) => {
      const { total } = await getRowPage({ ...row, votes: minimum }, 1);
      return total;
    });
    return { ...row, votes };
  };

  const movies = type !== "tv" && (!genre || genre.movie !== null);
  const series = type !== "movie" && (!genre || genre.tv !== null);
  const rows: [string, MediaType, "popular" | "top"][] = [];
  if (movies) rows.push([`Popular ${what}movies${when}`, "movie", "popular"]);
  if (series) rows.push([`Popular ${what}series${when}`, "tv", "popular"]);
  if (movies) rows.push([`Top rated ${what}movies${when}`, "movie", "top"]);
  if (series) rows.push([`Top rated ${what}series${when}`, "tv", "top"]);
  return Promise.all(rows.map(async ([title, mediaType, sort]) => firstPageOf(title, await discover(mediaType, sort))));
}

/** Spreads a stack's seed over TMDB's first few pages, so asking again for the same mood gives other titles. */
function pageFor(seed: number, salt: number, pages: number): number {
  let h = (seed | 0) ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return 1 + ((h >>> 0) % pages);
}

/**
 * Titles to suggest for a movie night, popular and well-rated ones for each chosen category (movies, and series if
 * asked), already released and with a poster, mixed so the first ones aren't all one category. Which TMDB pages
 * they come from depends on `seed`. Throws if TMDB can't be reached.
 */
export async function getDeckSuggestions({
  genres,
  series,
  maxRuntime,
  seed,
}: {
  /** Category slugs; none means anything popular. */
  genres: readonly string[];
  series: boolean;
  /** Movies up to this many minutes. */
  maxRuntime: number | null;
  seed: number;
}): Promise<TmdbItem[]> {
  const chosen = genres.map(findGenre).filter((g): g is BrowseGenre => g !== null);
  const types: MediaType[] = series ? ["movie", "tv"] : ["movie"];
  const wanted: { type: MediaType; genreId: number | null }[] = [];
  const seen = new Set<string>();
  const add = (type: MediaType, genreId: number | null) => {
    const key = `${type}:${genreId}`;
    if (!seen.has(key)) {
      seen.add(key);
      wanted.push({ type, genreId });
    }
  };
  if (chosen.length === 0) {
    types.forEach((type) => add(type, null));
  } else {
    for (const genre of chosen) {
      for (const type of types) {
        if (genre[type] !== null) add(type, genre[type]);
      }
    }
  }

  // Nothing to search: every chosen category only exists for a type that is left out (Kids has no movies).
  if (wanted.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const pagesEach = wanted.length >= 4 ? 1 : 2;
  const lists = await Promise.allSettled(
    wanted.map(async ({ type, genreId }, i) => {
      // Alternate between what's popular and what's best rated.
      const popular = i % 2 === 0;
      const dateField = type === "movie" ? "primary_release_date" : "first_air_date";
      const pages = await Promise.all(
        Array.from({ length: pagesEach }, (_, n) =>
          tmdbFetch<{ results: RawResult[] }>(
            `/discover/${type}`,
            {
              ...(genreId !== null && { with_genres: String(genreId) }),
              // Talk, news, reality and soap shows would otherwise fill the Comedy and Drama series.
              ...(type === "tv" && { without_genres: "10763,10764,10766,10767" }),
              ...(type === "movie" && maxRuntime !== null && { "with_runtime.lte": String(maxRuntime) }),
              [`${dateField}.lte`]: today,
              include_adult: "false",
              sort_by: popular ? "popularity.desc" : "vote_average.desc",
              "vote_count.gte": popular ? "100" : type === "movie" ? "400" : "150",
              page: String(1 + ((pageFor(seed, i, 4) - 1 + n) % 4)),
            },
            3600,
          ).then((data) => normalizeMany(data.results, type)),
        ),
      );
      return pages.flat();
    }),
  );

  const fulfilled = lists.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (fulfilled.length === 0) {
    const failed = lists.find((r) => r.status === "rejected");
    throw failed?.status === "rejected" ? failed.reason : new Error("No suggestions");
  }
  const posters = fulfilled.map((list) => list.filter((item) => item.posterPath));
  const seenTitles = new Set<string>();
  return interleave(posters).filter((item) => {
    const key = `${item.mediaType}:${item.tmdbId}`;
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });
}

/** TMDB's "if you liked this" titles for one movie or series. */
export async function getRecommendations(
  mediaType: MediaType,
  tmdbId: number,
  page = 1,
): Promise<TmdbItem[]> {
  const data = await tmdbFetch<{ results: RawResult[] }>(
    `/${mediaType}/${tmdbId}/recommendations`,
    { page: String(page) },
    86_400,
  );
  return normalizeMany(data.results, mediaType);
}

/**
 * Titles like one a family loved, for a movie night: TMDB's recommendations (two pages), already released and with
 * a poster. Throws if TMDB can't be reached.
 */
export async function getLikeSuggestions(mediaType: MediaType, tmdbId: number): Promise<TmdbItem[]> {
  const [first, second] = await Promise.allSettled([
    getRecommendations(mediaType, tmdbId, 1),
    getRecommendations(mediaType, tmdbId, 2),
  ]);
  if (first.status === "rejected") throw first.reason;
  const thisYear = new Date().getFullYear();
  const seen = new Set<number>();
  return [...first.value, ...(second.status === "fulfilled" ? second.value : [])].filter((item) => {
    if (!item.posterPath || (item.year !== null && item.year > thisYear) || seen.has(item.tmdbId)) return false;
    seen.add(item.tmdbId);
    return true;
  });
}

/** How many similar titles a title's page offers. */
const MAX_SIMILAR = 20;

/**
 * Full details for a single title, including its trailer. With `extras` the same single TMDB call also brings the
 * cast and crew, the age rating, the collection and the titles TMDB recommends, for a title's own page; everything
 * else (saving a title, building a stack of dozens of cards) keeps the light call.
 */
export async function getMediaDetails(mediaType: MediaType, tmdbId: number): Promise<TmdbDetails>;
export async function getMediaDetails(
  mediaType: MediaType,
  tmdbId: number,
  options: { extras: true },
): Promise<TmdbDetails & { extras: TmdbExtras }>;
export async function getMediaDetails(
  mediaType: MediaType,
  tmdbId: number,
  options: { extras?: boolean } = {},
): Promise<TmdbDetails & { extras?: TmdbExtras }> {
  const append = options.extras
    ? `videos,credits,recommendations,${mediaType === "tv" ? "content_ratings" : "release_dates"}`
    : "videos";
  const raw = await tmdbFetch<RawDetails>(
    `/${mediaType}/${tmdbId}`,
    { append_to_response: append },
    // A series gains episodes as it airs, so what is known of it is kept for less time than a movie's.
    mediaType === "tv" ? 3600 : 86_400,
  );

  const base = normalize({ ...raw, media_type: mediaType });
  if (!base) throw new Error("Unexpected TMDB media type");

  const trailer =
    raw.videos?.results.find(
      (v) => v.site === "YouTube" && v.type === "Trailer",
    ) ?? raw.videos?.results.find((v) => v.site === "YouTube");

  const runtime =
    raw.runtime ??
    (raw.episode_run_time && raw.episode_run_time.length > 0
      ? raw.episode_run_time[0]
      : null);

  const details: TmdbDetails = {
    ...base,
    genres: raw.genres?.map((g) => g.name) ?? [],
    runtime,
    trailerKey: trailer?.key ?? null,
    series: mediaType === "tv" ? seriesFromTmdb(raw) : null,
  };
  if (!options.extras) return details;

  const similar = normalizeMany(raw.recommendations?.results ?? [], mediaType)
    .filter((item) => item.posterPath && !(item.mediaType === mediaType && item.tmdbId === tmdbId))
    .slice(0, MAX_SIMILAR);
  return {
    ...details,
    extras: {
      ...titleExtrasFrom(mediaType, raw),
      similar,
      similarHasMore: hasMorePages(1, raw.recommendations?.total_pages),
    },
  };
}

/** The films of a collection (a series of films), oldest first, and its name; cached for a day. */
export async function getCollection(id: number): Promise<{ name: string; items: TmdbItem[] }> {
  const raw = await tmdbFetch<{ name?: string; parts?: RawResult[] }>(`/collection/${id}`, {}, 86_400);
  const items = normalizeMany(raw.parts ?? [], "movie")
    .filter((item) => item.posterPath)
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title));
  return { name: raw.name?.trim() || "", items };
}

/** One episode of a season, as the series page lists it. */
export interface TmdbEpisode {
  number: number;
  name: string;
  /** YYYY-MM-DD, or null when TMDB has no date yet. */
  airDate: string | null;
  runtime: number | null;
  overview: string;
  stillPath: string | null;
}

interface RawEpisode {
  episode_number?: number;
  name?: string;
  air_date?: string | null;
  runtime?: number | null;
  overview?: string;
  still_path?: string | null;
}

/** The episodes of one season of a series, in order (cached for an hour: an airing show gains episodes). */
export async function getSeasonEpisodes(tmdbId: number, season: number): Promise<TmdbEpisode[]> {
  const raw = await tmdbFetch<{ episodes?: RawEpisode[] }>(`/tv/${tmdbId}/season/${season}`, {}, 3600);
  return (raw.episodes ?? [])
    .filter((e): e is RawEpisode & { episode_number: number } => Number.isInteger(e.episode_number) && (e.episode_number ?? 0) >= 1)
    .map((e) => ({
      number: e.episode_number,
      name: e.name?.trim() || `Episode ${e.episode_number}`,
      airDate: typeof e.air_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.air_date) ? e.air_date : null,
      runtime: typeof e.runtime === "number" && e.runtime > 0 ? e.runtime : null,
      overview: e.overview?.trim() ?? "",
      stillPath: e.still_path ?? null,
    }))
    .sort((a, b) => a.number - b.number);
}

/** Map TMDB details into a row for our `media` cache table. */
export function detailsToMediaRow(details: TmdbDetails) {
  return {
    tmdb_id: details.tmdbId,
    media_type: details.mediaType,
    title: details.title,
    release_year: details.year,
    poster_path: details.posterPath,
    backdrop_path: details.backdropPath,
    overview: details.overview,
    tmdb_rating: details.voteAverage,
    runtime: details.runtime,
    genres: details.genres,
    trailer_key: details.trailerKey,
    series: details.series ? seriesToJson(details.series) : null,
    updated_at: new Date().toISOString(),
  };
}
