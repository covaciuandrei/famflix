/**
 * Watching a title more than once: how many times, on which days, and whether it can be watched again. Pure and
 * client-safe, so the cards, the title page and the unit tests all use the same rules.
 *
 * A viewing is one person watching one title on one day. The current viewing is what the list shows (the family's
 * watch record, or the My list entry); earlier ones are in the watch history. Watching a title twice on one day counts
 * once, and a viewing that is both in the history and still current (a family one on My list) counts once.
 */

import { dayOf } from "@/lib/day";
import { isWatchedTogether } from "@/lib/list-status";
import { parseSeriesInfo } from "@/lib/series";
import type { EarlierViewing, ListItemCard } from "@/lib/types";

/** A row of the watch history, as the loaders read it. */
export interface HistoryRow {
  user_id: string;
  media_id: string;
  /** Null for a viewing nobody remembers the day of. */
  watched_on: string | null;
}

/**
 * One title's history rows as viewings: one per day, newest first, with who watched that day. Then the viewings with no
 * day, each of its own (nothing says two of them are the same one).
 */
export function groupEarlier(rows: { user_id: string; watched_on: string | null }[]): EarlierViewing[] {
  const days = new Map<string, Set<string>>();
  const unknown: EarlierViewing[] = [];
  for (const r of rows) {
    if (r.watched_on === null) {
      unknown.push({ on: null, userIds: [r.user_id] });
      continue;
    }
    const day = r.watched_on.slice(0, 10);
    const people = days.get(day) ?? new Set<string>();
    people.add(r.user_id);
    days.set(day, people);
  }
  const dated = [...days]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([on, people]) => ({ on, userIds: [...people].sort() }));
  return [...dated, ...unknown];
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

/** The viewing the list shows right now, as days (none when it is not known) and (on a family list) the people on them. */
function currentViewings(card: ListItemCard): { on: string | null; userId: string | null }[] {
  if (!isWatchedNow(card)) return [];
  if (card.item.group_id) return card.viewers.map((v) => ({ on: v.watched_on.slice(0, 10), userId: v.user_id }));
  return [{ on: dayOf(card.item.watched_at), userId: null }];
}

/** How many times the title has been watched: the days it was watched on, and every viewing with no day. */
export function timesWatched(card: ListItemCard): number {
  const days = new Set<string>();
  let unknown = 0;
  for (const { on } of [...currentViewings(card), ...card.earlier]) {
    if (on === null) unknown++;
    else days.add(on);
  }
  return days.size + unknown;
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
  return isEpisodeSeries(card) ? seriesChip(card) : chipText(timesWatched(card), isWatchedNow(card));
}

/** A series on My list that is followed by episode and has been started again: how many times through it is. */
function seriesChip(card: ListItemCard): string | null {
  if (card.passes === 0) return null;
  if (card.item.status === "watched") return `Watched ${card.passes + 1}×`;
  if ((card.series?.watched ?? 0) > 0) return `Watching again · pass ${card.passes + 1}`;
  return chipText(card.passes, false);
}

/** A series on My list that is marked Watched can be started again, from its card as from its page. */
export function canStartSeriesAgain(card: ListItemCard): boolean {
  return isEpisodeSeries(card) && card.item.status === "watched";
}

/** One line of a title's viewings: the day (none when it is not known), and on a family list who watched. */
export interface ViewingLine {
  on: string | null;
  /** Names, you first; empty on My list. */
  who: string[];
}

/** Viewings as lines: one per day, newest first, with who was there; then one for each viewing with no day. */
function toLines(
  viewings: { on: string | null; userId: string | null }[],
  family: boolean,
  me: string,
  nameOf: (userId: string) => string,
): ViewingLine[] {
  const names = (ids: Iterable<string>) =>
    [...ids]
      .sort((a, b) => (a === me ? -1 : b === me ? 1 : nameOf(a).localeCompare(nameOf(b))))
      .map((id) => (id === me ? "You" : nameOf(id)));
  const days = new Map<string, Set<string>>();
  const unknown: ViewingLine[] = [];
  for (const { on, userId } of viewings) {
    const who = family && userId ? [userId] : [];
    if (on === null) {
      unknown.push({ on: null, who: names(who) });
      continue;
    }
    const people = days.get(on) ?? new Set<string>();
    for (const id of who) people.add(id);
    days.set(on, people);
  }
  const dated = [...days].sort(([a], [b]) => b.localeCompare(a)).map(([on, people]) => ({ on, who: names(people) }));
  return [...dated, ...unknown];
}

/** Every viewing of the title, newest first. `nameOf` gives a family member's name (and is only used on family lists). */
export function viewingLines(
  card: ListItemCard,
  me: string,
  nameOf: (userId: string) => string,
): ViewingLine[] {
  // A series followed by episode has its days by episode, on its page.
  if (isEpisodeSeries(card)) return [];
  const earlier = card.earlier.flatMap((e) => e.userIds.map((userId) => ({ on: e.on, userId })));
  return toLines([...currentViewings(card), ...earlier], card.item.group_id !== null, me, nameOf);
}

/** The viewing the list shows right now, as lines: its day (or none) and, on a family list, who watched on it. */
export function currentViewingLines(
  card: ListItemCard,
  me: string,
  nameOf: (userId: string) => string,
): ViewingLine[] {
  return toLines(currentViewings(card), card.item.group_id !== null, me, nameOf);
}

/**
 * The same for one person's own viewings of a title (its page): the day it is watched now, if it is (`on` is null when
 * nobody remembers it), and the earlier ones. The chip is null when there is nothing to say.
 */
export function myViewings(
  current: { on: string | null } | null,
  earlier: EarlierViewing[],
): { chip: string | null; lines: ViewingLine[] } {
  const lines = toLines(
    [...(current ? [current] : []), ...earlier].map(({ on }) => ({ on, userId: null })),
    false,
    "",
    () => "",
  );
  return { chip: chipText(lines.length, current !== null), lines };
}
