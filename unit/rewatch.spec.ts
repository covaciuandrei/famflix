import { expect, test } from "@playwright/test";

import {
  canStartSeriesAgain,
  canWatchAgain,
  chipText,
  currentViewingLines,
  earlierByTitle,
  groupEarlier,
  isEpisodeSeries,
  myViewings,
  rewatchChip,
  timesWatched,
  viewingLines,
} from "../src/lib/rewatch";
import type { ListItemCard } from "../src/lib/types";

const ME = "me";
const ANA = "ana";
const BEA = "bea";
const names: Record<string, string> = { [ME]: "Me", [ANA]: "Ana", [BEA]: "Bea" };
const nameOf = (id: string) => names[id] ?? "Someone";

/** A series TMDB lists one regular season of three episodes for, as `media.series` holds it. */
const SERIES = {
  status: "Ended",
  seasons: [{ n: 1, episodes: 3 }],
  lastAired: { s: 1, e: 3 },
  nextAir: null,
};

type Options = {
  family?: boolean;
  status?: "want" | "watched";
  /** Family: who the title is logged as watched by, with their day. */
  viewers?: [string, string][];
  /** My list: when the entry was marked watched. */
  watchedAt?: string | null;
  earlier?: { on: string | null; userIds: string[] }[];
  series?: unknown;
  /** My list series: how many earlier passes are in the history, and how many aired episodes are ticked. */
  passes?: number;
  ticked?: number;
};

function card(o: Options = {}): ListItemCard {
  return {
    item: {
      id: "item",
      group_id: o.family ? "group" : null,
      added_by: ME,
      media_id: "media",
      status: o.status ?? "want",
      created_at: "2026-01-01T10:00:00+00:00",
      watched_at: o.watchedAt ?? null,
      source_item_id: null,
    },
    media: {
      id: "media",
      tmdb_id: 1,
      media_type: o.series ? "tv" : "movie",
      title: "Dune",
      release_year: 2021,
      poster_path: null,
      backdrop_path: null,
      overview: null,
      tmdb_rating: null,
      runtime: null,
      genres: [],
      trailer_key: null,
      series: o.series ?? null,
      updated_at: "2026-01-01T10:00:00+00:00",
    },
    addedBy: null,
    ratings: [],
    reactions: [],
    guestRatings: [],
    likeCount: 0,
    dislikeCount: 0,
    avgScore: null,
    ratingCount: 0,
    myScore: null,
    myComment: null,
    myReaction: null,
    viewers: (o.viewers ?? []).map(([user_id, watched_on]) => ({
      user_id,
      watched_on,
      logged_by: null,
      skipped_at: null,
    })),
    watchedWith: null,
    series: o.ticked ? { watched: o.ticked, next: null } : null,
    earlier: o.earlier ?? [],
    passes: o.passes ?? 0,
  };
}

test.describe("groupEarlier", () => {
  test("one viewing per day, newest first, with everyone who watched that day", () => {
    expect(
      groupEarlier([
        { user_id: BEA, watched_on: "2025-03-01" },
        { user_id: ANA, watched_on: "2025-12-24" },
        { user_id: ANA, watched_on: "2025-03-01" },
        { user_id: ANA, watched_on: "2025-03-01" },
      ]),
    ).toEqual([
      { on: "2025-12-24", userIds: [ANA] },
      { on: "2025-03-01", userIds: [ANA, BEA] },
    ]);
  });

  test("reads the day of a full timestamp, and nothing gives nothing", () => {
    expect(groupEarlier([{ user_id: ANA, watched_on: "2025-03-01T00:00:00+00:00" }])).toEqual([
      { on: "2025-03-01", userIds: [ANA] },
    ]);
    expect(groupEarlier([])).toEqual([]);
  });

  test("earlierByTitle keeps each title's days to itself", () => {
    const byTitle = earlierByTitle([
      { media_id: "a", user_id: ME, watched_on: "2025-03-01" },
      { media_id: "b", user_id: ME, watched_on: "2025-04-01" },
      { media_id: "a", user_id: ME, watched_on: "2025-05-01" },
    ]);
    expect(byTitle.get("a")?.map((e) => e.on)).toEqual(["2025-05-01", "2025-03-01"]);
    expect(byTitle.get("b")?.map((e) => e.on)).toEqual(["2025-04-01"]);
    expect(byTitle.get("c")).toBeUndefined();
  });
});

test.describe("how many times a title was watched", () => {
  test("a title never watched is 0, and one watched once is 1", () => {
    expect(timesWatched(card())).toBe(0);
    expect(timesWatched(card({ status: "watched", watchedAt: "2026-02-01T12:00:00+00:00" }))).toBe(1);
  });

  test("My list: the current viewing and the earlier days", () => {
    const watched = card({
      status: "watched",
      watchedAt: "2026-02-01T12:00:00+00:00",
      earlier: [
        { on: "2025-12-24", userIds: [ME] },
        { on: "2025-03-01", userIds: [ME] },
      ],
    });
    expect(timesWatched(watched)).toBe(3);
  });

  test("a viewing that is both current and in the history counts once", () => {
    // A family viewing mirrored onto My list stays there after the family watches it again.
    const mirrored = card({
      status: "watched",
      watchedAt: "2026-02-01T12:00:00+00:00",
      earlier: [{ on: "2026-02-01", userIds: [ME] }],
    });
    expect(timesWatched(mirrored)).toBe(1);
  });

  test("a title put back on To watch counts only its earlier days", () => {
    expect(timesWatched(card({ earlier: [{ on: "2025-03-01", userIds: [ME] }] }))).toBe(1);
  });

  test("family: people logged on different days of one viewing are different days", () => {
    const family = card({
      family: true,
      status: "watched",
      viewers: [
        [ANA, "2026-02-01"],
        [BEA, "2026-02-01"],
        [ME, "2026-02-03"],
      ],
      earlier: [{ on: "2025-03-01", userIds: [ANA, BEA] }],
    });
    expect(timesWatched(family)).toBe(3);
  });

  test("a family title marked Watched without a log has no current viewing", () => {
    expect(timesWatched(card({ family: true, status: "watched" }))).toBe(0);
  });
});

test.describe("what can be watched again", () => {
  test("a title watched together, and one on My list marked Watched", () => {
    expect(canWatchAgain(card({ family: true, status: "watched", viewers: [[ANA, "2026-02-01"]] }))).toBe(true);
    expect(canWatchAgain(card({ status: "watched", watchedAt: "2026-02-01T12:00:00+00:00" }))).toBe(true);
  });

  test("not a title still to watch, nor a family title nobody logged", () => {
    expect(canWatchAgain(card())).toBe(false);
    expect(canWatchAgain(card({ family: true }))).toBe(false);
    expect(canWatchAgain(card({ family: true, status: "watched" }))).toBe(false);
  });

  test("a series followed by episode on My list is watched again by episode; a family series is like a movie", () => {
    const mine = card({ status: "watched", watchedAt: "2026-02-01T12:00:00+00:00", series: SERIES });
    expect(isEpisodeSeries(mine)).toBe(true);
    expect(canWatchAgain(mine)).toBe(false);
    expect(rewatchChip(mine)).toBeNull();

    const family = card({ family: true, status: "watched", viewers: [[ANA, "2026-02-01"]], series: SERIES });
    expect(isEpisodeSeries(family)).toBe(false);
    expect(canWatchAgain(family)).toBe(true);
  });

  test("a series marked Watched on My list can be started again, and nothing else can", () => {
    expect(canStartSeriesAgain(card({ status: "watched", watchedAt: "2026-02-01T12:00:00+00:00", series: SERIES }))).toBe(true);
    expect(canStartSeriesAgain(card({ status: "want", series: SERIES, ticked: 2 }))).toBe(false);
    expect(canStartSeriesAgain(card({ status: "watched", watchedAt: "2026-02-01T12:00:00+00:00" }))).toBe(false);
    expect(canStartSeriesAgain(card({ family: true, status: "watched", viewers: [[ANA, "2026-02-01"]], series: SERIES }))).toBe(false);
  });
});

test.describe("a series started again", () => {
  const watched = { status: "watched" as const, watchedAt: "2026-02-01T12:00:00+00:00", series: SERIES };

  test("says nothing until it has been started again", () => {
    expect(rewatchChip(card({ ...watched }))).toBeNull();
    expect(rewatchChip(card({ status: "want", series: SERIES, ticked: 2 }))).toBeNull();
    expect(rewatchChip(card({ status: "want", series: SERIES }))).toBeNull();
  });

  test("counts the passes: Watched 2× when it is finished again, pass 2 while it is on", () => {
    expect(rewatchChip(card({ ...watched, passes: 1 }))).toBe("Watched 2×");
    expect(rewatchChip(card({ ...watched, passes: 2 }))).toBe("Watched 3×");
    expect(rewatchChip(card({ status: "want", series: SERIES, ticked: 1, passes: 1 }))).toBe("Watching again · pass 2");
    expect(rewatchChip(card({ status: "want", series: SERIES, ticked: 3, passes: 2 }))).toBe("Watching again · pass 3");
  });

  test("is back on To watch with how often it was seen before it is started", () => {
    expect(rewatchChip(card({ status: "want", series: SERIES, passes: 1 }))).toBe("Watch again · seen once");
    expect(rewatchChip(card({ status: "want", series: SERIES, passes: 3 }))).toBe("Watch again · seen 3×");
  });

  test("has no days to list on its card: those are by episode, on its page", () => {
    expect(viewingLines(card({ ...watched, passes: 1 }), ME, nameOf)).toEqual([]);
  });
});

test.describe("the chip", () => {
  test("says Watched N× once a watched title has been watched more than once", () => {
    expect(chipText(1, true)).toBeNull();
    expect(chipText(2, true)).toBe("Watched 2×");
    expect(chipText(7, true)).toBe("Watched 7×");
  });

  test("says Watch again on a title put back on To watch", () => {
    expect(chipText(0, false)).toBeNull();
    expect(chipText(1, false)).toBe("Watch again · seen once");
    expect(chipText(3, false)).toBe("Watch again · seen 3×");
  });

  test("is worked out for a card", () => {
    const back = card({ earlier: [{ on: "2025-03-01", userIds: [ME] }] });
    expect(rewatchChip(back)).toBe("Watch again · seen once");
    const twice = card({
      status: "watched",
      watchedAt: "2026-02-01T12:00:00+00:00",
      earlier: [{ on: "2025-03-01", userIds: [ME] }],
    });
    expect(rewatchChip(twice)).toBe("Watched 2×");
    expect(rewatchChip(card())).toBeNull();
  });
});

test.describe("the viewings a chip lists", () => {
  test("family: newest first, with who was there, you first", () => {
    const family = card({
      family: true,
      status: "watched",
      viewers: [
        [BEA, "2026-02-01"],
        [ME, "2026-02-01"],
        [ANA, "2026-02-01"],
      ],
      earlier: [
        { on: "2025-03-01", userIds: [BEA, ANA] },
        { on: "2025-12-24", userIds: [ME] },
      ],
    });
    expect(viewingLines(family, ME, nameOf)).toEqual([
      { on: "2026-02-01", who: ["You", "Ana", "Bea"] },
      { on: "2025-12-24", who: ["You"] },
      { on: "2025-03-01", who: ["Ana", "Bea"] },
    ]);
  });

  test("a day that is both current and earlier lists its people once", () => {
    const family = card({
      family: true,
      status: "watched",
      viewers: [[ANA, "2026-02-01"]],
      earlier: [{ on: "2026-02-01", userIds: [ANA, BEA] }],
    });
    expect(viewingLines(family, ME, nameOf)).toEqual([{ on: "2026-02-01", who: ["Ana", "Bea"] }]);
  });

  test("My list: only the days", () => {
    const mine = card({
      status: "watched",
      watchedAt: "2026-02-01T12:00:00+00:00",
      earlier: [{ on: "2025-03-01", userIds: [ME] }],
    });
    expect(viewingLines(mine, ME, nameOf)).toEqual([
      { on: "2026-02-01", who: [] },
      { on: "2025-03-01", who: [] },
    ]);
  });
});

test.describe("a title's page", () => {
  test("lists the days you watched it, and the chip follows what the list says now", () => {
    const earlier = [
      { on: "2025-12-24", userIds: [ME] },
      { on: "2025-03-01", userIds: [ME] },
    ];
    expect(myViewings({ on: "2026-02-01" }, earlier)).toEqual({
      chip: "Watched 3×",
      lines: [
        { on: "2026-02-01", who: [] },
        { on: "2025-12-24", who: [] },
        { on: "2025-03-01", who: [] },
      ],
    });
    expect(myViewings(null, earlier).chip).toBe("Watch again · seen 2×");
    expect(myViewings(null, []).chip).toBeNull();
    expect(myViewings({ on: "2026-02-01" }, []).chip).toBeNull();
  });

  test("the day it is watched now is not counted twice", () => {
    expect(myViewings({ on: "2026-02-01" }, [{ on: "2026-02-01", userIds: [ME] }]).chip).toBeNull();
  });

  test("a viewing with no day is a viewing of its own, listed last as unknown", () => {
    const earlier = [
      { on: null, userIds: [ME] },
      { on: "2025-03-01", userIds: [ME] },
      { on: null, userIds: [ME] },
    ];
    expect(myViewings({ on: null }, earlier)).toEqual({
      chip: "Watched 4×",
      lines: [
        { on: "2025-03-01", who: [] },
        { on: null, who: [] },
        { on: null, who: [] },
        { on: null, who: [] },
      ],
    });
    expect(myViewings(null, [{ on: null, userIds: [ME] }]).chip).toBe("Watch again · seen once");
    expect(myViewings({ on: null }, []).chip).toBeNull();
  });
});

test.describe("viewings with no day", () => {
  test("each history row with no day is its own viewing, after the dated ones, which group by day", () => {
    const rows = [
      { user_id: ME, watched_on: null },
      { user_id: ME, watched_on: "2025-03-01" },
      { user_id: ANA, watched_on: "2025-03-01" },
      { user_id: ME, watched_on: null },
      { user_id: ME, watched_on: "2025-12-24" },
    ];
    expect(groupEarlier(rows)).toEqual([
      { on: "2025-12-24", userIds: [ME] },
      { on: "2025-03-01", userIds: [ANA, ME] },
      { on: null, userIds: [ME] },
      { on: null, userIds: [ME] },
    ]);
  });

  test("a title marked watched with no day counts once, and so does each unknown viewing in its history", () => {
    const unknownNow = card({ status: "watched", watchedAt: null });
    expect(timesWatched(unknownNow)).toBe(1);
    expect(rewatchChip(unknownNow)).toBeNull();

    const more = card({
      status: "watched",
      watchedAt: null,
      earlier: [
        { on: null, userIds: [ME] },
        { on: "2025-03-01", userIds: [ME] },
        { on: null, userIds: [ME] },
      ],
    });
    expect(timesWatched(more)).toBe(4);
    expect(rewatchChip(more)).toBe("Watched 4×");
    expect(viewingLines(more, ME, nameOf).map((l) => l.on)).toEqual(["2025-03-01", null, null, null]);
  });

  test("it is not mistaken for the day it was added", () => {
    const watched = card({ status: "watched", watchedAt: null });
    expect(viewingLines(watched, ME, nameOf)).toEqual([{ on: null, who: [] }]);
    expect(currentViewingLines(watched, ME, nameOf)).toEqual([{ on: null, who: [] }]);
  });

  test("the current viewing of a title that was put back on To watch is nothing", () => {
    expect(currentViewingLines(card({ status: "want" }), ME, nameOf)).toEqual([]);
  });

  test("a family's current viewing is the days it was logged on, with who was there", () => {
    const family = card({
      family: true,
      status: "watched",
      viewers: [
        [ME, "2026-02-01"],
        [ANA, "2026-02-01"],
        [BEA, "2026-02-05"],
      ],
    });
    expect(currentViewingLines(family, ME, nameOf)).toEqual([
      { on: "2026-02-05", who: ["Bea"] },
      { on: "2026-02-01", who: ["You", "Ana"] },
    ]);
  });
});
