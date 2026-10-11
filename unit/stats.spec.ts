import { expect, test } from "@playwright/test";

import {
  busiestMonth,
  familyStats,
  inPeriod,
  mergeViewings,
  personalStats,
  tasteMatch,
  yearsWithData,
  type FamilyInput,
  type FamilyTitle,
  type PersonalInput,
  type PersonalTitle,
} from "../src/lib/stats";

const ANA = "ana";
const BEN = "ben";
const CARA = "cara";
const members = [
  { id: ANA, name: "Ana" },
  { id: BEN, name: "Ben" },
  { id: CARA, name: "Cara" },
];

let n = 0;
/** A family title: its viewings (day and who), the members' scores, and how many like it. */
function title(name: string, over: Partial<FamilyTitle> = {}): FamilyTitle {
  return {
    key: `k${++n}`,
    title: name,
    type: "movie",
    runtime: 100,
    genres: [],
    viewings: [{ on: "2026-03-05", userIds: [ANA, BEN] }],
    scores: [],
    likes: 0,
    ...over,
  };
}
const family = (titles: FamilyTitle[], nights: string[] = []): FamilyInput => ({ titles, nights, members });
const scores = (...pairs: [string, number][]) => pairs.map(([userId, score]) => ({ userId, score }));

test.describe("years and days", () => {
  test("a day is in a year by its text, and every day is in all time", () => {
    expect(inPeriod("2026-01-01", 2026)).toBe(true);
    expect(inPeriod("2025-12-31", 2026)).toBe(false);
    expect(inPeriod("2026-12-31", 2026)).toBe(true);
    expect(inPeriod("2026-01-01", null)).toBe(true);
    expect(inPeriod("1999-06-01", null)).toBe(true);
  });

  test("the years that have data come newest first, each once", () => {
    expect(yearsWithData(["2024-03-01", "2026-01-01", "2024-12-31", "2025-07-07"])).toEqual([2026, 2025, 2024]);
    expect(yearsWithData([])).toEqual([]);
    expect(yearsWithData(["not a day", ""])).toEqual([]);
  });

  test("viewings are merged by day, with everybody who was there", () => {
    expect(
      mergeViewings(
        [{ on: "2026-03-05", userIds: ["b", "a"] }],
        [{ on: "2026-03-05T10:00:00Z", userIds: ["c", "a"] }, { on: "2025-12-24", userIds: ["a"] }],
      ),
    ).toEqual([
      { on: "2025-12-24", userIds: ["a"] },
      { on: "2026-03-05", userIds: ["a", "b", "c"] },
    ]);
    expect(mergeViewings()).toEqual([]);
  });

  test("the busiest month is the one with most days, the earlier one on a tie", () => {
    expect(busiestMonth(["2026-03-01", "2026-03-20", "2026-05-02"])).toEqual({ month: "2026-03", viewings: 2 });
    expect(busiestMonth(["2026-05-01", "2026-03-01"])).toEqual({ month: "2026-03", viewings: 1 });
    expect(busiestMonth([])).toBeNull();
  });
});

test.describe("taste", () => {
  test("is 100 for the same scores and 0 for the furthest apart", () => {
    expect(tasteMatch([8, 7, 9], [8, 7, 9])).toBe(100);
    expect(tasteMatch([1, 1, 1], [10, 10, 10])).toBe(0);
  });

  test("is 100 x (1 - the mean difference / 9)", () => {
    // Differences 1, 2 and 0: mean 1, so 100 x (1 - 1/9) = 88.9.
    expect(tasteMatch([8, 5, 7], [7, 7, 7])).toBe(89);
    expect(tasteMatch([5], [5.5])).toBe(94);
    expect(tasteMatch([], [])).toBe(0);
  });
});

test.describe("a family's year", () => {
  test("counts the titles, the viewings, the hours (movies only) and the movie nights", () => {
    const stats = familyStats(
      family(
        [
          title("Dune", { runtime: 155, viewings: [{ on: "2026-03-05", userIds: [ANA] }, { on: "2026-12-24", userIds: [ANA] }] }),
          title("Arrival", { runtime: 116 }),
          title("Chernobyl", { type: "tv", runtime: 60 }),
          title("No length", { runtime: null }),
        ],
        ["2026-03-05", "2026-12-24", "2025-12-31"],
      ),
      2026,
    );
    expect(stats.titles).toBe(4);
    expect(stats.viewings).toBe(5);
    // Dune twice (310) and Arrival once (116): a series adds none, nor does a title with no length.
    expect(stats.minutes).toBe(426);
    expect(stats.nights).toBe(2);
  });

  test("a title watched in two years counts in each, and all time counts both", () => {
    const christmas = title("Elf", { viewings: [{ on: "2025-12-24", userIds: [ANA] }, { on: "2026-12-24", userIds: [ANA] }] });
    const input = family([christmas]);
    expect(familyStats(input, 2025)).toMatchObject({ titles: 1, viewings: 1 });
    expect(familyStats(input, 2026)).toMatchObject({ titles: 1, viewings: 1 });
    expect(familyStats(input, null)).toMatchObject({ titles: 1, viewings: 2, rewatched: [{ title: "Elf", times: 2 }] });
    expect(familyStats(input, 2024)).toMatchObject({ titles: 0, viewings: 0, minutes: 0 });
  });

  test("the last day of a year and the first of the next stay in their own years", () => {
    const input = family([title("A", { viewings: [{ on: "2025-12-31", userIds: [ANA] }, { on: "2026-01-01", userIds: [ANA] }] })]);
    expect(familyStats(input, 2025).viewings).toBe(1);
    expect(familyStats(input, 2026).viewings).toBe(1);
  });

  test("the top five are by average score, then by how many scored, then by title", () => {
    const stats = familyStats(
      family([
        title("Low", { scores: scores([ANA, 5], [BEN, 6]) }),
        title("Tie B", { scores: scores([ANA, 8], [BEN, 8]) }),
        title("Tie A", { scores: scores([ANA, 8], [BEN, 8]) }),
        title("Three", { scores: scores([ANA, 8], [BEN, 8], [CARA, 8]) }),
        title("Best", { scores: scores([ANA, 9.5]) }),
        title("Sixth", { scores: scores([ANA, 4]) }),
        title("Unscored"),
      ]),
      2026,
    );
    expect(stats.top.map((t) => `${t.title} ${t.average} (${t.scores})`)).toEqual([
      "Best 9.5 (1)",
      "Three 8 (3)",
      "Tie A 8 (2)",
      "Tie B 8 (2)",
      "Low 5.5 (2)",
    ]);
  });

  test("with no scores there is no top, no divisive title and no taste", () => {
    const stats = familyStats(family([title("A"), title("B")]), 2026);
    expect(stats.top).toEqual([]);
    expect(stats.mostDivisive).toBeNull();
    expect(stats.closest).toBeNull();
    expect(stats.farthest).toBeNull();
    expect(stats.mostLoved).toBeNull();
  });

  test("the most loved has the most likes, the better scored winning a tie", () => {
    const stats = familyStats(
      family([
        title("Two likes", { likes: 2, scores: scores([ANA, 6]) }),
        title("Two likes, better", { likes: 2, scores: scores([ANA, 9]) }),
        title("One", { likes: 1 }),
      ]),
      2026,
    );
    expect(stats.mostLoved).toEqual({ title: "Two likes, better", likes: 2 });
  });

  test("the most divisive has the widest spread among at least two scores", () => {
    const stats = familyStats(
      family([
        title("Agreed", { scores: scores([ANA, 8], [BEN, 8]) }),
        title("One score", { scores: scores([ANA, 1]) }),
        title("Split", { scores: scores([ANA, 2], [BEN, 9]) }),
        title("Split less", { scores: scores([ANA, 4], [BEN, 8]) }),
      ]),
      2026,
    );
    expect(stats.mostDivisive).toMatchObject({ title: "Split", low: 2, high: 9, average: 5.5, scores: 2 });
  });

  test("nobody disagrees when every title is scored alike", () => {
    expect(familyStats(family([title("Agreed", { scores: scores([ANA, 8], [BEN, 8]) })]), 2026).mostDivisive).toBeNull();
  });

  test("the favourite genres count titles, and the busiest month and rewatches come from the days", () => {
    const stats = familyStats(
      family([
        title("Comedy 1", { genres: ["Comedy", "Family"], viewings: [{ on: "2026-03-05", userIds: [ANA] }, { on: "2026-03-20", userIds: [ANA] }] }),
        title("Comedy 2", { genres: ["Comedy"], viewings: [{ on: "2026-05-01", userIds: [ANA] }] }),
        title("Drama", { genres: ["Drama"], viewings: [{ on: "2026-03-25", userIds: [ANA] }] }),
      ]),
      2026,
    );
    expect(stats.genres).toEqual([
      { genre: "Comedy", titles: 2 },
      { genre: "Drama", titles: 1 },
      { genre: "Family", titles: 1 },
    ]);
    expect(stats.busiestMonth).toEqual({ month: "2026-03", viewings: 3 });
    expect(stats.rewatched).toEqual([{ title: "Comedy 1", times: 2 }]);
  });

  test("says who watched how much", () => {
    const stats = familyStats(
      family([
        title("A", { viewings: [{ on: "2026-03-05", userIds: [ANA, BEN] }, { on: "2026-04-05", userIds: [ANA] }] }),
        title("B", { viewings: [{ on: "2026-05-05", userIds: [ANA, CARA] }] }),
      ]),
      2026,
    );
    expect(stats.people).toEqual([
      { id: ANA, name: "Ana", titles: 2, viewings: 3 },
      { id: BEN, name: "Ben", titles: 1, viewings: 1 },
      { id: CARA, name: "Cara", titles: 1, viewings: 1 },
    ]);
  });

  test("a person who has left is still counted, as Someone", () => {
    const stats = familyStats(family([title("A", { viewings: [{ on: "2026-03-05", userIds: ["gone"] }] })]), 2026);
    expect(stats.people).toEqual([{ id: "gone", name: "Someone", titles: 1, viewings: 1 }]);
  });

  test("taste needs three titles in common, and is told with its number", () => {
    const two = family([
      title("A", { scores: scores([ANA, 8], [BEN, 8]) }),
      title("B", { scores: scores([ANA, 7], [BEN, 7]) }),
    ]);
    expect(familyStats(two, 2026).closest).toBeNull();

    const three = family([
      title("A", { scores: scores([ANA, 8], [BEN, 8]) }),
      title("B", { scores: scores([ANA, 7], [BEN, 7]) }),
      title("C", { scores: scores([ANA, 9], [BEN, 8]) }),
    ]);
    // One pair only: it is the closest, and there is no most different.
    expect(familyStats(three, 2026).closest).toEqual({ a: "Ana", b: "Ben", match: 96, shared: 3 });
    expect(familyStats(three, 2026).farthest).toBeNull();
  });

  test("with three people, the closest and the most different pairs", () => {
    const titles = ["A", "B", "C", "D"].map((name, i) =>
      title(name, { scores: scores([ANA, 8], [BEN, i % 2 ? 8 : 7], [CARA, 2]) }),
    );
    const stats = familyStats(family(titles), 2026);
    // Ana and Ben are 0.5 apart on average, Ben and Cara about 5.
    expect(stats.closest).toMatchObject({ a: "Ana", b: "Ben", shared: 4 });
    expect(stats.closest?.match).toBe(94);
    expect(stats.farthest).toMatchObject({ b: "Cara", shared: 4 });
    expect(stats.farthest?.match).toBeLessThan(stats.closest!.match);
  });

  test("taste only counts titles watched in the period", () => {
    const old = (name: string) => title(name, { viewings: [{ on: "2024-01-01", userIds: [ANA] }], scores: scores([ANA, 8], [BEN, 8]) });
    const input = family([old("A"), old("B"), old("C"), title("This year", { scores: scores([ANA, 8], [BEN, 8]) })]);
    expect(familyStats(input, 2026).closest).toBeNull();
    expect(familyStats(input, null).closest).toMatchObject({ shared: 4 });
  });

  test("a family with nothing has zeros and empty lists, not errors", () => {
    expect(familyStats(family([]), 2026)).toEqual({
      period: 2026,
      titles: 0,
      viewings: 0,
      minutes: 0,
      nights: 0,
      top: [],
      mostLoved: null,
      mostDivisive: null,
      genres: [],
      busiestMonth: null,
      rewatched: [],
      people: [],
      closest: null,
      farthest: null,
    });
  });
});

let m = 0;
function mine(name: string, over: Partial<PersonalTitle> = {}): PersonalTitle {
  return { key: `m${++m}`, title: name, type: "movie", runtime: 100, genres: [], days: ["2026-03-05"], score: null, ...over };
}
const own = (titles: PersonalTitle[], episodes: Partial<PersonalInput["episodes"]> = {}): PersonalInput => ({
  titles,
  episodes: { bySeries: {}, byMonth: {}, ...episodes },
});

test.describe("a person's year", () => {
  test("counts titles, viewings and the hours of movies", () => {
    const stats = personalStats(
      own([
        mine("Dune", { runtime: 155, days: ["2026-03-05", "2026-12-24", "2025-12-24"] }),
        mine("Arrival", { runtime: 116 }),
        mine("Old", { days: ["2019-01-01"] }),
      ]),
      2026,
    );
    expect(stats).toMatchObject({ titles: 2, movies: 2, series: 0, viewings: 3, episodes: 0, minutes: 155 * 2 + 116 });
    expect(personalStats(own([mine("Old", { days: ["2019-01-01"] })]), null)).toMatchObject({ titles: 1, viewings: 1 });
  });

  test("a day that is in more than one source counts once", () => {
    expect(personalStats(own([mine("Dune", { days: ["2026-03-05", "2026-03-05T12:00:00+00:00", "2026-03-05"] })]), 2026).viewings).toBe(1);
  });

  test("a series counts for its episodes: titles, episodes and hours of episode length", () => {
    const series = mine("Chernobyl", { type: "tv", runtime: 60, days: [] });
    const stats = personalStats(own([series, mine("Dune", { runtime: 155 })], { bySeries: { [series.key]: 5 } }), 2026);
    expect(stats).toMatchObject({ titles: 2, movies: 1, series: 1, viewings: 1, episodes: 5, minutes: 155 + 5 * 60 });
  });

  test("a series with no episodes watched in the period is not counted", () => {
    const series = mine("Chernobyl", { type: "tv", runtime: 60, days: [] });
    expect(personalStats(own([series], { bySeries: { [series.key]: 0 } }), 2026)).toMatchObject({ titles: 0, episodes: 0, minutes: 0 });
  });

  test("a family's series watched together is a viewing but adds no hours of its own", () => {
    const series = mine("Chernobyl", { type: "tv", runtime: 60, days: ["2026-03-05"] });
    expect(personalStats(own([series]), 2026)).toMatchObject({ titles: 1, series: 1, viewings: 1, minutes: 0 });
  });

  test("the scores are averaged with their lowest and highest, and the top five come in order", () => {
    const stats = personalStats(
      own([
        mine("A", { score: 9 }),
        mine("B", { score: 6.5 }),
        mine("C", { score: 8, days: ["2026-01-01", "2026-02-02"] }),
        mine("D", { score: 8 }),
        mine("E", { score: 7 }),
        mine("F", { score: 3 }),
        mine("Unscored"),
      ]),
      2026,
    );
    // (9 + 6.5 + 8 + 8 + 7 + 3) / 6 = 6.92
    expect(stats.scores).toEqual({ average: 6.9, low: 3, high: 9, count: 6 });
    expect(stats.top).toEqual([
      { title: "A", score: 9 },
      { title: "C", score: 8 },
      { title: "D", score: 8 },
      { title: "E", score: 7 },
      { title: "B", score: 6.5 },
    ]);
  });

  test("with no scores there is no average", () => {
    expect(personalStats(own([mine("A")]), 2026).scores).toBeNull();
    expect(personalStats(own([mine("A")]), 2026).top).toEqual([]);
  });

  test("the busiest month counts the episodes watched in it too", () => {
    const series = mine("Chernobyl", { type: "tv", days: [] });
    const stats = personalStats(
      own([series, mine("Dune", { days: ["2026-03-05"] })], { bySeries: { [series.key]: 6 }, byMonth: { "2026-07": 5, "2026-08": 1 } }),
      2026,
    );
    expect(stats.busiestMonth).toEqual({ month: "2026-07", viewings: 5 });
  });

  test("the months of other years are not counted in a year", () => {
    const series = mine("Chernobyl", { type: "tv", days: [] });
    const stats = personalStats(own([series], { bySeries: { [series.key]: 4 }, byMonth: { "2025-07": 3, "2026-08": 1 } }), 2026);
    expect(stats.busiestMonth).toEqual({ month: "2026-08", viewings: 1 });
  });

  test("rewatches are the titles watched on two days or more, most first", () => {
    const stats = personalStats(
      own([
        mine("Once"),
        mine("Twice", { days: ["2026-01-01", "2026-12-24"] }),
        mine("Thrice", { days: ["2026-01-01", "2026-06-01", "2026-12-24"] }),
        mine("Also twice", { days: ["2026-02-01", "2026-03-01"] }),
      ]),
      2026,
    );
    expect(stats.rewatched).toEqual([
      { title: "Thrice", times: 3 },
      { title: "Also twice", times: 2 },
      { title: "Twice", times: 2 },
    ]);
  });

  test("the favourite genres count each title once", () => {
    const stats = personalStats(
      own([
        mine("A", { genres: ["Drama", "Drama", "Crime"], days: ["2026-01-01", "2026-02-02"] }),
        mine("B", { genres: ["Drama"] }),
        mine("C", { genres: ["Comedy"] }),
      ]),
      2026,
    );
    expect(stats.genres).toEqual([
      { genre: "Drama", titles: 2 },
      { genre: "Comedy", titles: 1 },
      { genre: "Crime", titles: 1 },
    ]);
  });

  test("a person with nothing has zeros and empty lists", () => {
    expect(personalStats(own([]), null)).toEqual({
      period: null,
      titles: 0,
      movies: 0,
      series: 0,
      viewings: 0,
      episodes: 0,
      minutes: 0,
      scores: null,
      genres: [],
      top: [],
      busiestMonth: null,
      rewatched: [],
    });
  });
});
