/**
 * The filters on the Browse page, which live in the address (?type=tv&decade=2010s&genre=drama) so a filtered page can
 * be shared and the back button works. Client-safe (no server-only imports).
 */
import { findDecade, type Decade } from "@/lib/decades";
import { BROWSE_GENRES, findGenre, type BrowseGenre } from "@/lib/genres";
import type { MediaType } from "@/lib/types";

/** The Type filter: movies or series (no type at all means both). */
export const BROWSE_TYPES = [
  { value: "movie", label: "Movies" },
  { value: "tv", label: "Series" },
] as const satisfies readonly { value: MediaType; label: string }[];

export function findBrowseType(value: string | undefined): MediaType | null {
  return BROWSE_TYPES.find((t) => t.value === value)?.value ?? null;
}

/** The categories there are for a type: TMDB has no Horror series, and no Kids movies. */
export function genresFor(type: MediaType | null): readonly BrowseGenre[] {
  return type === null ? BROWSE_GENRES : BROWSE_GENRES.filter((g) => g[type] !== null);
}

export interface BrowseFilters {
  type: MediaType | null;
  genre: BrowseGenre | null;
  decade: Decade | null;
}

type Param = string | string[] | undefined;

/**
 * Reads the filters from the address, keeping only what makes sense: an unknown value, or a repeated one, is no filter,
 * and a category the chosen type doesn't have is dropped (so a hand-made address can't lead to a page with nothing).
 */
export function parseBrowseFilters(params: { type?: Param; genre?: Param; decade?: Param }): BrowseFilters {
  const type = typeof params.type === "string" ? findBrowseType(params.type) : null;
  const genre = typeof params.genre === "string" ? findGenre(params.genre) : null;
  return {
    type,
    genre: genre && (type === null || genre[type] !== null) ? genre : null,
    decade: typeof params.decade === "string" ? findDecade(params.decade) : null,
  };
}

/** The address of Browse with these filters (the empty ones are left out). */
export function browseHref({
  type,
  genre,
  decade,
}: {
  type?: MediaType | null;
  genre?: string | null;
  decade?: string | null;
}): string {
  const query = new URLSearchParams();
  if (type) query.set("type", type);
  if (genre) query.set("genre", genre);
  if (decade) query.set("decade", decade);
  return query.size ? `/app/browse?${query}` : "/app/browse";
}
