import "server-only";

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

export interface TmdbProvider {
  providerId: number;
  providerName: string;
  logoPath: string | null;
}

export interface TmdbDetails extends TmdbItem {
  genres: string[];
  runtime: number | null;
  trailerKey: string | null;
  watchProviders: TmdbProvider[];
  watchLink: string | null;
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
  "watch/providers"?: {
    results: Record<
      string,
      {
        link?: string;
        flatrate?: {
          provider_id: number;
          provider_name: string;
          logo_path: string | null;
        }[];
      }
    >;
  };
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

async function tmdbFetch<T>(
  path: string,
  params: Record<string, string> = {},
  revalidate = 3600,
): Promise<T> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/json",
    },
    next: { revalidate },
  });

  if (!res.ok) {
    throw new TmdbError(res.status, path);
  }
  return (await res.json()) as T;
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
    0,
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

/**
 * Browse categories with TMDB's genre ids (from /genre/movie/list and /genre/tv/list).
 * Series genres are broader ("Action & Adventure"), and some genres only exist for one type.
 */
export const BROWSE_GENRES = [
  { slug: "action", label: "Action", movie: 28, tv: 10759 },
  { slug: "adventure", label: "Adventure", movie: 12, tv: 10759 },
  { slug: "animation", label: "Animation", movie: 16, tv: 16 },
  { slug: "comedy", label: "Comedy", movie: 35, tv: 35 },
  { slug: "crime", label: "Crime", movie: 80, tv: 80 },
  { slug: "documentary", label: "Documentary", movie: 99, tv: 99 },
  { slug: "drama", label: "Drama", movie: 18, tv: 18 },
  { slug: "family", label: "Family", movie: 10751, tv: 10751 },
  { slug: "fantasy", label: "Fantasy", movie: 14, tv: 10765 },
  { slug: "history", label: "History", movie: 36, tv: null },
  { slug: "horror", label: "Horror", movie: 27, tv: null },
  { slug: "kids", label: "Kids", movie: null, tv: 10762 },
  { slug: "music", label: "Music", movie: 10402, tv: null },
  { slug: "mystery", label: "Mystery", movie: 9648, tv: 9648 },
  { slug: "romance", label: "Romance", movie: 10749, tv: null },
  { slug: "science-fiction", label: "Science Fiction", movie: 878, tv: 10765 },
  { slug: "thriller", label: "Thriller", movie: 53, tv: null },
  { slug: "war", label: "War", movie: 10752, tv: 10768 },
  { slug: "western", label: "Western", movie: 37, tv: 37 },
] as const satisfies readonly {
  slug: string;
  label: string;
  movie: number | null;
  tv: number | null;
}[];

export type BrowseGenre = (typeof BROWSE_GENRES)[number];

/** Popular and top rated movies and series in one Browse category. */
export async function getGenreRows(genre: BrowseGenre): Promise<TmdbRow[]> {
  const name = genre.label.toLowerCase();
  const discover = (
    mediaType: MediaType,
    id: number,
    params: Record<string, string>,
  ) =>
    tmdbFetch<{ results: RawResult[] }>(
      `/discover/${mediaType}`,
      {
        with_genres: String(id),
        // Talk, news, reality and soap shows would otherwise fill the Comedy and Drama series rows.
        ...(mediaType === "tv" && { without_genres: "10763,10764,10766,10767" }),
        include_adult: "false",
        page: "1",
        ...params,
      },
      3600,
    ).then((data) => normalizeMany(data.results, mediaType));
  // Vote minimums keep out obscure titles and ones rated by a handful of people.
  const popular = { sort_by: "popularity.desc", "vote_count.gte": "100" };
  const topRated = (minVotes: number) => ({
    sort_by: "vote_average.desc",
    "vote_count.gte": String(minVotes),
  });

  const rows: { title: string; items: Promise<TmdbItem[]> }[] = [];
  if (genre.movie !== null) {
    rows.push({
      title: `Popular ${name} movies`,
      items: discover("movie", genre.movie, popular),
    });
  }
  if (genre.tv !== null) {
    rows.push({
      title: `Popular ${name} series`,
      items: discover("tv", genre.tv, popular),
    });
  }
  if (genre.movie !== null) {
    rows.push({
      title: `Top rated ${name} movies`,
      items: discover("movie", genre.movie, topRated(1000)),
    });
  }
  if (genre.tv !== null) {
    rows.push({
      title: `Top rated ${name} series`,
      items: discover("tv", genre.tv, topRated(300)),
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

/** Full details for a single title, including trailer and streaming providers. */
export async function getMediaDetails(
  mediaType: MediaType,
  tmdbId: number,
  region = "US",
): Promise<TmdbDetails> {
  const raw = await tmdbFetch<RawDetails>(
    `/${mediaType}/${tmdbId}`,
    { append_to_response: "videos,watch/providers" },
    86_400,
  );

  const base = normalize({ ...raw, media_type: mediaType });
  if (!base) throw new Error("Unexpected TMDB media type");

  const trailer =
    raw.videos?.results.find(
      (v) => v.site === "YouTube" && v.type === "Trailer",
    ) ?? raw.videos?.results.find((v) => v.site === "YouTube");

  const providersForRegion = raw["watch/providers"]?.results?.[region];
  const watchProviders: TmdbProvider[] =
    providersForRegion?.flatrate?.map((p) => ({
      providerId: p.provider_id,
      providerName: p.provider_name,
      logoPath: p.logo_path ?? null,
    })) ?? [];

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
    watchProviders,
    watchLink: providersForRegion?.link ?? null,
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
