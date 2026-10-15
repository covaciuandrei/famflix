import { expect, test } from "@playwright/test";

import {
  ENOUGH_TITLES,
  MAX_PAGE,
  VOTE_STEPS,
  chooseVotes,
  hasMorePages,
  loadNextTitles,
  parsePage,
  rowRequest,
  rowSourceFromParams,
  rowSourceKey,
  rowSourceToParams,
  takeNew,
  type RowSource,
} from "../src/lib/browse-rows";

const parse = (query: string) => rowSourceFromParams(new URLSearchParams(query));

const SOURCES: RowSource[] = [
  { kind: "trending", type: null },
  { kind: "trending", type: "movie" },
  { kind: "trending", type: "tv" },
  { kind: "popular", type: "movie" },
  { kind: "top", type: "tv" },
  { kind: "discover", type: "movie", sort: "popular", genre: null, decade: null, votes: 100 },
  { kind: "discover", type: "tv", sort: "top", genre: "kids", decade: "2010s", votes: 40 },
  { kind: "discover", type: "movie", sort: "top", genre: "horror", decade: "older", votes: 1000 },
  { kind: "discover", type: "movie", sort: "top", genre: "horror", decade: "older", votes: 50 },
  { kind: "like", type: "movie", id: 603 },
  { kind: "like", type: "tv", id: 87108 },
];

test("a row's source goes into an address and comes back the same", () => {
  for (const source of SOURCES) {
    expect(parse(rowSourceToParams(source).toString()), rowSourceKey(source)).toEqual(source);
  }
});

test("every source has its own key, and what a source does not use is left out of it", () => {
  const keys = SOURCES.map(rowSourceKey);
  expect(new Set(keys).size).toBe(SOURCES.length);
  expect(rowSourceKey({ kind: "trending", type: null })).toBe("kind=trending");
  expect(rowSourceKey({ kind: "discover", type: "movie", sort: "popular", genre: null, decade: null, votes: 100 })).toBe(
    "kind=discover&type=movie&sort=popular&votes=100",
  );
});

test("an address that is not a row of ours is refused", () => {
  for (const query of [
    "",
    "kind=",
    "kind=search&type=movie",
    "kind=TRENDING",
    "kind=trending&type=",
    "kind=trending&type=person",
    "kind=trending&type=all",
    // These need a type.
    "kind=popular",
    "kind=top",
    "kind=discover&sort=popular",
    "kind=like&id=603",
    "kind=popular&type=anime",
    // Discover: a known sort, and only categories and decades there are.
    "kind=discover&type=movie",
    "kind=discover&type=movie&sort=newest",
    "kind=discover&type=movie&sort=popular&genre=cooking",
    "kind=discover&type=movie&sort=popular&decade=1850s",
    "kind=discover&type=movie&sort=popular&genre=",
    "kind=discover&type=movie&sort=popular&decade=",
    // A category the type does not have.
    "kind=discover&type=tv&sort=popular&genre=horror",
    "kind=discover&type=movie&sort=popular&genre=kids",
    // Vote minimums: only the steps a row of that type and sort has.
    "kind=discover&type=movie&sort=popular&votes=",
    "kind=discover&type=movie&sort=popular&votes=0",
    "kind=discover&type=movie&sort=popular&votes=7",
    "kind=discover&type=movie&sort=popular&votes=1000",
    "kind=discover&type=movie&sort=top&votes=100%26with_keywords%3D1",
    "kind=discover&type=movie&sort=top&votes=1e3",
    "kind=discover&type=movie&sort=top&votes=0300",
    "kind=discover&type=movie&sort=top&votes=%2B300",
    "kind=discover&type=movie&sort=top&votes=-300",
    "kind=discover&type=movie&sort=top&votes=300.5",
    "kind=discover&type=movie&sort=top&votes=30",
    "kind=discover&type=tv&sort=top&votes=1000",
    "kind=discover&type=tv&sort=top&votes=50",
    // Like: a plain positive whole number.
    "kind=like&type=movie",
    "kind=like&type=movie&id=0",
    "kind=like&type=movie&id=-5",
    "kind=like&type=movie&id=1.5",
    "kind=like&type=movie&id=1e3",
    "kind=like&type=movie&id=%2B5",
    "kind=like&type=movie&id=0603",
    "kind=like&type=movie&id=abc",
    "kind=like&type=movie&id=1234567890",
    "kind=like&type=movie&id=603%2F..%2Fperson",
  ]) {
    expect(parse(query), query).toBeNull();
  }
});

test("what a kind of row does not use is ignored, not passed on", () => {
  expect(parse("kind=trending&type=movie&genre=drama&decade=2010s&id=5&sort=top&votes=100")).toEqual({
    kind: "trending",
    type: "movie",
  });
  expect(parse("kind=popular&type=tv&genre=drama&id=7&votes=100")).toEqual({ kind: "popular", type: "tv" });
  expect(parse("kind=like&type=movie&id=603&genre=drama&sort=top&votes=100")).toEqual({
    kind: "like",
    type: "movie",
    id: 603,
  });
});

test("a filtered row with no vote minimum in its address has the strictest, which every row had before", () => {
  expect(parse("kind=discover&type=movie&sort=popular")).toEqual({
    kind: "discover",
    type: "movie",
    sort: "popular",
    genre: null,
    decade: null,
    votes: 100,
  });
  expect(parse("kind=discover&type=movie&sort=top&genre=drama")).toMatchObject({ votes: 1000 });
  expect(parse("kind=discover&type=tv&sort=top&decade=2010s")).toMatchObject({ votes: 300 });
});

test("a vote minimum is one of the steps of its row, whatever the others have", () => {
  for (const [type, sort] of [
    ["movie", "popular"],
    ["movie", "top"],
    ["tv", "popular"],
    ["tv", "top"],
  ] as const) {
    const steps: readonly number[] = VOTE_STEPS[type][sort];
    // Strictest first, each step looser than the one before, and every one of them can be asked for.
    expect(steps, `${type} ${sort}`).toEqual([...steps].sort((a, b) => b - a));
    expect(new Set(steps).size).toBe(steps.length);
    for (const votes of steps) {
      expect(parse(`kind=discover&type=${type}&sort=${sort}&votes=${votes}`), `${type} ${sort} ${votes}`).toMatchObject({ votes });
    }
  }
  // Series are voted on less than movies, so what a series needs is lower.
  expect(VOTE_STEPS.tv.top[0]).toBeLessThan(VOTE_STEPS.movie.top[0]);
});

test("a page is a plain whole number from 1 to TMDB's last", () => {
  expect(parsePage("1")).toBe(1);
  expect(parsePage("2")).toBe(2);
  expect(parsePage("37")).toBe(37);
  expect(parsePage(String(MAX_PAGE))).toBe(MAX_PAGE);
  for (const bad of [null, "", "0", "-1", "1.5", "1e2", "+3", "02", "abc", String(MAX_PAGE + 1), "99999", " 2", "2 "]) {
    expect(parsePage(bad), String(bad)).toBeNull();
  }
});

test("there is more while TMDB has pages left, and never past its limit", () => {
  expect(hasMorePages(1, 3)).toBe(true);
  expect(hasMorePages(2, 3)).toBe(true);
  expect(hasMorePages(3, 3)).toBe(false);
  expect(hasMorePages(1, 1)).toBe(false);
  expect(hasMorePages(1, 0)).toBe(false);
  // TMDB reports up to 1000 pages for some lists but answers only the first 500.
  expect(hasMorePages(499, 1000)).toBe(true);
  expect(hasMorePages(MAX_PAGE, 1000)).toBe(false);
  expect(hasMorePages(MAX_PAGE - 1, MAX_PAGE)).toBe(true);
  // Not told how many: no guessing.
  expect(hasMorePages(1, undefined)).toBe(false);
  expect(hasMorePages(1, Number.NaN)).toBe(false);
  expect(hasMorePages(1, 2.5)).toBe(false);
});

test("trending, popular and top rated ask TMDB for the page", () => {
  expect(rowRequest({ kind: "trending", type: null }, 2)).toEqual({
    path: "/trending/all/week",
    params: { page: "2" },
    fallbackType: undefined,
  });
  expect(rowRequest({ kind: "trending", type: "tv" }, 1)).toEqual({
    path: "/trending/tv/week",
    params: { page: "1" },
    fallbackType: "tv",
  });
  expect(rowRequest({ kind: "popular", type: "movie" }, 3)).toEqual({
    path: "/movie/popular",
    params: { page: "3" },
    fallbackType: "movie",
  });
  expect(rowRequest({ kind: "top", type: "tv" }, 4)).toEqual({
    path: "/tv/top_rated",
    params: { page: "4" },
    fallbackType: "tv",
  });
});

test("a title's recommendations ask TMDB for the page", () => {
  expect(rowRequest({ kind: "like", type: "movie", id: 603 }, 2)).toEqual({
    path: "/movie/603/recommendations",
    params: { page: "2" },
    fallbackType: "movie",
  });
});

test("discover asks for what is popular or best rated in a category and decade, as the first page always did", () => {
  expect(
    rowRequest({ kind: "discover", type: "movie", sort: "popular", genre: "drama", decade: "2010s", votes: 100 }, 2),
  ).toEqual({
    path: "/discover/movie",
    params: {
      with_genres: "18",
      "primary_release_date.gte": "2010-01-01",
      "primary_release_date.lte": "2019-12-31",
      include_adult: "false",
      sort_by: "popularity.desc",
      "vote_count.gte": "100",
      page: "2",
    },
    fallbackType: "movie",
  });

  // Series: their own date field and category id, and no talk, news, reality or soaps.
  expect(
    rowRequest({ kind: "discover", type: "tv", sort: "popular", genre: "action", decade: "1990s", votes: 100 }, 1).params,
  ).toEqual({
    with_genres: "10759",
    without_genres: "10763,10764,10766,10767",
    "first_air_date.gte": "1990-01-01",
    "first_air_date.lte": "1999-12-31",
    include_adult: "false",
    sort_by: "popularity.desc",
    "vote_count.gte": "100",
    page: "1",
  });

  // Best rated asks for the votes its source says (the strictest step has more for a movie than for a series), and a looser
  // step of the same row is the same request with only that changed; no category or decade leaves both out.
  expect(
    rowRequest({ kind: "discover", type: "movie", sort: "top", genre: null, decade: null, votes: 1000 }, 5).params,
  ).toEqual({
    include_adult: "false",
    sort_by: "vote_average.desc",
    "vote_count.gte": "1000",
    page: "5",
  });
  expect(
    rowRequest({ kind: "discover", type: "movie", sort: "top", genre: null, decade: null, votes: 50 }, 5).params,
  ).toEqual({
    include_adult: "false",
    sort_by: "vote_average.desc",
    "vote_count.gte": "50",
    page: "5",
  });
  expect(
    rowRequest({ kind: "discover", type: "tv", sort: "top", genre: null, decade: null, votes: 300 }, 1).params,
  ).toEqual({
    without_genres: "10763,10764,10766,10767",
    include_adult: "false",
    sort_by: "vote_average.desc",
    "vote_count.gte": "300",
    page: "1",
  });
  expect(
    rowRequest({ kind: "discover", type: "tv", sort: "popular", genre: null, decade: null, votes: 5 }, 1).params,
  ).toMatchObject({ sort_by: "popularity.desc", "vote_count.gte": "5" });
});

test("a decade open on one side only limits the other", () => {
  const since = rowRequest({ kind: "discover", type: "movie", sort: "popular", genre: null, decade: "2020s", votes: 100 }, 1)
    .params;
  expect(since["primary_release_date.gte"]).toBe("2020-01-01");
  expect(since).not.toHaveProperty("primary_release_date.lte");
  const before = rowRequest({ kind: "discover", type: "tv", sort: "popular", genre: null, decade: "older", votes: 100 }, 1)
    .params;
  expect(before["first_air_date.lte"]).toBe("1979-12-31");
  expect(before).not.toHaveProperty("first_air_date.gte");
});

test("a row asks for the strictest vote minimum that leaves it enough titles, and the loosest when none does", async () => {
  const steps = [1000, 300, 100, 50];
  const totals = (byVotes: Record<number, number>) => async (votes: number) => byVotes[votes] ?? 0;

  // Plenty at the strictest: nothing looser is needed.
  expect(await chooseVotes(steps, totals({ 1000: ENOUGH_TITLES, 300: 900, 100: 2000, 50: 3000 }))).toBe(1000);
  // Not enough there, enough at the next, and the ones after that are not wanted just because they have more.
  expect(await chooseVotes(steps, totals({ 1000: ENOUGH_TITLES - 1, 300: ENOUGH_TITLES, 100: 2000, 50: 3000 }))).toBe(300);
  expect(await chooseVotes(steps, totals({ 1000: 12, 300: 90, 100: 450, 50: 3000 }))).toBe(100);
  // Not enough anywhere: the loosest, which is the most titles it can have, asked about or not.
  expect(await chooseVotes(steps, totals({ 1000: 0, 300: 3, 100: 40, 50: 120 }))).toBe(50);
  expect(await chooseVotes(steps, totals({}))).toBe(50);
  // The loosest is not asked about (nothing is looser to fall back to), and a single step is just that step.
  const asked: number[] = [];
  await chooseVotes(steps, async (votes) => {
    asked.push(votes);
    return 0;
  });
  expect(asked.sort((a, b) => b - a)).toEqual([1000, 300, 100]);
  expect(await chooseVotes([100], totals({ 100: 5 }))).toBe(100);
});

test("every minimum is asked about at once, and one that can't be asked about is not enough", async () => {
  const started: number[] = [];
  const release: (() => void)[] = [];
  const pending = chooseVotes([1000, 300, 100, 50], (votes) => {
    started.push(votes);
    return new Promise<number>((resolve) => release.push(() => resolve(ENOUGH_TITLES)));
  });
  // None has answered yet, and all of the three that could be chosen have been asked.
  await Promise.resolve();
  expect(started).toEqual([1000, 300, 100]);
  for (const answer of release) answer();
  expect(await pending).toBe(1000);

  // A minimum that fails is skipped, not fatal, whether it throws at once or later.
  const flaky = async (votes: number) => {
    if (votes === 1000) throw new Error("TMDB had a moment");
    if (votes === 300) return Promise.reject(new Error("and again"));
    return votes === 100 ? ENOUGH_TITLES + 1 : 0;
  };
  expect(await chooseVotes([1000, 300, 100, 50], flaky)).toBe(100);
  expect(
    await chooseVotes([1000, 300, 100, 50], () => {
      throw new Error("not even a promise");
    }),
  ).toBe(50);
});

test("a page's new titles are the ones not shown yet, and are counted as shown", () => {
  const title = (tmdbId: number, mediaType: "movie" | "tv" = "movie") => ({ tmdbId, mediaType });
  const seen = new Set(["movie:1", "tv:2"]);

  expect(takeNew(seen, [title(1), title(3), title(2, "tv"), title(2), title(3)])).toEqual([title(3), title(2)]);
  // The same number is a different title for a series.
  expect(seen).toEqual(new Set(["movie:1", "tv:2", "movie:3", "movie:2"]));
  // Asked again, nothing is new.
  expect(takeNew(seen, [title(1), title(3)])).toEqual([]);
  expect(takeNew(seen, [])).toEqual([]);
});

type Title = { tmdbId: number; mediaType: "movie" | "tv" };
const movie = (tmdbId: number): Title => ({ tmdbId, mediaType: "movie" });

/** A TMDB that answers with these pages (page 1 first), and how many times it was asked. */
function pagesOf(pages: { items: Title[]; hasMore: boolean }[]) {
  const asked: number[] = [];
  return {
    asked,
    fetchPage: async (page: number) => {
      asked.push(page);
      const answer = pages[page - 1];
      if (!answer) throw new Error(`no page ${page}`);
      return answer;
    },
  };
}

test("the next page's new titles are loaded, and the page after that is asked for next time", async () => {
  const tmdb = pagesOf([
    { items: [movie(1), movie(2)], hasMore: true },
    { items: [movie(3), movie(4)], hasMore: true },
    { items: [movie(5)], hasMore: false },
  ]);
  const seen = new Set(["movie:1", "movie:2"]);

  const second = await loadNextTitles({ fetchPage: tmdb.fetchPage, afterPage: 1, seen });
  expect(second).toEqual({ items: [movie(3), movie(4)], page: 2, hasMore: true });
  const third = await loadNextTitles({ fetchPage: tmdb.fetchPage, afterPage: second.page, seen });
  expect(third).toEqual({ items: [movie(5)], page: 3, hasMore: false });
  expect(tmdb.asked).toEqual([2, 3]);
});

test("a page of titles the row has already is skipped for the next one", async () => {
  const tmdb = pagesOf([
    { items: [movie(1), movie(2)], hasMore: true },
    { items: [movie(2), movie(1)], hasMore: true },
    { items: [movie(1), movie(3)], hasMore: true },
    { items: [movie(4)], hasMore: true },
  ]);
  const result = await loadNextTitles({ fetchPage: tmdb.fetchPage, afterPage: 1, seen: new Set(["movie:1", "movie:2"]) });
  // Page 2 had nothing new, so page 3 was asked for, and its 1 is left out.
  expect(result).toEqual({ items: [movie(3)], page: 3, hasMore: true });
  expect(tmdb.asked).toEqual([2, 3]);
});

test("the last page ends the row even when it has nothing new", async () => {
  const tmdb = pagesOf([
    { items: [movie(1)], hasMore: true },
    { items: [movie(1)], hasMore: false },
  ]);
  const result = await loadNextTitles({ fetchPage: tmdb.fetchPage, afterPage: 1, seen: new Set(["movie:1"]) });
  expect(result).toEqual({ items: [], page: 2, hasMore: false });
  expect(tmdb.asked).toEqual([2]);
});

test("after three pages in a row with nothing new the row gives up, rather than ask for ever", async () => {
  const same = { items: [movie(1)], hasMore: true };
  const tmdb = pagesOf([same, same, same, same, same, { items: [movie(9)], hasMore: true }]);
  const result = await loadNextTitles({ fetchPage: tmdb.fetchPage, afterPage: 1, seen: new Set(["movie:1"]) });
  expect(result).toEqual({ items: [], page: 4, hasMore: false });
  expect(tmdb.asked).toEqual([2, 3, 4]);
});

test("a page that cannot be loaded is an error, and what the row has is left as it was", async () => {
  const tmdb = pagesOf([{ items: [movie(1)], hasMore: true }]);
  const seen = new Set(["movie:1"]);
  await expect(loadNextTitles({ fetchPage: tmdb.fetchPage, afterPage: 1, seen })).rejects.toThrow("no page 2");
  expect(seen).toEqual(new Set(["movie:1"]));
});
