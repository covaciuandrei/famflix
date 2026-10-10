import { expect, test } from "@playwright/test";

import {
  airedIn,
  airedTotal,
  episodeKey,
  episodeLabel,
  isFinished,
  nextUp,
  parseSeriesInfo,
  seasonProgress,
  seriesFromTmdb,
  seriesProgress,
  seriesStatus,
  seriesToJson,
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
