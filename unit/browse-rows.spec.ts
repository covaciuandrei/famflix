import { expect, test } from "@playwright/test";

import {
  MAX_PAGE,
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
  { kind: "discover", type: "movie", sort: "popular", genre: null, decade: null },
  { kind: "discover", type: "tv", sort: "top", genre: "kids", decade: "2010s" },
  { kind: "discover", type: "movie", sort: "top", genre: "horror", decade: "older" },
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
  expect(rowSourceKey({ kind: "discover", type: "movie", sort: "popular", genre: null, decade: null })).toBe(
    "kind=discover&type=movie&sort=popular",
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
  expect(parse("kind=trending&type=movie&genre=drama&decade=2010s&id=5&sort=top")).toEqual({
    kind: "trending",
    type: "movie",
  });
  expect(parse("kind=popular&type=tv&genre=drama&id=7")).toEqual({ kind: "popular", type: "tv" });
  expect(parse("kind=like&type=movie&id=603&genre=drama&sort=top")).toEqual({ kind: "like", type: "movie", id: 603 });
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
    rowRequest({ kind: "discover", type: "movie", sort: "popular", genre: "drama", decade: "2010s" }, 2),
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
    rowRequest({ kind: "discover", type: "tv", sort: "popular", genre: "action", decade: "1990s" }, 1).params,
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

  // Best rated needs more votes for a movie than for a series; no category or decade leaves both out.
  expect(rowRequest({ kind: "discover", type: "movie", sort: "top", genre: null, decade: null }, 5).params).toEqual({
    include_adult: "false",
    sort_by: "vote_average.desc",
    "vote_count.gte": "1000",
    page: "5",
  });
  expect(rowRequest({ kind: "discover", type: "tv", sort: "top", genre: null, decade: null }, 1).params).toEqual({
    without_genres: "10763,10764,10766,10767",
    include_adult: "false",
    sort_by: "vote_average.desc",
    "vote_count.gte": "300",
    page: "1",
  });
});

test("a decade open on one side only limits the other", () => {
  const since = rowRequest({ kind: "discover", type: "movie", sort: "popular", genre: null, decade: "2020s" }, 1).params;
  expect(since["primary_release_date.gte"]).toBe("2020-01-01");
  expect(since).not.toHaveProperty("primary_release_date.lte");
  const before = rowRequest({ kind: "discover", type: "tv", sort: "popular", genre: null, decade: "older" }, 1).params;
  expect(before["first_air_date.lte"]).toBe("1979-12-31");
  expect(before).not.toHaveProperty("first_air_date.gte");
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
