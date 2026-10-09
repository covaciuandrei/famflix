/**
 * The genre categories used to browse and to pick a mood for a movie night. Client-safe (no server-only imports), so
 * client components can use it too.
 */

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

export function findGenre(slug: string | undefined): BrowseGenre | null {
  return BROWSE_GENRES.find((g) => g.slug === slug) ?? null;
}

/**
 * The genre names TMDB gives titles that belong to a category. Series use broader names, so "Action" also matches a
 * series' "Action & Adventure", and "Science Fiction" matches "Sci-Fi & Fantasy".
 */
const GENRE_NAMES: Record<BrowseGenre["slug"], readonly string[]> = {
  action: ["Action", "Action & Adventure"],
  adventure: ["Adventure", "Action & Adventure"],
  animation: ["Animation"],
  comedy: ["Comedy"],
  crime: ["Crime"],
  documentary: ["Documentary"],
  drama: ["Drama"],
  family: ["Family"],
  fantasy: ["Fantasy", "Sci-Fi & Fantasy"],
  history: ["History"],
  horror: ["Horror"],
  kids: ["Kids"],
  music: ["Music"],
  mystery: ["Mystery"],
  romance: ["Romance"],
  "science-fiction": ["Science Fiction", "Sci-Fi & Fantasy"],
  thriller: ["Thriller"],
  war: ["War", "War & Politics"],
  western: ["Western"],
};

/** Whether a title's genre names (as saved from TMDB) fall under a category. */
export function matchesGenreSlug(titleGenres: readonly string[], slug: string): boolean {
  const names = GENRE_NAMES[slug as BrowseGenre["slug"]];
  return names ? titleGenres.some((g) => names.includes(g)) : false;
}

/** True when a title belongs to at least one of the categories (no categories means anything goes). */
export function matchesAnyGenre(titleGenres: readonly string[], slugs: readonly string[]): boolean {
  return slugs.length === 0 || slugs.some((slug) => matchesGenreSlug(titleGenres, slug));
}

/** The category slugs, for checking input that came from the browser. */
export const GENRE_SLUGS: readonly string[] = BROWSE_GENRES.map((g) => g.slug);
