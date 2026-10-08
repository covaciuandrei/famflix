import type { ListItemCard } from "@/lib/types";

export interface Category {
  value: string;
  label: string;
  count: number;
}

/** "All", then Movies/Series when the list has both, then each genre, most common first. */
export function listCategories(cards: ListItemCard[]): Category[] {
  const genreCounts = new Map<string, number>();
  for (const card of cards) {
    for (const genre of card.media.genres) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
  }
  const movies = cards.filter((c) => c.media.media_type === "movie").length;
  const series = cards.length - movies;

  const result: Category[] = [{ value: "all", label: "All", count: cards.length }];
  if (movies > 0 && series > 0) {
    result.push(
      { value: "type:movie", label: "Movies", count: movies },
      { value: "type:tv", label: "Series", count: series },
    );
  }
  [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([genre, count]) =>
      result.push({ value: `genre:${genre}`, label: genre, count }),
    );
  return result;
}

export function matchesCategory(card: ListItemCard, category: string): boolean {
  if (category === "all") return true;
  if (category.startsWith("type:")) {
    return card.media.media_type === category.slice("type:".length);
  }
  return card.media.genres.includes(category.slice("genre:".length));
}
