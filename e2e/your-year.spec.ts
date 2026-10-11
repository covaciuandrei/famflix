import { test } from "@playwright/test";

import { admin, createUser, expect, openAnonymous, openAs, startFamily } from "./helpers";
import { noSideways, region, tile, year } from "./stats-page";
import { seedMyList, seedTitles } from "./stats-seed";

// Your year is worked out from My list, the earlier viewings, the episodes ticked and what was watched with a family. The
// data is built in the database, dated to the day, so every number can be checked.

test("Your year: what I watched, from My list, my earlier viewings, my episodes and my families; private to me", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const [ana, bogdan, cora] = await Promise.all(["Ana", "Bogdan", "Cora"].map((name) => createUser(name)));
  const [anaPage, bogdanPage, coraPage] = await Promise.all(
    [ana, bogdan, cora].map((user) => openAs(browser, testInfo.project, user)),
  );
  await startFamily(anaPage, [bogdanPage], "Year Family");
  const group = (await admin.from("groups").select("id").eq("created_by", ana.id).single()).data!.id as string;

  // A family evening on 24 December: Hotel is only on the family's list, India is also on Ana's My list (put there by the
  // watch, with a score of her own that beats the family's).
  const family = await seedTitles(group, ana.id, { Ana: ana.id, Bogdan: bogdan.id }, [
    { name: "Year Hotel", type: "movie", runtime: 100, genres: ["Family"], current: { on: "2025-12-24", who: ["Ana", "Bogdan"] }, scores: { Ana: 8, Bogdan: 3 } },
    { name: "Year India", type: "movie", runtime: 90, genres: ["Comedy"], current: { on: "2025-12-24", who: ["Ana", "Bogdan"] }, scores: { Ana: 10, Bogdan: 2 } },
  ]);
  const mine = await seedMyList(ana.id, [
    { name: "Year Alpha", type: "movie", runtime: 100, genres: ["Drama"], watchedOn: "2025-04-10", score: 9 },
    { name: "Year Bravo", type: "movie", runtime: 120, genres: ["Comedy", "Drama"], watchedOn: "2025-06-01", score: 7 },
    // Watched again: this time on 2 February 2025, and once before, in November 2024.
    { name: "Year Charlie", type: "movie", runtime: 90, genres: ["Comedy"], watchedOn: "2025-02-02", score: 5, earlier: ["2024-11-11"] },
    // Not watched, so not in it.
    { name: "Year Delta", type: "movie", runtime: 80, genres: ["Horror"] },
    // Taken off My list, but it was watched.
    { name: "Year Echo", type: "movie", runtime: 110, genres: ["Action"], watchedOn: "2025-09-09", removed: true },
    // A series followed by episode: three ticked in 2025 and one in 2024, from an earlier pass.
    {
      name: "Year Foxtrot",
      type: "tv",
      runtime: 50,
      genres: ["Drama", "Crime"],
      episodes: 4,
      score: 8,
      ticks: [
        { episode: 1, on: "2025-05-01" },
        { episode: 2, on: "2025-05-02" },
        { episode: 3, on: "2025-06-03" },
      ],
      earlierEpisodes: [{ episode: 1, on: "2024-12-30", pass: 1 }],
    },
    // A series marked Watched with no ticks: both its episodes count, on the day it was marked.
    { name: "Year Golf", type: "tv", runtime: 45, genres: ["Mystery"], episodes: 2, watchedOn: "2025-08-20" },
    { name: "Year India", type: "movie", runtime: 90, genres: ["Comedy"], mediaId: family.media["Year India"], watchedOn: "2025-12-24", score: 6, linkedTo: family.items["Year India"] },
  ]);
  // Bogdan has Alpha too, with other days and another score: none of it is Ana's.
  await seedMyList(bogdan.id, [
    { name: "Year Alpha", type: "movie", runtime: 100, genres: ["Drama"], mediaId: mine.media["Year Alpha"], watchedOn: "2025-01-01", score: 1 },
  ]);

  // ---- From My list, to Your year, the newest year first ------------------------------------------------------------------------
  await anaPage.goto("/app/mine");
  await anaPage.getByRole("link", { name: "Your year" }).click();
  await expect(anaPage).toHaveURL(/\/app\/mine\/stats$/);
  await expect(anaPage.getByRole("heading", { name: "Your year", level: 1 })).toBeVisible();
  await expect(year(anaPage, "2025")).toHaveAttribute("aria-current", "page");
  await expect(year(anaPage, "2024")).toBeVisible();
  await expect(year(anaPage, "All time")).toBeVisible();

  // 2025: 8 titles (6 movies and 2 series), 6 viewings, 5 episodes (3 ticked and the 2 that a series marked Watched counts),
  // and 850 minutes: 610 of movies, 150 and 90 of episodes. The one that is only on the list, and not watched, is not in it.
  await expect(tile(anaPage, "Titles watched")).toHaveText("8");
  await expect(anaPage.locator("dl > div", { hasText: "Titles watched" }).first()).toContainText("6 movies · 2 series");
  await expect(tile(anaPage, "Viewings")).toHaveText("6");
  await expect(tile(anaPage, "Episodes")).toHaveText("5");
  await expect(tile(anaPage, "Time watched")).toHaveText("14 h 10 min");

  // The best scored first; the family's score is used only where there is none of her own (Hotel), and her own beats it
  // (India's 6, not 10). Where two have the same score, the one watched on more days comes first.
  const top = region(anaPage, "Your top 5").getByRole("listitem");
  await expect(top).toHaveCount(5);
  const ranked: [string, string][] = [
    ["Year Alpha", "9"],
    ["Year Hotel", "8"],
    ["Year Foxtrot", "8"],
    ["Year Bravo", "7"],
    ["Year India", "6"],
  ];
  for (const [i, [name, score]] of ranked.entries()) {
    await expect(top.nth(i)).toContainText(name);
    await expect(top.nth(i)).toContainText(score);
  }
  await expect(region(anaPage, "Your top 5")).not.toContainText("Year Charlie");

  const scores = region(anaPage, "Your scores");
  await expect(scores.locator("dl > div", { hasText: "Average" })).toContainText("7.2 · 6 scores");
  await expect(scores.locator("dl > div", { hasText: "Lowest" })).toContainText("5");
  await expect(scores.locator("dl > div", { hasText: "Highest" })).toContainText("9");

  const genres = region(anaPage, "Favourite genres").getByRole("listitem");
  await expect(genres).toHaveCount(5);
  const liked: [string, string][] = [
    ["Comedy", "3 titles"],
    ["Drama", "3 titles"],
    ["Action", "1 title"],
    ["Crime", "1 title"],
    ["Family", "1 title"],
  ];
  for (const [i, [genre, count]] of liked.entries()) {
    await expect(genres.nth(i)).toContainText(genre);
    await expect(genres.nth(i)).toContainText(count);
  }
  await expect(region(anaPage, "Watched again")).toContainText("Nothing watched more than once.");

  // Episodes count in the months with the viewings: two in May (episodes), two in August (the series marked Watched), two on
  // 24 December (the family evening, counted once for India although the watch and My list both have it).
  const chart = region(anaPage, "Watched by month");
  await expect(chart).toContainText("Busiest month: May 2025 · 2 viewings and episodes");
  await expect(chart.getByText("May 2025: 2 viewings and episodes")).toBeAttached();
  await expect(chart.getByText("August 2025: 2 viewings and episodes")).toBeAttached();
  await expect(chart.getByText("December 2025: 2 viewings and episodes")).toBeAttached();
  await expect(chart.getByText("February 2025: 1 viewing or episode", { exact: true })).toBeAttached();
  await expect(chart.getByText("January 2025: 0 viewings and episodes")).toBeAttached();
  await expect(chart.getByRole("listitem")).toHaveCount(12);
  await noSideways(anaPage);

  // ---- Another year ------------------------------------------------------------------------------------------------------------
  await year(anaPage, "2024").click();
  await expect(anaPage).toHaveURL(/\/app\/mine\/stats\?year=2024$/);
  await expect(tile(anaPage, "Titles watched")).toHaveText("2");
  await expect(tile(anaPage, "Viewings")).toHaveText("1");
  await expect(tile(anaPage, "Episodes")).toHaveText("1");
  await expect(tile(anaPage, "Time watched")).toHaveText("2 h 20 min");
  await expect(region(anaPage, "Your top 5").getByRole("listitem")).toHaveCount(2);
  await expect(region(anaPage, "Your top 5").getByRole("listitem").first()).toContainText("Year Foxtrot");
  await expect(region(anaPage, "Your scores").locator("dl > div", { hasText: "Average" })).toContainText("6.5 · 2 scores");
  await expect(region(anaPage, "Watched by month")).toContainText("Busiest month: November 2024 · 1 viewing or episode");

  // ---- All time: the title watched twice shows, and the years are the bars -------------------------------------------------------------
  await year(anaPage, "All time").click();
  await expect(anaPage).toHaveURL(/\/app\/mine\/stats\?year=all$/);
  await expect(tile(anaPage, "Titles watched")).toHaveText("8");
  await expect(tile(anaPage, "Viewings")).toHaveText("7");
  await expect(tile(anaPage, "Episodes")).toHaveText("6");
  await expect(tile(anaPage, "Time watched")).toHaveText("16 h 30 min");
  await expect(region(anaPage, "Watched again").getByRole("listitem")).toHaveCount(1);
  await expect(region(anaPage, "Watched again")).toContainText("Year Charlie");
  await expect(region(anaPage, "Watched again")).toContainText("2 times");
  await expect(region(anaPage, "Watched by year").getByText("2024: 2 viewings and episodes")).toBeAttached();
  await expect(region(anaPage, "Watched by year").getByText("2025: 11 viewings and episodes")).toBeAttached();

  // A year with nothing in it, and nonsense in the address.
  await anaPage.goto("/app/mine/stats?year=2019");
  await expect(anaPage.getByText("Nothing watched in 2019.")).toBeVisible();
  await expect(year(anaPage, "2019")).toHaveAttribute("aria-current", "page");
  await expect(anaPage.getByRole("button", { name: "Share" })).toHaveCount(0);
  for (const nonsense of ["abc", "99999", "-1", "2025&year=2024"]) {
    await anaPage.goto(`/app/mine/stats?year=${nonsense}`);
    await expect(year(anaPage, "2025")).toHaveAttribute("aria-current", "page");
    await expect(tile(anaPage, "Titles watched")).toHaveText("8");
  }

  // ---- Sharing --------------------------------------------------------------------------------------------------------------------------
  await anaPage.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await anaPage.addInitScript(() => Object.defineProperty(navigator, "share", { value: undefined, configurable: true }));
  await anaPage.goto("/app/mine/stats?year=2025");
  const sentence = "My 2025 on FamFlix: 8 titles, 14 h 10 min watched, 5 episodes. My top pick: Year Alpha (9/10).";
  await expect(anaPage.locator("blockquote")).toHaveText(sentence);
  await anaPage.getByRole("button", { name: "Share" }).click();
  await expect(anaPage.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  expect(await anaPage.evaluate(() => navigator.clipboard.readText())).toBe(sentence);

  // ---- Only mine: Bogdan sees his own year, with the family evening and his own score, and nothing of Ana's --------------------------------
  await bogdanPage.goto("/app/mine/stats");
  await expect(tile(bogdanPage, "Titles watched")).toHaveText("3");
  await expect(tile(bogdanPage, "Viewings")).toHaveText("3");
  await expect(tile(bogdanPage, "Episodes")).toHaveText("0");
  await expect(tile(bogdanPage, "Time watched")).toHaveText("4 h 50 min");
  const his = region(bogdanPage, "Your top 5").getByRole("listitem");
  await expect(his).toHaveCount(3);
  for (const [i, [name, score]] of [["Year Hotel", "3"], ["Year India", "2"], ["Year Alpha", "1"]].entries()) {
    await expect(his.nth(i)).toContainText(name);
    await expect(his.nth(i)).toContainText(score);
  }
  for (const secret of ["Year Bravo", "Year Charlie", "Year Foxtrot", "Year Golf", "Year Echo"]) {
    await expect(bogdanPage.getByText(secret)).toHaveCount(0);
  }

  // Someone with nothing watched gets a plain page, not an error, and someone not signed in is sent to sign in.
  await coraPage.goto("/app/mine/stats");
  await expect(coraPage.getByText("Nothing watched yet.")).toBeVisible();
  await expect(year(coraPage, "All time")).toHaveAttribute("aria-current", "page");
  await expect(coraPage.getByRole("button", { name: "Share" })).toHaveCount(0);
  const stranger = await openAnonymous(browser, testInfo.project);
  await stranger.goto("/app/mine/stats");
  await expect(stranger).toHaveURL(/\/login/);

  await Promise.all([anaPage, bogdanPage, coraPage, stranger].map((page) => page.context().close()));
});
