/**
 * Watching a title more than once: how many times, on which days, and whether it can be watched again. Pure and
 * client-safe, so the cards, the title page and the unit tests all use the same rules.
 *
 * A viewing is one person watching one title on one day. The current viewing is what the list shows (the family's
 * watch record, or the My list entry); earlier ones are in the watch history. Watching a title twice on one day counts
 * once, and a viewing that is both in the history and still current (a family one on My list) counts once.
 */

import { isWatchedTogether } from "@/lib/list-status";
import { parseSeriesInfo } from "@/lib/series";
import type { EarlierViewing, ListItemCard } from "@/lib/types";

/** A row of the watch history, as the loaders read it. */
export interface HistoryRow {
  user_id: string;
  media_id: string;
  watched_on: string;
}

/** One title's history rows as viewings: one per day, newest first, with who watched that day. */
export function groupEarlier(rows: { user_id: string; watched_on: string }[]): EarlierViewing[] {
  const days = new Map<string, Set<string>>();
  for (const r of rows) {
    const day = r.watched_on.slice(0, 10);
    const people = days.get(day) ?? new Set<string>();
    people.add(r.user_id);
    days.set(day, people);
  }
  return [...days]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([on, people]) => ({ on, userIds: [...people].sort() }));
}

/** Groups the history rows by title, so each card picks its own out. */
export function earlierByTitle(rows: HistoryRow[]): Map<string, EarlierViewing[]> {
  const byTitle = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const list = byTitle.get(r.media_id) ?? [];
    list.push(r);
    byTitle.set(r.media_id, list);
  }
  return new Map([...byTitle].map(([media, list]) => [media, groupEarlier(list)]));
}

/** A series on My list that is followed by episode: it is watched again from its page, by episode. */
export function isEpisodeSeries(card: ListItemCard): boolean {
  return !card.item.group_id && parseSeriesInfo(card.media.series) !== null;
}

/** Whether the title is watched right now: logged as watched together on a family list, marked Watched on My list. */
export function isWatchedNow(card: ListItemCard): boolean {
  return card.item.group_id ? isWatchedTogether(card) : card.item.status === "watched";
}

/** The viewing the list shows right now, as days and (on a family list) the people on them. */
function currentViewings(card: ListItemCard): { on: string; userId: string | null }[] {
  if (!isWatchedNow(card)) return [];
  if (card.item.group_id) return card.viewers.map((v) => ({ on: v.watched_on.slice(0, 10), userId: v.user_id }));
  return [{ on: (card.item.watched_at ?? card.item.created_at).slice(0, 10), userId: null }];
}

/** How many days the title has been watched on, the current viewing and the earlier ones together. */
export function timesWatched(card: ListItemCard): number {
  const days = new Set(currentViewings(card).map((v) => v.on));
  for (const e of card.earlier) days.add(e.on);
  return days.size;
}

/** A watched title can be put back on To watch, or logged again. */
export function canWatchAgain(card: ListItemCard): boolean {
  return isWatchedNow(card) && !isEpisodeSeries(card);
}

/** "Watched 3×" on a title that is watched now and was before; "Watch again · seen 2×" on one put back on To watch. */
export function chipText(times: number, watchedNow: boolean): string | null {
  if (watchedNow) return times >= 2 ? `Watched ${times}×` : null;
  if (times === 0) return null;
  return times === 1 ? "Watch again · seen once" : `Watch again · seen ${times}×`;
}

export function rewatchChip(card: ListItemCard): string | null {
  return isEpisodeSeries(card) ? null : chipText(timesWatched(card), isWatchedNow(card));
}

/** One line of a title's viewings: the day, and on a family list who watched. */
export interface ViewingLine {
  on: string;
  /** Names, you first; empty on My list. */
  who: string[];
}

/** Every viewing of the title, newest first. `nameOf` gives a family member's name (and is only used on family lists). */
export function viewingLines(
  card: ListItemCard,
  me: string,
  nameOf: (userId: string) => string,
): ViewingLine[] {
  const family = card.item.group_id !== null;
  const days = new Map<string, Set<string>>();
  const add = (on: string, userId: string | null) => {
    const people = days.get(on) ?? new Set<string>();
    if (family && userId) people.add(userId);
    days.set(on, people);
  };
  for (const v of currentViewings(card)) add(v.on, v.userId);
  for (const e of card.earlier) for (const userId of e.userIds) add(e.on, userId);

  return [...days]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([on, people]) => ({
      on,
      who: [...people]
        .sort((a, b) => (a === me ? -1 : b === me ? 1 : nameOf(a).localeCompare(nameOf(b))))
        .map((id) => (id === me ? "You" : nameOf(id))),
    }));
}

/**
 * The same for one person's own viewings of a title (its page): the day it is watched now, if it is, and the earlier
 * days. The chip is null when there is nothing to say.
 */
export function myViewings(
  current: string | null,
  earlier: EarlierViewing[],
): { chip: string | null; lines: ViewingLine[] } {
  const days = new Set(earlier.map((e) => e.on));
  if (current) days.add(current);
  return {
    chip: chipText(days.size, current !== null),
    lines: [...days].sort((a, b) => b.localeCompare(a)).map((on) => ({ on, who: [] })),
  };
}
