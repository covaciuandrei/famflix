import { expect, test } from "@playwright/test";

import {
  csvCell,
  CSV_HEADER,
  exportFileName,
  toCsv,
  viewingsOf,
  type ExportDocument,
  type Viewing,
} from "../src/lib/export-csv";

const viewing = (over: Partial<Viewing> = {}): Viewing => ({
  date: "2026-03-05",
  kind: "movie",
  title: "Dune",
  season: null,
  episode: null,
  year: 2021,
  where: "My list",
  with: [],
  score: null,
  note: null,
  ...over,
});

test.describe("a cell", () => {
  test("is plain when it can be", () => {
    expect(csvCell("Dune")).toBe("Dune");
    expect(csvCell(8.5)).toBe("8.5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  test("is quoted when it holds a comma, a quote or a line break, the quotes doubled", () => {
    expect(csvCell("Good, but long")).toBe('"Good, but long"');
    expect(csvCell('He said "wow"')).toBe('"He said ""wow"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
    expect(csvCell("one\r\ntwo")).toBe('"one\r\ntwo"');
  });

  test("keeps accents, other scripts and emoji as they are", () => {
    expect(csvCell("Amélie – Le Fabuleux Destin")).toBe("Amélie – Le Fabuleux Destin");
    expect(csvCell("千と千尋の神隠し")).toBe("千と千尋の神隠し");
    expect(csvCell("Great 🍿")).toBe("Great 🍿");
  });

  test("is read as text, not as a formula, when it starts like one", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+49 123")).toBe("'+49 123");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=cmd")).toBe("'\t=cmd");
    expect(csvCell("\r=cmd")).toBe('"\'\r=cmd"');
    expect(csvCell("  =1+1")).toBe("'  =1+1");
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });

  test("is left alone when the formula character is not the first", () => {
    expect(csvCell("2+2=4")).toBe("2+2=4");
    expect(csvCell("Mr. & Mrs. Smith")).toBe("Mr. & Mrs. Smith");
    expect(csvCell("a@b.c")).toBe("a@b.c");
  });
});

test.describe("the file", () => {
  test("starts with the header and ends every line with CRLF", () => {
    const csv = toCsv([viewing()]);
    expect(csv.split("\r\n")).toEqual([
      "date,kind,title,season,episode,year,where,with,score,note",
      "2026-03-05,movie,Dune,,,2021,My list,,,",
      "",
    ]);
    expect(CSV_HEADER).toHaveLength(10);
    expect(toCsv([])).toBe("date,kind,title,season,episode,year,where,with,score,note\r\n");
  });

  test("writes who it was with, a score and a note, quoted where it needs to be", () => {
    const csv = toCsv([viewing({ where: "The Smiths", with: ["Ana", "Ben"], score: 8.5, note: 'Loved it, "again"!' })]);
    expect(csv.split("\r\n")[1]).toBe('2026-03-05,movie,Dune,,,2021,The Smiths,"Ana, Ben",8.5,"Loved it, ""again""!"');
  });

  test("guards titles and notes that people typed", () => {
    const csv = toCsv([viewing({ title: "=cmd|' /C calc'!A0", note: "@everyone" })]);
    expect(csv.split("\r\n")[1]).toBe(`2026-03-05,movie,'=cmd|' /C calc'!A0,,,2021,My list,,,'@everyone`);
  });

  test("is named after the day", () => {
    expect(exportFileName("json", new Date("2026-10-12T22:30:00Z"))).toBe("famflix-data-2026-10-12.json");
    expect(exportFileName("csv", new Date("2026-01-02T00:00:00Z"))).toBe("famflix-data-2026-01-02.csv");
  });
});

test.describe("the viewings of a document", () => {
  const entry = { tmdb_id: 1, type: "movie" as const, year: 2021 };

  test("a document with nothing in it has none", () => {
    expect(viewingsOf({})).toEqual([]);
    expect(viewingsOf({ my_list: [], watch_history: [], family_lists: [] })).toEqual([]);
  });

  test("a movie watched on My list is one row; one not watched yet is none", () => {
    const doc: ExportDocument = {
      my_list: [
        { ...entry, title: "Dune", status: "watched", watched_at: "2026-03-05T12:00:00+00:00", my_score: 8.5, my_note: "great", watched_with: null },
        { ...entry, tmdb_id: 2, title: "Arrival", status: "want", watched_at: null, my_score: null, my_note: null, watched_with: null },
      ],
    };
    expect(viewingsOf(doc)).toEqual([viewing({ score: 8.5, note: "great" })]);
  });

  test("a series with ticked episodes is told by its episodes, the ones before this time included", () => {
    const series = { tmdb_id: 7, type: "tv" as const, year: 2019, title: "Chernobyl" };
    const doc: ExportDocument = {
      my_list: [
        {
          ...series,
          status: "watched",
          watched_at: "2026-04-01T12:00:00+00:00",
          my_score: 9,
          my_note: null,
          watched_with: null,
          episodes: [{ season: 1, episode: 1, watched_on: "2026-04-01", score: 7, note: "second time" }],
          earlier_episode_viewings: [
            { season: 1, episode: 1, watched_on: "2026-01-10", score: 9, note: "first time" },
            { season: 1, episode: 2, watched_on: "2026-01-10", score: null, note: null },
          ],
        },
      ],
    };
    expect(viewingsOf(doc).map((v) => [v.date, v.kind, v.season, v.episode, v.score, v.note])).toEqual([
      ["2026-01-10", "episode", 1, 1, 9, "first time"],
      ["2026-01-10", "episode", 1, 2, null, null],
      ["2026-04-01", "episode", 1, 1, 7, "second time"],
    ]);
  });

  test("a series marked Watched with no ticks is one row of its own", () => {
    const doc: ExportDocument = {
      my_list: [
        {
          tmdb_id: 7,
          type: "tv",
          year: 2019,
          title: "Chernobyl",
          status: "watched",
          watched_at: "2026-04-01T12:00:00+00:00",
          my_score: null,
          my_note: null,
          watched_with: null,
          episodes: [],
        },
      ],
    };
    expect(viewingsOf(doc)).toEqual([viewing({ kind: "series", title: "Chernobyl", year: 2019, date: "2026-04-01" })]);
  });

  test("the watch history adds the earlier viewings, with the family they were with", () => {
    const doc: ExportDocument = {
      watch_history: [
        { ...entry, title: "Dune", watched_on: "2025-12-24", family: "The Smiths" },
        { ...entry, title: "Dune", watched_on: "2025-02-01", family: null },
      ],
    };
    expect(viewingsOf(doc).map((v) => [v.date, v.where])).toEqual([
      ["2025-02-01", "My list"],
      ["2025-12-24", "The Smiths"],
    ]);
  });

  test("a viewing on My list and in the family's list is one row, with the family, who was there and the score", () => {
    const doc: ExportDocument = {
      my_list: [
        {
          ...entry,
          title: "Dune",
          status: "watched",
          watched_at: "2026-03-05T12:00:00+00:00",
          my_score: null,
          my_note: null,
          watched_with: { family: "The Smiths", people: ["Ben"] },
        },
      ],
      family_lists: [
        {
          family: "The Smiths",
          titles: [
            { ...entry, title: "Dune", i_watched_on: "2026-03-05", my_score: 9, my_note: "ours" },
            { ...entry, tmdb_id: 3, title: "Nobody watched it", i_watched_on: null, my_score: null, my_note: null },
          ],
        },
      ],
    };
    expect(viewingsOf(doc)).toEqual([viewing({ where: "The Smiths", with: ["Ben"], score: 9, note: "ours" })]);
  });

  test("two viewings of one title on different days are two rows, oldest first", () => {
    const doc: ExportDocument = {
      my_list: [
        { ...entry, title: "Dune", status: "watched", watched_at: "2026-03-05T12:00:00+00:00", my_score: null, my_note: null, watched_with: null },
        { ...entry, tmdb_id: 2, title: "Arrival", status: "watched", watched_at: "2026-01-01T12:00:00+00:00", my_score: null, my_note: null, watched_with: null },
      ],
      watch_history: [{ ...entry, title: "Dune", watched_on: "2025-12-24", family: null }],
    };
    expect(viewingsOf(doc).map((v) => [v.date, v.title])).toEqual([
      ["2025-12-24", "Dune"],
      ["2026-01-01", "Arrival"],
      ["2026-03-05", "Dune"],
    ]);
  });

  test("a former family's redacted name does not remove the person's own viewing", () => {
    const doc: ExportDocument = {
      family_lists: [{
        family: null,
        titles: [{ ...entry, title: "Dune", i_watched_on: "2026-03-05", my_score: 8.5, my_note: "My own note" }],
      }],
    };
    expect(viewingsOf(doc)).toEqual([viewing({ score: 8.5, note: "My own note" })]);
    expect(toCsv(viewingsOf(doc))).toContain("2026-03-05,movie,Dune,,,2021,My list,,8.5,My own note\r\n");
  });

  test("viewings with no day have a blank date and are never merged into one", () => {
    const doc: ExportDocument = {
      my_list: [
        { ...entry, title: "Dune", status: "watched", watched_at: null, my_score: 7, my_note: null, watched_with: null },
      ],
      watch_history: [
        { ...entry, title: "Dune", watched_on: null, family: null },
        { ...entry, title: "Dune", watched_on: null, family: null },
        { ...entry, title: "Dune", watched_on: "2025-12-24", family: null },
      ],
    };
    const found = viewingsOf(doc);
    expect(found.map((v) => v.date)).toEqual(["", "", "", "2025-12-24"]);
    expect(found.filter((v) => v.score === 7)).toHaveLength(1);
    expect(toCsv(found).split("\r\n")[1]).toBe(",movie,Dune,,,2021,My list,,7,");
  });

  test("episodes ticked with no day are one row each, with a blank date", () => {
    const doc: ExportDocument = {
      my_list: [
        {
          ...entry,
          type: "tv",
          title: "Dark",
          status: "want",
          watched_at: null,
          my_score: null,
          my_note: null,
          watched_with: null,
          episodes: [
            { season: 1, episode: 1, watched_on: null, score: null, note: null },
            { season: 1, episode: 2, watched_on: "2026-01-02", score: null, note: null },
          ],
          earlier_episode_viewings: [{ season: 1, episode: 1, watched_on: null, score: null, note: null }],
        },
      ],
    };
    expect(viewingsOf(doc).map((v) => [v.date, v.season, v.episode])).toEqual([
      ["", 1, 1],
      ["", 1, 1],
      ["2026-01-02", 1, 2],
    ]);
  });
});
