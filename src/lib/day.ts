/**
 * Days, as the app handles them: a viewing is on a day (YYYY-MM-DD, in the person's own time), or on no day at all when
 * nobody remembers it. Pure and client-safe, so the browser, the server and the unit tests use the same rules.
 */

/** A real calendar day written as YYYY-MM-DD (not 2026-13-45). */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Today in the person's own time. */
export function localDay(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA");
}

/**
 * The moment saved for "watched on this day": noon UTC, so that the day reads the same in every time zone (its first ten
 * characters are the day).
 */
export function watchedAtFor(day: string): string {
  return `${day}T12:00:00.000Z`;
}

/** The day a saved moment stands for; null for none (a title watched on a day nobody remembers). */
export function dayOf(watchedAt: string | null | undefined): string | null {
  return watchedAt ? watchedAt.slice(0, 10) : null;
}

/**
 * Whether a day is later than it can be anywhere on Earth right now, which is more than a day ahead of UTC's today (the
 * person and the server can be on different days, so tomorrow still passes).
 */
export function isTooLate(day: string, now: number = Date.now()): boolean {
  return day > new Date(now + 86_400_000).toISOString().slice(0, 10);
}

/**
 * The day to save from what a person picked: nothing when they don't remember (null), else the day, which has to be a real
 * one that isn't in the future. Returns the problem as text when it can't be saved.
 */
export function readPickedDay(picked: unknown): { day: string | null } | { error: string } {
  if (picked === null) return { day: null };
  if (!isDay(picked)) return { error: "That day isn't valid." };
  if (isTooLate(picked)) return { error: "Pick a day that is not in the future." };
  return { day: picked };
}
