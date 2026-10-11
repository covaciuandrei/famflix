import "server-only";

import type { Decade } from "@/lib/decades";
import { findGenre, type BrowseGenre } from "@/lib/genres";
import { interleave } from "@/lib/deck-compose";
import { seriesFromTmdb, seriesToJson, type RawSeries, type SeriesInfo } from "@/lib/series";
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

export interface TmdbRow {
  title: string;
  items: TmdbItem[];
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

interface RawDetails extends RawResult, RawSeries {
  genres?: { id: number; name: string }[];
  runtime?: number;
  episode_run_time?: number[];
  videos?: { results: { key: string; site: string; type: string }[] };
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

/** Curated browse rows for the discover page. */
export async function getBrowseRows(): Promise<TmdbRow[]> {
  const [trending, popularMovies, popularTv, topMovies, topTv] =
    await Promise.all([
      tmdbFetch<{ results: RawResult[] }>("/trending/all/week", {}, 3600),
      tmdbFetch<{ results: RawResult[] }>("/movie/popular", {}, 3600),
      tmdbFetch<{ results: RawResult[] }>("/tv/popular", {}, 3600),
      tmdbFetch<{ results: RawResult[] }>("/movie/top_rated", {}, 3600),
      tmdbFetch<{ results: RawResult[] }>("/tv/top_rated", {}, 3600),
    ]);

  return [
    { title: "Trending this week", items: normalizeMany(trending.results) },
    {
      title: "Popular movies",
      items: normalizeMany(popularMovies.results, "movie"),
    },
    { title: "Popular series", items: normalizeMany(popularTv.results, "tv") },
    {
      title: "Top rated movies",
      items: normalizeMany(topMovies.results, "movie"),
    },
    { title: "Top rated series", items: normalizeMany(topTv.results, "tv") },
  ];
}

/** Popular and top rated movies and series in a Browse category, release decade, or both. */
export async function getDiscoverRows({
  genre,
  decade,
}: {
  genre: BrowseGenre | null;
  decade: Decade | null;
}): Promise<TmdbRow[]> {
  const what = genre ? `${genre.label.toLowerCase()} ` : "";
  const when = !decade
    ? ""
    : decade.from === null
      ? ` from before ${decade.to + 1}`
      : ` from the ${decade.label}`;

  const discover = (mediaType: MediaType, params: Record<string, string>) => {
    const genreId = genre ? genre[mediaType] : null;
    const dateField =
      mediaType === "movie" ? "primary_release_date" : "first_air_date";
    return tmdbFetch<{ results: RawResult[] }>(
      `/discover/${mediaType}`,
      {
        ...(genreId !== null && { with_genres: String(genreId) }),
        // Talk, news, reality and soap shows would otherwise fill the Comedy and Drama series rows.
        ...(mediaType === "tv" && { without_genres: "10763,10764,10766,10767" }),
        ...(decade?.from != null && { [`${dateField}.gte`]: `${decade.from}-01-01` }),
        ...(decade?.to != null && { [`${dateField}.lte`]: `${decade.to}-12-31` }),
        include_adult: "false",
        page: "1",
        ...params,
      },
      3600,
    ).then((data) => normalizeMany(data.results, mediaType));
  };
  // Vote minimums keep out obscure titles and ones rated by a handful of people.
  const popular = { sort_by: "popularity.desc", "vote_count.gte": "100" };
  const topRated = (minVotes: number) => ({
    sort_by: "vote_average.desc",
    "vote_count.gte": String(minVotes),
  });

  const movies = !genre || genre.movie !== null;
  const series = !genre || genre.tv !== null;
  const rows: { title: string; items: Promise<TmdbItem[]> }[] = [];
  if (movies) {
    rows.push({
      title: `Popular ${what}movies${when}`,
      items: discover("movie", popular),
    });
  }
  if (series) {
    rows.push({
      title: `Popular ${what}series${when}`,
      items: discover("tv", popular),
    });
  }
  if (movies) {
    rows.push({
      title: `Top rated ${what}movies${when}`,
      items: discover("movie", topRated(1000)),
    });
  }
  if (series) {
    rows.push({
      title: `Top rated ${what}series${when}`,
      items: discover("tv", topRated(300)),
    });
  }
  return Promise.all(
    rows.map(async (r) => ({ title: r.title, items: await r.items })),
  );
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

/** Full details for a single title, including its trailer. */
export async function getMediaDetails(
  mediaType: MediaType,
  tmdbId: number,
): Promise<TmdbDetails> {
  const raw = await tmdbFetch<RawDetails>(
    `/${mediaType}/${tmdbId}`,
    { append_to_response: "videos" },
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

  return {
    ...base,
    genres: raw.genres?.map((g) => g.name) ?? [],
    runtime,
    trailerKey: trailer?.key ?? null,
    series: mediaType === "tv" ? seriesFromTmdb(raw) : null,
  };
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
