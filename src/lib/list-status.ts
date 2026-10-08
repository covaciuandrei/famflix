import type { ListItemCard } from "@/lib/types";

/**
 * A family title the family has logged as watched together. Unmarking Watched undoes it,
 * which puts the title back on To watch.
 */
export function isWatchedTogether(card: ListItemCard): boolean {
  return card.item.status === "watched" && card.viewers.length > 0;
}

/**
 * Still to watch. On family lists that means not yet watched together, so a title one
 * person marked Watched on their own stays on the family's list; My list uses Watched.
 */
export function isToWatch(card: ListItemCard): boolean {
  return card.item.group_id
    ? !isWatchedTogether(card)
    : card.item.status === "want";
}
