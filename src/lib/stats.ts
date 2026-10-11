/**
 * Stats for a family and for a person: what was watched (counting every viewing, so a film watched each Christmas counts
 * each year), for how long, what was liked, and who is alike. Pure and client-safe, so the pages, the share text and the
 * unit tests all use the same rules. Days are compared as `YYYY-MM-DD` text, never as moments, so a time zone can't move a
 * viewing into another year.
 */

/** A year, or null for all time. */
export type Period = number | null;

export interface StatTitle {
  /** Whatever tells titles apart (the media's id). */
  key: string;
  title: string;
  type: "movie" | "tv";
  /** Minutes: a movie's length, or a series' episode's length. */
  runtime: number | null;
  genres: string[];
}

/** One day a family watched a title, and who was there. */
export interface Viewing {
  on: string;
  userIds: string[];
}

export interface FamilyTitle extends StatTitle {
  /** Every day the family watched it, the current viewing and the earlier ones. */
  viewings: Viewing[];
  /** Every member's score for it. */
  scores: { userId: string; score: number }[];
  /** How many members like it (the reaction). */
  likes: number;
}

export interface FamilyInput {
  titles: FamilyTitle[];
  /** The days of the movie nights that ended with a title. */
  nights: string[];
  members: { id: string; name: string }[];
}

export interface ScoredTitle {
  title: string;
  /** The average of the scores, to one decimal. */
  average: number;
  scores: number;
}

export interface TastePair {
  a: string;
  b: string;
  /** 100 means they scored every title they share alike; 0 means as far apart as can be. */
  match: number;
  /** How many titles both scored. */
  shared: number;
}

export interface FamilyStats {
  period: Period;
  titles: number;
  viewings: number;
  /** Minutes spent on movies (a family series adds none). */
  minutes: number;
  nights: number;
  top: ScoredTitle[];
  mostLoved: { title: string; likes: number } | null;
  mostDivisive: (ScoredTitle & { low: number; high: number }) | null;
  genres: { genre: string; titles: number }[];
  busiestMonth: { month: string; viewings: number } | null;
  rewatched: { title: string; times: number }[];
  people: { id: string; name: string; titles: number; viewings: number }[];
  closest: TastePair | null;
  farthest: TastePair | null;
}

/** Whether a day (`YYYY-MM-DD`) is in a year, or any is when there is no year. */
export function inPeriod(day: string, period: Period): boolean {
  return period === null || day.slice(0, 4) === String(period);
}

/** The years that have a day in them, newest first (the picker's choices, before "All time"). */
export function yearsWithData(days: readonly string[]): number[] {
  const years = new Set<number>();
  for (const day of days) {
    if (/^\d{4}-\d{2}-\d{2}/.test(day)) years.add(Number(day.slice(0, 4)));
  }
  return [...years].sort((a, b) => b - a);
}

/** The viewings of one title as one list: each day once, with everybody who watched on it, oldest first. */
export function mergeViewings(...lists: readonly (readonly Viewing[])[]): Viewing[] {
  const days = new Map<string, Set<string>>();
  for (const list of lists) {
    for (const viewing of list) {
      const day = viewing.on.slice(0, 10);
      const people = days.get(day) ?? new Set<string>();
      viewing.userIds.forEach((id) => people.add(id));
      days.set(day, people);
    }
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([on, people]) => ({ on, userIds: [...people].sort() }));
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** How alike two people's scores are for the titles both scored: 100 x (1 - the mean difference / 9), as a whole number. */
export function tasteMatch(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.abs(a[i] - b[i]);
  return Math.round(100 * (1 - total / n / 9));
}

/** Taste is only told with this many titles in common: with fewer it is chance. */
export const MIN_SHARED_FOR_TASTE = 3;

/** Orders by a number (biggest first), then by title, so ties are always the same. */
const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);

/** The busiest month (`YYYY-MM`) among days, the earlier one when two tie; null when there are none. */
export function busiestMonth(days: readonly string[]): { month: string; viewings: number } | null {
  const months = new Map<string, number>();
  for (const day of days) months.set(day.slice(0, 7), (months.get(day.slice(0, 7)) ?? 0) + 1);
  let best: { month: string; viewings: number } | null = null;
  for (const [month, viewings] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
    if (!best || viewings > best.viewings) best = { month, viewings };
  }
  return best;
}

function topGenres(titles: readonly StatTitle[], limit = 5): { genre: string; titles: number }[] {
  const counts = new Map<string, number>();
  for (const t of titles) for (const genre of new Set(t.genres)) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  return [...counts]
    .map(([genre, count]) => ({ genre, titles: count }))
    .sort((a, b) => b.titles - a.titles || a.genre.localeCompare(b.genre))
    .slice(0, limit);
}

/** What a family watched in a year (or ever), from the titles it has and the viewings of each. */
export function familyStats(input: FamilyInput, period: Period): FamilyStats {
  const watched = input.titles
    .map((t) => ({ t, viewings: t.viewings.filter((v) => inPeriod(v.on, period)) }))
    .filter(({ viewings }) => viewings.length > 0);

  const allDays = watched.flatMap(({ viewings }) => viewings.map((v) => v.on));
  const minutes = watched.reduce(
    (sum, { t, viewings }) => (t.type === "movie" && t.runtime ? sum + t.runtime * viewings.length : sum),
    0,
  );

  const scored = watched
    .filter(({ t }) => t.scores.length > 0)
    .map(({ t }) => ({
      title: t.title,
      average: round1(mean(t.scores.map((s) => s.score))),
      scores: t.scores.length,
      low: Math.min(...t.scores.map((s) => s.score)),
      high: Math.max(...t.scores.map((s) => s.score)),
    }));
  const top = [...scored]
    .sort((a, b) => b.average - a.average || b.scores - a.scores || byTitle(a, b))
    .slice(0, 5)
    .map(({ title, average, scores }) => ({ title, average, scores }));

  const loved = watched
    .filter(({ t }) => t.likes > 0)
    .map(({ t }) => ({ title: t.title, likes: t.likes, average: t.scores.length ? mean(t.scores.map((s) => s.score)) : 0 }))
    .sort((a, b) => b.likes - a.likes || b.average - a.average || byTitle(a, b))[0];

  const divisive = scored
    .filter((s) => s.scores >= 2 && s.high > s.low)
    .sort((a, b) => b.high - b.low - (a.high - a.low) || b.scores - a.scores || byTitle(a, b))[0];

  const people = new Map<string, { titles: Set<string>; viewings: number }>();
  for (const { t, viewings } of watched) {
    for (const v of viewings) {
      for (const id of v.userIds) {
        const person = people.get(id) ?? { titles: new Set<string>(), viewings: 0 };
        person.titles.add(t.key);
        person.viewings += 1;
        people.set(id, person);
      }
    }
  }
  const nameOf = (id: string) => input.members.find((m) => m.id === id)?.name ?? "Someone";

  // Taste: for every pair of members, the titles they both scored (in this period).
  const pairs: TastePair[] = [];
  const scorers = [...new Set(watched.flatMap(({ t }) => t.scores.map((s) => s.userId)))].sort();
  for (let i = 0; i < scorers.length; i++) {
    for (let j = i + 1; j < scorers.length; j++) {
      const a: number[] = [];
      const b: number[] = [];
      for (const { t } of watched) {
        const first = t.scores.find((s) => s.userId === scorers[i]);
        const second = t.scores.find((s) => s.userId === scorers[j]);
        if (first && second) {
          a.push(first.score);
          b.push(second.score);
        }
      }
      if (a.length >= MIN_SHARED_FOR_TASTE) {
        pairs.push({ a: nameOf(scorers[i]), b: nameOf(scorers[j]), match: tasteMatch(a, b), shared: a.length });
      }
    }
  }
  const ranked = [...pairs].sort((x, y) => y.match - x.match || y.shared - x.shared || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  const closest = ranked[0] ?? null;
  const farthest = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  return {
    period,
    titles: watched.length,
    viewings: allDays.length,
    minutes,
    nights: input.nights.filter((day) => inPeriod(day, period)).length,
    top,
    mostLoved: loved ? { title: loved.title, likes: loved.likes } : null,
    mostDivisive: divisive ?? null,
    genres: topGenres(watched.map(({ t }) => t)),
    busiestMonth: busiestMonth(allDays),
    rewatched: watched
      .filter(({ viewings }) => viewings.length >= 2)
      .map(({ t, viewings }) => ({ title: t.title, times: viewings.length }))
      .sort((a, b) => b.times - a.times || byTitle(a, b))
      .slice(0, 5),
    people: [...people]
      .map(([id, p]) => ({ id, name: nameOf(id), titles: p.titles.size, viewings: p.viewings }))
      .sort((a, b) => b.viewings - a.viewings || b.titles - a.titles || a.name.localeCompare(b.name)),
    closest,
    farthest,
  };
}

// ---------------------------------------------------------------------------------------------------------------
//  A person's own year
// ---------------------------------------------------------------------------------------------------------------

export interface PersonalTitle extends StatTitle {
  /** Every day the person watched it (a movie, or a family's series): on My list now, earlier, and with a family. */
  days: string[];
  /** Their own score for it. */
  score: number | null;
}

export interface PersonalInput {
  titles: PersonalTitle[];
  /** The episodes they watched of each series (by the series' key), and in each month (`YYYY-MM`), in the period asked about. */
  episodes: { bySeries: Record<string, number>; byMonth: Record<string, number> };
}

export interface PersonalStats {
  period: Period;
  titles: number;
  movies: number;
  series: number;
  viewings: number;
  episodes: number;
  /** Minutes: each viewing of a movie, and each episode watched. */
  minutes: number;
  /** The average of their scores, and the lowest and highest. */
  scores: { average: number; low: number; high: number; count: number } | null;
  genres: { genre: string; titles: number }[];
  top: { title: string; score: number }[];
  busiestMonth: { month: string; viewings: number } | null;
  rewatched: { title: string; times: number }[];
}

/** What a person watched in a year (or ever); `episodes` is already for that period. */
export function personalStats(input: PersonalInput, period: Period): PersonalStats {
  const counted = input.titles
    .map((t) => ({ t, days: [...new Set(t.days.map((d) => d.slice(0, 10)))].filter((d) => inPeriod(d, period)) }))
    .map(({ t, days }) => ({ t, days, episodes: t.type === "tv" ? (input.episodes.bySeries[t.key] ?? 0) : 0 }))
    .filter(({ days, episodes }) => days.length > 0 || episodes > 0);

  const viewings = counted.reduce((sum, { days }) => sum + days.length, 0);
  const episodes = counted.reduce((sum, { episodes: n }) => sum + n, 0);
  const minutes = counted.reduce(
    (sum, { t, days, episodes: n }) =>
      sum + (t.runtime ? (t.type === "movie" ? t.runtime * days.length : t.runtime * n) : 0),
    0,
  );

  const scores = counted.flatMap(({ t }) => (t.score === null ? [] : [t.score]));
  const monthDays = [
    ...counted.flatMap(({ days }) => days),
    ...Object.entries(input.episodes.byMonth).flatMap(([month, n]) =>
      inPeriod(month, period) ? Array.from({ length: n }, () => `${month}-01`) : [],
    ),
  ];

  return {
    period,
    titles: counted.length,
    movies: counted.filter(({ t }) => t.type === "movie").length,
    series: counted.filter(({ t }) => t.type === "tv").length,
    viewings,
    episodes,
    minutes,
    scores:
      scores.length > 0
        ? { average: round1(mean(scores)), low: Math.min(...scores), high: Math.max(...scores), count: scores.length }
        : null,
    genres: topGenres(counted.map(({ t }) => t)),
    top: counted
      .filter(({ t }) => t.score !== null)
      .map(({ t, days }) => ({ title: t.title, score: t.score as number, times: days.length }))
      .sort((a, b) => b.score - a.score || b.times - a.times || byTitle(a, b))
      .slice(0, 5)
      .map(({ title, score }) => ({ title, score })),
    busiestMonth: busiestMonth(monthDays),
    rewatched: counted
      .filter(({ days }) => days.length >= 2)
      .map(({ t, days }) => ({ title: t.title, times: days.length }))
      .sort((a, b) => b.times - a.times || byTitle(a, b))
      .slice(0, 5),
  };
}
