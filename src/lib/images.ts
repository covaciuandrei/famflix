/** Client-safe TMDB image URL helpers (no server-only dependencies). */

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export type PosterSize = "w92" | "w154" | "w185" | "w342" | "w500" | "original";
export type BackdropSize = "w300" | "w780" | "w1280" | "original";

export function tmdbImage(
  path: string | null | undefined,
  size: PosterSize | BackdropSize = "w342",
): string | null {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
}
