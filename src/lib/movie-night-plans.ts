/**
 * Planned movie nights on the page: what the database tells (see planned_movie_nights() and due_movie_night_plans()),
 * how the answers are counted and worded, the times a person types and the windows of the in-app reminders. Pure and
 * client-safe, so the pages and the unit tests share one set of rules.
 */

export type PlanAnswer = "going" | "maybe" | "no";
export type PlanStatus = "planned" | "started" | "cancelled" | "expired";

export const PLAN_ANSWERS: readonly PlanAnswer[] = ["going", "maybe", "no"];
export const ANSWER_LABEL: Record<PlanAnswer, string> = { going: "Going", maybe: "Maybe", no: "Can't" };

export const MAX_PLAN_NOTE = 100;
/** A family has at most this many planned at a time. */
export const MAX_PLANNED = 5;

/** The reminders (the database's due_movie_night_plans() uses the same window): from this long before, to this long after. */
export const REMIND_BEFORE_MINUTES = 60;
export const REMIND_AFTER_HOURS = 3;
/** The invite window that opens by itself comes later than the dot and the banner. */
export const POPUP_BEFORE_MINUTES = 15;

const MINUTE = 60_000;
const HOUR = 3_600_000;

export interface PlanPerson {
  user_id: string;
  name: string;
  answer: PlanAnswer;
}

export interface PlannedNight {
  id: string;
  /** The moment it is planned for, as an ISO instant. */
  starts_at: string;
  note: string | null;
  /** The mood's category slugs. */
  genres: string[];
  status: PlanStatus;
  created_by: string | null;
  created_by_name: string | null;
  ended_at: string | null;
  /** What the signed-in person answered, if they did. */
  my_answer: PlanAnswer | null;
  answers: PlanPerson[];
}

/** A plan to remind someone of (from due_movie_night_plans()). */
export interface DuePlan {
  id: string;
  group_id: string;
  group_name: string;
  starts_at: string;
  note: string | null;
  my_answer: PlanAnswer | null;
  going: number;
}

const isAnswer = (value: unknown): value is PlanAnswer => PLAN_ANSWERS.includes(value as PlanAnswer);
const isStatus = (value: unknown): value is PlanStatus =>
  value === "planned" || value === "started" || value === "cancelled" || value === "expired";
const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isInstant = (value: unknown): value is string => isString(value) && Number.isFinite(Date.parse(value));
const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Reads what planned_movie_nights() returned, leaving out anything that isn't a plan (an answer it doesn't know, a row with no id). */
export function parsePlans(value: unknown): PlannedNight[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): PlannedNight[] => {
    const row = asObject(raw);
    if (!row || !isString(row.id) || !isInstant(row.starts_at) || !isStatus(row.status)) return [];
    const answers = Array.isArray(row.answers)
      ? row.answers.flatMap((a): PlanPerson[] => {
          const person = asObject(a);
          return person && isString(person.user_id) && isAnswer(person.answer)
            ? [{ user_id: person.user_id, name: typeof person.name === "string" ? person.name : "Someone", answer: person.answer }]
            : [];
        })
      : [];
    return [
      {
        id: row.id,
        starts_at: row.starts_at,
        note: isString(row.note) ? row.note : null,
        genres: Array.isArray(row.genres) ? row.genres.filter(isString) : [],
        status: row.status,
        created_by: isString(row.created_by) ? row.created_by : null,
        created_by_name: isString(row.created_by_name) ? row.created_by_name : null,
        ended_at: isInstant(row.ended_at) ? row.ended_at : null,
        my_answer: isAnswer(row.my_answer) ? row.my_answer : null,
        answers,
      },
    ];
  });
}

/** Reads what due_movie_night_plans() returned. */
export function parseDuePlans(value: unknown): DuePlan[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): DuePlan[] => {
    const row = asObject(raw);
    if (!row || !isString(row.id) || !isString(row.group_id) || !isInstant(row.starts_at)) return [];
    return [
      {
        id: row.id,
        group_id: row.group_id,
        group_name: typeof row.group_name === "string" ? row.group_name : "your family",
        starts_at: row.starts_at,
        note: isString(row.note) ? row.note : null,
        my_answer: isAnswer(row.my_answer) ? row.my_answer : null,
        going: typeof row.going === "number" && Number.isFinite(row.going) ? row.going : 0,
      },
    ];
  });
}

/** How many answered each way. */
export function tally(answers: readonly { answer: PlanAnswer }[]): Record<PlanAnswer, number> {
  const counts: Record<PlanAnswer, number> = { going: 0, maybe: 0, no: 0 };
  for (const a of answers) counts[a.answer] += 1;
  return counts;
}

/** "3 going · 1 maybe · 1 can't", leaving out what nobody said; "No answers yet" when nobody has. */
export function rsvpSummary(answers: readonly { answer: PlanAnswer }[]): string {
  const counts = tally(answers);
  const parts = [
    counts.going > 0 ? `${counts.going} going` : null,
    counts.maybe > 0 ? `${counts.maybe} maybe` : null,
    counts.no > 0 ? `${counts.no} can't` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : "No answers yet";
}

/** The names under each answer (Going first), the signed-in person as "You" and first; answers nobody gave are left out. */
export function peopleByAnswer(
  answers: readonly PlanPerson[],
  meId: string,
): { answer: PlanAnswer; names: string[] }[] {
  return PLAN_ANSWERS.flatMap((answer) => {
    const mine = answers.filter((a) => a.answer === answer && a.user_id === meId).map(() => "You");
    const others = answers
      .filter((a) => a.answer === answer && a.user_id !== meId)
      .map((a) => a.name)
      .sort((a, b) => a.localeCompare(b));
    const names = [...mine, ...others];
    return names.length > 0 ? [{ answer, names }] : [];
  });
}

/** The time of a plan has come (and not gone more than a day, after which the database calls it over). */
export function timeHasCome(startsAt: string, now: number): boolean {
  return Date.parse(startsAt) <= now;
}

/** Whether a plan is within the window of the dot on the menu and the banner: an hour before to 3 hours after (both ends in). */
export function inReminderWindow(startsAt: string, now: number): boolean {
  const at = Date.parse(startsAt);
  return Number.isFinite(at) && now >= at - REMIND_BEFORE_MINUTES * MINUTE && now <= at + REMIND_AFTER_HOURS * HOUR;
}

/** Whether the invite window may open by itself: from 15 minutes before to 3 hours after. */
export function inPopupWindow(startsAt: string, now: number): boolean {
  const at = Date.parse(startsAt);
  return Number.isFinite(at) && now >= at - POPUP_BEFORE_MINUTES * MINUTE && now <= at + REMIND_AFTER_HOURS * HOUR;
}

/** What a plan that is over is called on the page; null for one still planned (or started, which leaves the list). */
export function endedLabel(status: PlanStatus): string | null {
  if (status === "cancelled") return "Cancelled";
  if (status === "expired") return "Passed";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
//  The time someone types
// ---------------------------------------------------------------------------------------------------------------

const two = (n: number) => String(n).padStart(2, "0");

/** A date as a `datetime-local` field wants it: the local time to the minute, "2026-10-18T20:00". */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** The moment a `datetime-local` value means in the browser's own time zone, as an ISO instant; null when it isn't a time. */
export function localInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

/** Where a new plan starts: this evening at 20:00, or tomorrow's when that is less than two hours away. */
export function defaultPlanTime(now: Date): Date {
  const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0, 0, 0);
  if (evening.getTime() - now.getTime() < 2 * HOUR) evening.setDate(evening.getDate() + 1);
  return evening;
}

/** The earliest and latest a plan can be, as `datetime-local` values (the database allows up to a year ahead). */
export function planBounds(now: Date): { min: string; max: string } {
  const latest = new Date(now.getTime());
  latest.setFullYear(latest.getFullYear() + 1);
  return { min: toLocalInput(now), max: toLocalInput(latest) };
}

/** What is wrong with a time for a plan, in words, or null when it will do. */
export function planTimeProblem(iso: string | null, now: number): string | null {
  if (iso === null) return "Pick a day and a time.";
  const at = Date.parse(iso);
  if (at <= now) return "Pick a time in the future.";
  const limit = new Date(now);
  limit.setFullYear(limit.getFullYear() + 1);
  if (at > limit.getTime()) return "Plan a movie night within the next year.";
  return null;
}

export interface TimeFormat {
  /** What to write: the whole time ("Sat, Oct 18, 8:00 PM") or only the day ("Sat, Oct 18"). */
  kind: "full" | "day";
  /** For tests; people get their own. */
  locale?: string;
  timeZone?: string;
}

/** A moment in the person's own time zone and language: "Sat, Oct 18, 8:00 PM". Empty for something that isn't a moment. */
export function formatPlanTime(iso: string, { kind, locale, timeZone }: TimeFormat): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "";
  const options: Intl.DateTimeFormatOptions =
    kind === "day"
      ? { weekday: "short", day: "numeric", month: "short", timeZone }
      : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone };
  return new Intl.DateTimeFormat(locale, options).format(at);
}
