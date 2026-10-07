import type { MediaType, ReactionValue, SortKey } from "@/lib/types";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently added" },
  { value: "most_liked", label: "Most liked" },
  { value: "top_rated", label: "Top rated" },
  { value: "recently_watched", label: "Recently watched" },
  { value: "title", label: "Title (A–Z)" },
];

export const REACTIONS: ReactionValue[] = ["like", "dislike"];

export function mediaTypeLabel(type: MediaType): string {
  return type === "tv" ? "Series" : "Movie";
}

export function libraryKey(type: MediaType, tmdbId: number): string {
  return `${type}:${tmdbId}`;
}
