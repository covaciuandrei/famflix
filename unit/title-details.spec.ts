import { expect, test } from "@playwright/test";

import {
  collectionRef,
  creditOf,
  MAX_CAST,
  pickCertification,
  titleExtrasFrom,
  topCast,
  type RawCredits,
  type RawTitleExtras,
} from "../src/lib/title-details";

/** The credits of a movie, shaped like TMDB's: the cast in billing order and a crew of several jobs. */
const DUNE: RawTitleExtras = {
  credits: {
    cast: [
      { id: 1190668, name: "Timothée Chalamet", character: "Paul Atreides", profile_path: "/paul.jpg", order: 0 },
      { id: 1333, name: "Rebecca Ferguson", character: "Lady Jessica", profile_path: "/jessica.jpg", order: 1 },
      { id: 1253360, name: "Oscar Isaac", character: "Duke Leto Atreides", profile_path: null, order: 2 },
    ],
    crew: [
      { id: 137427, name: "Denis Villeneuve", job: "Director" },
      { id: 137427, name: "Denis Villeneuve", job: "Screenplay" },
      { id: 123, name: "Hans Zimmer", job: "Original Music Composer" },
      { id: 456, name: "Jon Spaihts", job: "Writer" },
    ],
  },
  release_dates: {
    results: [
      {
        iso_3166_1: "GB",
        release_dates: [{ certification: "12A", type: 3 }],
      },
      {
        iso_3166_1: "US",
        release_dates: [
          { certification: "", type: 1 },
          { certification: "PG-13", type: 4 },
          { certification: "PG-13", type: 3 },
        ],
      },
    ],
  },
  belongs_to_collection: { id: 726871, name: "Dune Collection" },
};

test.describe("the cast", () => {
  test("is the top billed, in order, with the part they play and their photo", () => {
    expect(topCast(DUNE.credits)).toEqual([
      { id: 1190668, name: "Timothée Chalamet", character: "Paul Atreides", profilePath: "/paul.jpg" },
      { id: 1333, name: "Rebecca Ferguson", character: "Lady Jessica", profilePath: "/jessica.jpg" },
      { id: 1253360, name: "Oscar Isaac", character: "Duke Leto Atreides", profilePath: null },
    ]);
  });

  test("follows TMDB's billing order, whatever order it arrives in", () => {
    const credits: RawCredits = {
      cast: [
        { id: 2, name: "Second", order: 1 },
        { id: 3, name: "Third", order: 2 },
        { id: 1, name: "First", order: 0 },
      ],
    };
    expect(topCast(credits).map((p) => p.name)).toEqual(["First", "Second", "Third"]);
  });

  test("is at most twelve, or as many as asked", () => {
    const cast = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Actor ${i + 1}`, order: i }));
    expect(MAX_CAST).toBe(12);
    expect(topCast({ cast })).toHaveLength(12);
    expect(topCast({ cast })[11].name).toBe("Actor 12");
    expect(topCast({ cast }, 5)).toHaveLength(5);
  });

  test("leaves out people with no name or id, and lists nobody twice", () => {
    const credits: RawCredits = {
      cast: [
        { id: 1, name: "  ", order: 0 },
        { name: "No id", order: 1 },
        { id: 2, name: "Ana", character: "  ", order: 2 },
        { id: 2, name: "Ana again", order: 3 },
        { id: 3, name: "Ben", character: "The Butler", profile_path: "no-slash.jpg", order: 4 },
      ],
    };
    expect(topCast(credits)).toEqual([
      { id: 2, name: "Ana", character: null, profilePath: null },
      { id: 3, name: "Ben", character: "The Butler", profilePath: null },
    ]);
  });

  test("is empty when TMDB has none", () => {
    expect(topCast(undefined)).toEqual([]);
    expect(topCast({})).toEqual([]);
    expect(topCast({ cast: [] })).toEqual([]);
  });
});

test.describe("who made it", () => {
  test("a movie's director, once, whatever else the person did", () => {
    expect(creditOf("movie", DUNE)).toEqual({ label: "Directed by", names: ["Denis Villeneuve"] });
  });

  test("several directors are listed, up to three", () => {
    const raw: RawTitleExtras = {
      credits: { crew: ["A", "B", "C", "D"].map((name, i) => ({ id: i, name, job: "Director" })) },
    };
    expect(creditOf("movie", raw)?.names).toEqual(["A", "B", "C"]);
  });

  test("a series' creators", () => {
    const raw: RawTitleExtras = { created_by: [{ id: 1, name: "Craig Mazin" }, { id: 2, name: " " }] };
    expect(creditOf("tv", raw)).toEqual({ label: "Created by", names: ["Craig Mazin"] });
    // The crew's directors are not a series' creators.
    expect(creditOf("tv", DUNE)).toBeNull();
  });

  test("nothing when TMDB lists nobody", () => {
    expect(creditOf("movie", {})).toBeNull();
    expect(creditOf("movie", { credits: { crew: [{ id: 1, name: "Writer", job: "Writer" }] } })).toBeNull();
    expect(creditOf("tv", { created_by: [] })).toBeNull();
  });
});

test.describe("the age rating", () => {
  test("of a movie is the American one from its cinema release", () => {
    expect(pickCertification("movie", DUNE)).toBe("PG-13");
  });

  test("falls to another kind of release when there was no cinema one, in a set order", () => {
    const raw: RawTitleExtras = {
      release_dates: {
        results: [{ iso_3166_1: "US", release_dates: [{ certification: "R", type: 6 }, { certification: "PG", type: 4 }] }],
      },
    };
    expect(pickCertification("movie", raw)).toBe("PG");
  });

  test("is the British one when the American one is missing or empty", () => {
    const empty: RawTitleExtras = {
      release_dates: {
        results: [
          { iso_3166_1: "US", release_dates: [{ certification: "", type: 3 }, { certification: "  ", type: 4 }] },
          { iso_3166_1: "GB", release_dates: [{ certification: "12A", type: 3 }] },
        ],
      },
    };
    expect(pickCertification("movie", empty)).toBe("12A");
    expect(
      pickCertification("movie", { release_dates: { results: [{ iso_3166_1: "GB", release_dates: [{ certification: "15", type: 3 }] }] } }),
    ).toBe("15");
  });

  test("is nothing when no country gives one", () => {
    expect(pickCertification("movie", {})).toBeNull();
    expect(pickCertification("movie", { release_dates: { results: [] } })).toBeNull();
    expect(
      pickCertification("movie", { release_dates: { results: [{ iso_3166_1: "FR", release_dates: [{ certification: "TP", type: 3 }] }] } }),
    ).toBeNull();
  });

  test("of a series is the American rating, else the British one", () => {
    const both: RawTitleExtras = {
      content_ratings: { results: [{ iso_3166_1: "GB", rating: "15" }, { iso_3166_1: "US", rating: "TV-MA" }] },
    };
    expect(pickCertification("tv", both)).toBe("TV-MA");
    expect(
      pickCertification("tv", { content_ratings: { results: [{ iso_3166_1: "US", rating: "" }, { iso_3166_1: "GB", rating: "15" }] } }),
    ).toBe("15");
    expect(pickCertification("tv", {})).toBeNull();
  });

  test("never takes a movie's rating for a series' or the other way round", () => {
    expect(pickCertification("tv", DUNE)).toBeNull();
    expect(pickCertification("movie", { content_ratings: { results: [{ iso_3166_1: "US", rating: "TV-MA" }] } })).toBeNull();
  });

  test("is cut short if TMDB sends something absurd", () => {
    const raw: RawTitleExtras = { content_ratings: { results: [{ iso_3166_1: "US", rating: "X".repeat(500) }] } };
    expect(pickCertification("tv", raw)).toBe("X".repeat(12));
  });
});

test.describe("the collection", () => {
  test("is the one a movie belongs to", () => {
    expect(collectionRef(DUNE)).toEqual({ id: 726871, name: "Dune Collection" });
  });

  test("is nothing for a movie in none, or when TMDB's answer is incomplete", () => {
    expect(collectionRef({})).toBeNull();
    expect(collectionRef({ belongs_to_collection: null })).toBeNull();
    expect(collectionRef({ belongs_to_collection: { id: 0, name: "Zero" } })).toBeNull();
    expect(collectionRef({ belongs_to_collection: { id: -5, name: "Negative" } })).toBeNull();
    expect(collectionRef({ belongs_to_collection: { id: 1.5, name: "Fraction" } })).toBeNull();
    expect(collectionRef({ belongs_to_collection: { id: 9 } })).toBeNull();
  });
});

test.describe("all of it", () => {
  test("a movie has its cast, director, rating and collection", () => {
    expect(titleExtrasFrom("movie", DUNE)).toEqual({
      cast: topCast(DUNE.credits),
      credit: { label: "Directed by", names: ["Denis Villeneuve"] },
      certification: "PG-13",
      collection: { id: 726871, name: "Dune Collection" },
    });
  });

  test("a series has no collection, whatever TMDB sends", () => {
    const raw: RawTitleExtras = { ...DUNE, created_by: [{ id: 1, name: "Craig Mazin" }], belongs_to_collection: { id: 5, name: "Odd" } };
    const extras = titleExtrasFrom("tv", raw);
    expect(extras.collection).toBeNull();
    expect(extras.credit).toEqual({ label: "Created by", names: ["Craig Mazin"] });
  });

  test("a title TMDB knows little about has empty parts, not errors", () => {
    expect(titleExtrasFrom("movie", {})).toEqual({ cast: [], credit: null, certification: null, collection: null });
    expect(titleExtrasFrom("tv", {})).toEqual({ cast: [], credit: null, certification: null, collection: null });
  });
});
