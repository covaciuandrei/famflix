import type { ListItemCard, SortKey } from "@/lib/types";

/** Sort watchlist cards by the chosen key (pure; safe on client and server). */
export function sortCards(
  cards: ListItemCard[],
  sort: SortKey,
): ListItemCard[] {
  const copy = [...cards];
  switch (sort) {
    case "most_liked":
      copy.sort(
        (a, b) =>
          b.likeCount - b.dislikeCount - (a.likeCount - a.dislikeCount) ||
          b.likeCount - a.likeCount,
      );
      break;
    case "top_rated":
      copy.sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
      break;
    case "recently_watched":
      copy.sort(
        (a, b) =>
          (b.item.watched_at ? Date.parse(b.item.watched_at) : 0) -
          (a.item.watched_at ? Date.parse(a.item.watched_at) : 0),
      );
      break;
    case "title":
      copy.sort((a, b) => a.media.title.localeCompare(b.media.title));
      break;
    case "recent":
    default:
      copy.sort(
        (a, b) => Date.parse(b.item.created_at) - Date.parse(a.item.created_at),
      );
      break;
  }
  return copy;
}
