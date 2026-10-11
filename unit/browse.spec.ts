import { expect, test } from "@playwright/test";

import { BROWSE_TYPES, browseHref, findBrowseType, genresFor, parseBrowseFilters } from "../src/lib/browse-filters";
import { DECADES } from "../src/lib/decades";
import { BROWSE_GENRES } from "../src/lib/genres";

test.describe("the Type filter", () => {
  test("is Movies and Series, and anything else is no type", () => {
    expect(BROWSE_TYPES.map((t) => t.label)).toEqual(["Movies", "Series"]);
    expect(findBrowseType("movie")).toBe("movie");
    expect(findBrowseType("tv")).toBe("tv");
    for (const other of [undefined, "", "series", "movies", "TV", "all", "movie,tv"]) {
      expect(findBrowseType(other), String(other)).toBeNull();
    }
  });

  test("has the categories that exist for it: no Horror series, no Kids movies", () => {
    const names = (type: "movie" | "tv" | null) => genresFor(type).map((g) => g.slug);
    expect(names(null)).toEqual(BROWSE_GENRES.map((g) => g.slug));
    expect(names("movie")).not.toContain("kids");
    expect(names("movie")).toContain("horror");
    for (const slug of ["horror", "romance", "thriller", "history", "music"]) expect(names("tv")).not.toContain(slug);
    expect(names("tv")).toContain("kids");
    expect(names("tv")).toContain("drama");
    // Whatever is offered for a type has an id at TMDB for it.
    expect(genresFor("tv").every((g) => g.tv !== null)).toBe(true);
    expect(genresFor("movie").every((g) => g.movie !== null)).toBe(true);
  });
});

test.describe("parseBrowseFilters", () => {
  test("reads a type, a category and a decade", () => {
    const filters = parseBrowseFilters({ type: "tv", genre: "drama", decade: "2010s" });
    expect(filters.type).toBe("tv");
    expect(filters.genre?.slug).toBe("drama");
    expect(filters.decade?.value).toBe("2010s");
  });

  test("no address parameters is no filter", () => {
    expect(parseBrowseFilters({})).toEqual({ type: null, genre: null, decade: null });
  });

  test("an unknown or repeated value is no filter", () => {
    expect(parseBrowseFilters({ type: "books", genre: "cooking", decade: "1960s" })).toEqual({
      type: null,
      genre: null,
      decade: null,
    });
    expect(parseBrowseFilters({ type: ["movie", "tv"], genre: ["drama", "comedy"], decade: ["2010s", "2000s"] })).toEqual({
      type: null,
      genre: null,
      decade: null,
    });
  });

  test("drops a category the type doesn't have, and keeps the rest", () => {
    expect(parseBrowseFilters({ type: "tv", genre: "horror", decade: "2020s" }).genre).toBeNull();
    expect(parseBrowseFilters({ type: "tv", genre: "horror", decade: "2020s" }).decade?.value).toBe("2020s");
    expect(parseBrowseFilters({ type: "movie", genre: "kids" })).toMatchObject({ type: "movie", genre: null });
    // Without a type every category stays, as do the ones both types have.
    expect(parseBrowseFilters({ genre: "horror" }).genre?.slug).toBe("horror");
    expect(parseBrowseFilters({ type: "tv", genre: "kids" }).genre?.slug).toBe("kids");
    expect(parseBrowseFilters({ type: "movie", genre: "horror" }).genre?.slug).toBe("horror");
  });
});

test.describe("browseHref", () => {
  test("is plain Browse with no filters", () => {
    expect(browseHref({})).toBe("/app/browse");
    expect(browseHref({ type: null, genre: null, decade: null })).toBe("/app/browse");
    expect(browseHref({ type: undefined, genre: undefined, decade: undefined })).toBe("/app/browse");
  });

  test("puts in the filters that are set, the type first", () => {
    expect(browseHref({ type: "tv" })).toBe("/app/browse?type=tv");
    expect(browseHref({ genre: "drama", decade: "2010s" })).toBe("/app/browse?genre=drama&decade=2010s");
    expect(browseHref({ decade: "older", genre: "western", type: "movie" })).toBe("/app/browse?type=movie&genre=western&decade=older");
  });

  test("gives back what parseBrowseFilters reads, for every combination", () => {
    for (const type of [null, ...BROWSE_TYPES.map((t) => t.value)]) {
      for (const genre of [null, ...genresFor(type)]) {
        for (const decade of [null, ...DECADES]) {
          const url = new URL(browseHref({ type, genre: genre?.slug, decade: decade?.value }), "http://x");
          const read = parseBrowseFilters(Object.fromEntries(url.searchParams));
          expect([read.type, read.genre?.slug ?? null, read.decade?.value ?? null]).toEqual([
            type,
            genre?.slug ?? null,
            decade?.value ?? null,
          ]);
        }
      }
    }
  });
});
