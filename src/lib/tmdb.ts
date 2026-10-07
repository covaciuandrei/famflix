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
    throw new Error(`TMDB request failed (${res.status}) for ${path}`);
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
