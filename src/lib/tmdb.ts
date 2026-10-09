import "server-only";

import type { Decade } from "@/lib/decades";
import type { BrowseGenre } from "@/lib/genres";
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

interface RawDetails extends RawResult {
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

/** Search movies and TV shows by title. */
export async function searchMedia(query: string): Promise<TmdbItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const data = await tmdbFetch<{ results: RawResult[] }>(
    "/search/multi",
    { query: trimmed, include_adult: "false", page: "1" },
    600,
  );
  return normalizeMany(data.results);
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

/** TMDB's "if you liked this" titles for one movie or series. */
export async function getRecommendations(
  mediaType: MediaType,
  tmdbId: number,
): Promise<TmdbItem[]> {
  const data = await tmdbFetch<{ results: RawResult[] }>(
    `/${mediaType}/${tmdbId}/recommendations`,
    { page: "1" },
    86_400,
  );
  return normalizeMany(data.results, mediaType);
}

/** Full details for a single title, including its trailer. */
export async function getMediaDetails(
  mediaType: MediaType,
  tmdbId: number,
): Promise<TmdbDetails> {
  const raw = await tmdbFetch<RawDetails>(
    `/${mediaType}/${tmdbId}`,
    { append_to_response: "videos" },
    86_400,
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
  };
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
    updated_at: new Date().toISOString(),
  };
}
