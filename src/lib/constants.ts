import type { MediaType, SortKey } from "@/lib/types";

/** Where the app opens (after signing in, from the logo, or from /app): the first tab of the menu. */
export const APP_HOME = "/app/browse";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently added" },
  { value: "most_liked", label: "Most liked" },
  { value: "top_rated", label: "Top rated" },
  { value: "recently_watched", label: "Recently watched" },
  { value: "title", label: "Title (A–Z)" },
];

export function mediaTypeLabel(type: MediaType): string {
  return type === "tv" ? "Series" : "Movie";
}

export function libraryKey(type: MediaType, tmdbId: number): string {
  return `${type}:${tmdbId}`;
}
