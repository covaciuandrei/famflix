import { expect, test } from "@playwright/test";

import {
  airedEpisodes,
  airedIn,
  airedTotal,
  applyMark,
  applyRating,
  episodeKey,
  episodeLabel,
  episodesBetween,
  isFinished,
  isTicked,
  nextUp,
  parseSeriesInfo,
  seasonProgress,
  seriesFromTmdb,
  seriesProgress,
  seriesStatus,
  seriesToJson,
  type EpisodeState,
  type SeriesInfo,
} from "../src/lib/series";

/** What TMDB answers for a miniseries that has ended (Chernobyl): one season of five episodes. */
const CHERNOBYL = {
  status: "Ended",
  seasons: [{ season_number: 1, episode_count: 5 }],
  last_episode_to_air: { season_number: 1, episode_number: 5 },
  next_episode_to_air: null,
};

/** A show that is still airing: specials, a finished season, and season 2 aired up to episode 5 of 10. */
const RETURNING = {
  status: "Returning Series",
  seasons: [
    { season_number: 0, episode_count: 82 },
    { season_number: 1, episode_count: 13 },
    { season_number: 2, episode_count: 10 },
  ],
  last_episode_to_air: { season_number: 2, episode_number: 5 },
  next_episode_to_air: { air_date: "2026-10-18" },
};

const ticksOf = (...episodes: [number, number][]) => new Set(episodes.map(([s, e]) => episodeKey(s, e)));
const range = (season: number, from: number, to: number): [number, number][] =>
  Array.from({ length: to - from + 1 }, (_, i) => [season, from + i]);

test.describe("reading TMDB's answer", () => {
  test("a finished miniseries", () => {
    expect(seriesFromTmdb(CHERNOBYL)).toEqual({
      status: "Ended",
      seasons: [{ n: 1, episodes: 5 }],
      lastAired: { s: 1, e: 5 },
      nextAir: null,
    });
  });

  test("specials are left out, and so is a season with no episodes", () => {
    const info = seriesFromTmdb({
      ...RETURNING,
      seasons: [...RETURNING.seasons, { season_number: 3, episode_count: 0 }],
    })!;
    expect(info.seasons).toEqual([
      { n: 1, episodes: 13 },
      { n: 2, episodes: 10 },
    ]);
  });

  test("seasons come in order, and ones outside what the database takes are dropped", () => {
    const info = seriesFromTmdb({
      status: "Ended",
      seasons: [
        { season_number: 2, episode_count: 8 },
        { season_number: 1, episode_count: 6 },
        { season_number: 201, episode_count: 3 },
        { season_number: 1.5, episode_count: 3 },
      ],
      last_episode_to_air: { season_number: 2, episode_number: 8 },
    })!;
    expect(info.seasons).toEqual([
      { n: 1, episodes: 6 },
      { n: 2, episodes: 8 },
    ]);
  });

  test("a show that is still airing keeps what has aired and when the next one comes", () => {
    const info = seriesFromTmdb(RETURNING)!;
    expect(info.lastAired).toEqual({ s: 2, e: 5 });
    expect(info.nextAir).toBe("2026-10-18");
    expect(isFinished(info)).toBe(false);
  });

  test("a finished show TMDB gives no last episode for has aired everything; one that is still airing has aired nothing known", () => {
    const withoutLast = { seasons: [{ season_number: 1, episode_count: 6 }, { season_number: 2, episode_count: 4 }] };
    expect(seriesFromTmdb({ ...withoutLast, status: "Ended" })!.lastAired).toEqual({ s: 2, e: 4 });
    expect(seriesFromTmdb({ ...withoutLast, status: "Canceled" })!.lastAired).toEqual({ s: 2, e: 4 });
    expect(seriesFromTmdb({ ...withoutLast, status: "Returning Series" })!.lastAired).toBeNull();
  });

  test("the last episode can't be past the end of its season, or in a season that isn't tracked", () => {
    const info = (last: object) =>
      seriesFromTmdb({ status: "Returning Series", seasons: [{ season_number: 1, episode_count: 4 }], last_episode_to_air: last })!;
    expect(info({ season_number: 1, episode_number: 9 }).lastAired).toEqual({ s: 1, e: 4 });
    expect(info({ season_number: 0, episode_number: 2 }).lastAired).toBeNull();
    expect(info({ season_number: 3, episode_number: 1 }).lastAired).toBeNull();
  });

  test("no regular season, or nonsense, is nothing to track", () => {
    expect(seriesFromTmdb({})).toBeNull();
    expect(seriesFromTmdb({ status: "Ended", seasons: [{ season_number: 0, episode_count: 9 }] })).toBeNull();
    expect(seriesFromTmdb({ seasons: [{ season_number: 1 }, { episode_count: 4 }] })).toBeNull();
  });

  test("an unknown status and a badly written date are tolerated", () => {
    const info = seriesFromTmdb({
      seasons: [{ season_number: 1, episode_count: 2 }],
      next_episode_to_air: { air_date: "soon" },
    })!;
    expect(info.status).toBe("Unknown");
    expect(info.nextAir).toBeNull();
  });
});

test.describe("what is saved in media.series", () => {
  test("it reads back as it was written", () => {
    const info = seriesFromTmdb(RETURNING)!;
    expect(parseSeriesInfo(JSON.parse(JSON.stringify(seriesToJson(info))))).toEqual(info);
    expect(seriesToJson(info)).toEqual({
      status: "Returning Series",
      seasons: [
        { n: 1, episodes: 13 },
        { n: 2, episodes: 10 },
      ],
      last_aired: { s: 2, e: 5 },
      next_air: "2026-10-18",
    });
  });

  test("a movie, or anything that isn't series info, reads as none", () => {
    expect(parseSeriesInfo(null)).toBeNull();
    expect(parseSeriesInfo("tv")).toBeNull();
    expect(parseSeriesInfo([])).toBeNull();
    expect(parseSeriesInfo({ status: "Ended" })).toBeNull();
    expect(parseSeriesInfo({ seasons: [{ n: 0, episodes: 3 }] })).toBeNull();
    expect(parseSeriesInfo({ seasons: [{ n: 1, episodes: "3" }] })).toBeNull();
  });
});

test.describe("progress", () => {
  const info = seriesFromTmdb(RETURNING) as SeriesInfo;

  test("only aired episodes count", () => {
    expect(airedIn(info, 1)).toBe(13);
    expect(airedIn(info, 2)).toBe(5);
    expect(airedIn(info, 3)).toBe(0);
    expect(airedTotal(info)).toBe(18);
    expect(seriesProgress(info, new Set(), false)).toEqual({ watched: 0, aired: 18, total: 23 });
  });

  test("ticks add up per season and for the series, and ticks of episodes that haven't aired are ignored", () => {
    const ticks = ticksOf(...range(1, 1, 13), ...range(2, 1, 3), [2, 9]);
    expect(seasonProgress(info, 1, ticks, false)).toEqual({ watched: 13, aired: 13, total: 13 });
    expect(seasonProgress(info, 2, ticks, false)).toEqual({ watched: 3, aired: 5, total: 10 });
    expect(seriesProgress(info, ticks, false)).toEqual({ watched: 16, aired: 18, total: 23 });
  });

  test("a series marked watched shows everything that has aired as watched", () => {
    expect(seriesProgress(info, new Set(), true)).toEqual({ watched: 18, aired: 18, total: 23 });
    expect(seasonProgress(info, 2, new Set(), true)).toEqual({ watched: 5, aired: 5, total: 10 });
  });

  test("the next episode is the first aired one that isn't ticked, across seasons", () => {
    expect(nextUp(info, new Set(), false)).toEqual({ s: 1, e: 1 });
    expect(nextUp(info, ticksOf([1, 1], [1, 2], [1, 4]), false)).toEqual({ s: 1, e: 3 });
    expect(nextUp(info, ticksOf(...range(1, 1, 13), [2, 1]), false)).toEqual({ s: 2, e: 2 });
    expect(nextUp(info, ticksOf(...range(1, 1, 13), ...range(2, 1, 5)), false)).toBeNull();
    expect(nextUp(info, new Set(), true)).toBeNull();
    expect(episodeLabel(2, 5)).toBe("S2E5");
  });

  test("not started, watching, caught up and completed", () => {
    expect(seriesStatus(info, new Set(), false)).toBe("not-started");
    expect(seriesStatus(info, ticksOf([1, 1]), false)).toBe("watching");
    expect(seriesStatus(info, ticksOf(...range(1, 1, 13), ...range(2, 1, 5)), false)).toBe("caught-up");
    expect(seriesStatus(info, ticksOf([1, 1]), true)).toBe("completed");
    expect(seriesStatus(null, new Set(), false)).toBe("not-started");
    expect(seriesStatus(null, new Set(), true)).toBe("completed");
    // Nothing has aired yet: ticks can't be counted, so there is nothing to be caught up on.
    const unaired = seriesFromTmdb({ status: "Returning Series", seasons: [{ season_number: 1, episode_count: 8 }] })!;
    expect(seriesStatus(unaired, ticksOf([1, 1]), false)).toBe("not-started");
  });
});

test.describe("ticking, as the page shows it", () => {
  const mini = seriesFromTmdb(CHERNOBYL) as SeriesInfo;
  /** Season 1 has 4 episodes, season 2 has 6 and has aired 3; still airing. */
  const long = seriesFromTmdb({
    status: "Returning Series",
    seasons: [
      { season_number: 1, episode_count: 4 },
      { season_number: 2, episode_count: 6 },
    ],
    last_episode_to_air: { season_number: 2, episode_number: 3 },
  }) as SeriesInfo;
  const fresh = (completed = false): EpisodeState => ({ ticks: new Map(), completed });
  const tick = (info: SeriesInfo, state: EpisodeState, from: [number, number], to: [number, number], watched = true) =>
    applyMark(info, state, { watched, from: { s: from[0], e: from[1] }, to: { s: to[0], e: to[1] }, on: "2026-10-11" });
  const rows = (state: EpisodeState) => [...state.ticks.keys()].sort().join(",");

  test("the episodes between two, and the ones that have aired", () => {
    expect(episodesBetween(long, { s: 1, e: 3 }, { s: 2, e: 2 }).map((x) => episodeLabel(x.s, x.e))).toEqual([
      "S1E3", "S1E4", "S2E1", "S2E2",
    ]);
    // A season is asked for to episode 20000: it stops at the last one.
    expect(episodesBetween(long, { s: 2, e: 1 }, { s: 2, e: 20000 })).toHaveLength(6);
    expect(episodesBetween(long, { s: 1, e: 5 }, { s: 1, e: 9 })).toHaveLength(0);
    expect(airedEpisodes(long)).toHaveLength(7);
  });

  test("ticking one episode, a season, or everything up to an episode", () => {
    let state = tick(long, fresh(), [1, 2], [1, 2]);
    expect(rows(state)).toBe("1:2");
    state = tick(long, state, [1, 1], [1, 20000]);
    expect(rows(state)).toBe("1:1,1:2,1:3,1:4");
    state = tick(long, state, [1, 1], [2, 2]);
    expect(rows(state)).toBe("1:1,1:2,1:3,1:4,2:1,2:2");
  });

  test("only what has aired is ticked, and what was ticked keeps its day and its score", () => {
    let state = tick(long, fresh(), [2, 1], [2, 20000]);
    expect(rows(state)).toBe("2:1,2:2,2:3");
    state = { ...state, ticks: new Map(state.ticks).set(episodeKey(2, 1), { on: "2026-09-01", score: 8, comment: "good" }) };
    state = tick(long, state, [2, 1], [2, 3]);
    expect(state.ticks.get(episodeKey(2, 1))).toEqual({ on: "2026-09-01", score: 8, comment: "good" });
    expect(tick(long, fresh(), [2, 4], [2, 6]).ticks.size).toBe(0);
  });

  test("the last aired episode of a show that has ended finishes it; a show still airing is never finished by ticking", () => {
    let state = tick(mini, fresh(), [1, 1], [1, 4]);
    expect(state.completed).toBe(false);
    state = tick(mini, state, [1, 5], [1, 5]);
    expect(state.completed).toBe(true);
    expect(tick(long, fresh(), [1, 1], [2, 20000]).completed).toBe(false);
  });

  test("a Watched series shows every aired episode as watched", () => {
    const done = fresh(true);
    expect(isTicked(mini, done, 1, 5)).toBe(true);
    expect(isTicked(long, done, 2, 3)).toBe(true);
    expect(isTicked(long, done, 2, 4)).toBe(false);
    expect(isTicked(mini, fresh(), 1, 1)).toBe(false);
  });

  test("unticking an episode of a Watched series ticks the others for real and reopens it", () => {
    const state = tick(mini, fresh(true), [1, 3], [1, 3], false);
    expect(state.completed).toBe(false);
    expect(rows(state)).toBe("1:1,1:2,1:4,1:5");
    // One that wasn't ticked, or hasn't aired, changes nothing.
    const still = tick(long, fresh(true), [2, 5], [2, 5], false);
    expect(still.completed).toBe(true);
    expect(still.ticks.size).toBe(0);
  });

  test("unticking takes an episode's score and note with it", () => {
    const rated: EpisodeState = {
      ticks: new Map([[episodeKey(1, 2), { on: "2026-10-01", score: 9, comment: "great" }]]),
      completed: false,
    };
    expect(tick(mini, rated, [1, 2], [1, 2], false).ticks.size).toBe(0);
  });

  test("unticking what is not ticked changes nothing", () => {
    const state = tick(long, fresh(), [1, 1], [1, 2]);
    expect(rows(tick(long, state, [1, 3], [1, 4], false))).toBe("1:1,1:2");
  });
});

test.describe("rating an episode, as the page shows it", () => {
  const mini = seriesFromTmdb(CHERNOBYL) as SeriesInfo;
  const long = seriesFromTmdb({
    status: "Returning Series",
    seasons: [{ season_number: 1, episode_count: 4 }, { season_number: 2, episode_count: 6 }],
    last_episode_to_air: { season_number: 2, episode_number: 3 },
  }) as SeriesInfo;
  const none = (): EpisodeState => ({ ticks: new Map(), completed: false });
  const rate = (info: SeriesInfo, state: EpisodeState, season: number, episode: number, score: number | null, comment: string | null) =>
    applyRating(info, state, { season, episode, score, comment, on: "2026-10-11" });

  test("rating an episode ticks it, with the score to one decimal and the note trimmed", () => {
    const state = rate(long, none(), 1, 2, 8.46, "  Great pilot  ");
    expect(state.ticks.get(episodeKey(1, 2))).toEqual({ on: "2026-10-11", score: 8.5, comment: "Great pilot" });
  });

  test("a note alone is enough; rating again replaces both and keeps the day", () => {
    let state = rate(long, none(), 1, 1, null, "only a note");
    expect(state.ticks.get(episodeKey(1, 1))).toEqual({ on: "2026-10-11", score: null, comment: "only a note" });
    state = applyRating(long, state, { season: 1, episode: 1, score: 7, comment: "then both", on: "2026-12-01" });
    expect(state.ticks.get(episodeKey(1, 1))).toEqual({ on: "2026-10-11", score: 7, comment: "then both" });
  });

  test("neither a score nor a note takes the old ones off and leaves the tick; on an episode nobody ticked it does nothing", () => {
    let state = rate(long, none(), 1, 1, 9, "great");
    state = rate(long, state, 1, 1, null, "   ");
    expect(state.ticks.get(episodeKey(1, 1))).toEqual({ on: "2026-10-11", score: null, comment: null });
    expect(rate(long, none(), 1, 3, null, null).ticks.size).toBe(0);
  });

  test("an episode that hasn't aired is not rated", () => {
    expect(rate(long, none(), 2, 4, 8, "later").ticks.size).toBe(0);
  });

  test("rating the last aired episode of a finished series completes it, a show still airing never", () => {
    let state = tickAll(mini, 4);
    expect(rate(mini, state, 1, 5, 9, null).completed).toBe(true);
    state = { ticks: new Map([...tickAll(long, 0).ticks]), completed: false };
    expect(rate(long, state, 2, 3, 9, null).completed).toBe(false);
  });

  function tickAll(info: SeriesInfo, upTo: number): EpisodeState {
    return applyMark(info, { ticks: new Map(), completed: false }, {
      watched: true,
      from: { s: 1, e: 1 },
      to: { s: 1, e: upTo || 1 },
      on: "2026-10-11",
    });
  }
});
