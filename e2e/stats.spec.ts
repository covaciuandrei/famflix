import { test, type Page } from "@playwright/test";

import { admin, createUser, expect, openAnonymous, openAs, openFamily, startFamily } from "./helpers";
import { seedStatsFamily, seedTitles } from "./stats-seed";

// The numbers are worked out in unit/stats.spec.ts; these tests are about what the page shows, to whom, and that it
// holds together on a phone. The family is built in the database, dated to the day (see seedStatsFamily).

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
/** A number at the top of the page, by what it counts (a label can carry a hint after it, so it is matched by its start). */
const tile = (page: Page, label: string) => page.locator("dl > div", { hasText: label }).first().locator("dd");
const fact = (page: Page, card: string, label: string) =>
  region(page, card).locator("dl > div", { hasText: label });
const year = (page: Page, label: string) => page.getByRole("navigation", { name: "Year" }).getByRole("link", { name: label, exact: true });

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("family stats: the year's numbers, favourites, who watched what and taste, for the family only", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const [ana, bogdan, cora, dina] = await Promise.all(["Ana", "Bogdan", "Cora", "Dina"].map((name) => createUser(name)));
  const [anaPage, bogdanPage, coraPage, dinaPage] = await Promise.all(
    [ana, bogdan, cora, dina].map((user) => openAs(browser, testInfo.project, user)),
  );
  await startFamily(anaPage, [bogdanPage, coraPage], "Stats Family");
  await startFamily(dinaPage, [], "Other Family");
  const group = (await admin.from("groups").select("id").eq("created_by", ana.id).single()).data!.id as string;
  const otherGroup = (await admin.from("groups").select("id").eq("created_by", dina.id).single()).data!.id as string;
  await seedStatsFamily(group, ana, bogdan, cora);
  await seedTitles(otherGroup, dina.id, { Dina: dina.id }, [
    { name: "Other Secret", type: "movie", runtime: 100, genres: ["Horror"], current: { on: "2025-02-02", who: ["Dina"] }, scores: { Dina: 10 } },
  ]);

  // ---- The tab, and the newest year first ------------------------------------------------------------------------------
  await openFamily(anaPage, "Stats Family");
  await expect(anaPage.getByRole("link", { name: "List", exact: true })).toHaveAttribute("aria-current", "page");
  await anaPage.getByRole("link", { name: "Stats", exact: true }).click();
  await expect(anaPage).toHaveURL(/view=stats$/);
  await expect(anaPage.getByRole("link", { name: "Stats", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(year(anaPage, "2025")).toHaveAttribute("aria-current", "page");
  await expect(year(anaPage, "2024")).not.toHaveAttribute("aria-current", "page");
  await expect(year(anaPage, "All time")).toBeVisible();

  // 2025: the five titles (the one taken off the list too), six viewings (one title twice), 8 hours of movies (the series
  // adds none) and the two nights the family held (not the one cancelled or the one only logged).
  await expect(tile(anaPage, "Titles watched")).toHaveText("5");
  await expect(tile(anaPage, "Viewings")).toHaveText("6");
  await expect(tile(anaPage, "Movie time")).toHaveText("8 h");
  await expect(tile(anaPage, "Movie nights")).toHaveText("2");

  // The best scored first; what nobody scored is not in it.
  const top = region(anaPage, "Top 5").getByRole("listitem");
  await expect(top).toHaveCount(4);
  const ranked: [string, string][] = [
    ["Stats Bravo", "7.5 · 2 scores"],
    ["Stats Alpha", "7 · 3 scores"],
    ["Stats Delta", "6.3 · 3 scores"],
    ["Stats Charlie", "6 · 2 scores"],
  ];
  for (const [i, [name, score]] of ranked.entries()) {
    await expect(top.nth(i)).toContainText(name);
    await expect(top.nth(i)).toContainText(score);
  }
  await expect(region(anaPage, "Top 5")).not.toContainText("Stats Foxtrot");

  const genres = region(anaPage, "Favourite genres").getByRole("listitem");
  await expect(genres).toHaveCount(4);
  const liked: [string, string][] = [
    ["Comedy", "3 titles"],
    ["Drama", "2 titles"],
    ["Crime", "1 title"],
    ["Family", "1 title"],
  ];
  for (const [i, [genre, count]] of liked.entries()) {
    await expect(genres.nth(i)).toContainText(genre);
    await expect(genres.nth(i)).toContainText(count);
  }

  await expect(fact(anaPage, "Highlights", "Most loved")).toContainText("Stats Alpha · 2 likes");
  await expect(fact(anaPage, "Highlights", "Most divisive")).toContainText("Stats Delta · scores from 2 to 9");
  await expect(fact(anaPage, "Highlights", "Busiest month")).toContainText("March 2025 · 2 viewings");

  await expect(region(anaPage, "Watched again").getByRole("listitem")).toHaveCount(1);
  await expect(region(anaPage, "Watched again")).toContainText("Stats Charlie");
  await expect(region(anaPage, "Watched again")).toContainText("2 times");

  const people = region(anaPage, "Who watched what").getByRole("listitem");
  await expect(people).toHaveCount(3);
  const who: [string, string][] = [
    ["Ana", "6 viewings · 5 titles"],
    ["Bogdan", "4 viewings · 4 titles"],
    ["Cora", "4 viewings · 3 titles"],
  ];
  for (const [i, [name, text]] of who.entries()) {
    await expect(people.nth(i)).toContainText(name);
    await expect(people.nth(i)).toContainText(text);
  }

  // Ana and Bogdan score alike (93%), Ana and Cora don't (52%); Bogdan and Cora have only two titles in common, too few to say.
  await expect(fact(anaPage, "Taste", "Closest taste")).toContainText("Ana & Bogdan · 93% alike · 3 titles scored by both");
  await expect(fact(anaPage, "Taste", "Most different")).toContainText("Ana & Cora · 52% alike · 3 titles scored by both");

  // The months as a chart: the numbers are there for people who can't see the bars.
  await expect(region(anaPage, "Viewings by month").getByText("March 2025: 2 viewings")).toBeAttached();
  await expect(region(anaPage, "Viewings by month").getByText("January 2025: 0 viewings")).toBeAttached();
  await expect(region(anaPage, "Viewings by month").getByText("December 2025: 1 viewing", { exact: true })).toBeAttached();
  await expect(region(anaPage, "Viewings by month").getByRole("listitem")).toHaveCount(12);
  await noSideways(anaPage);

  // ---- Another year, and all time ---------------------------------------------------------------------------------------
  await year(anaPage, "2024").click();
  await expect(anaPage).toHaveURL(/view=stats&year=2024$/);
  await expect(year(anaPage, "2024")).toHaveAttribute("aria-current", "page");
  await expect(tile(anaPage, "Titles watched")).toHaveText("2");
  await expect(tile(anaPage, "Viewings")).toHaveText("2");
  await expect(tile(anaPage, "Movie time")).toHaveText("3 h 30 min");
  await expect(tile(anaPage, "Movie nights")).toHaveText("1");
  await expect(region(anaPage, "Top 5").getByRole("listitem")).toHaveCount(2);
  // Alpha from the history (watched again in 2025) and Echo, and no taste: only one title was scored by two of them.
  await expect(region(anaPage, "Top 5")).toContainText("Stats Alpha");
  await expect(region(anaPage, "Top 5")).toContainText("Stats Echo");
  await expect(region(anaPage, "Top 5")).not.toContainText("Stats Bravo");
  await expect(region(anaPage, "Taste")).toContainText("Taste shows up once two of you have scored at least 3 of the same titles.");
  await expect(region(anaPage, "Viewings by month").getByText("December 2024: 1 viewing", { exact: true })).toBeAttached();

  await year(anaPage, "All time").click();
  await expect(anaPage).toHaveURL(/view=stats&year=all$/);
  await expect(year(anaPage, "All time")).toHaveAttribute("aria-current", "page");
  await expect(tile(anaPage, "Titles watched")).toHaveText("6");
  await expect(tile(anaPage, "Viewings")).toHaveText("8");
  await expect(tile(anaPage, "Movie time")).toHaveText("11 h 30 min");
  await expect(tile(anaPage, "Movie nights")).toHaveText("3");
  await expect(region(anaPage, "Watched again").getByRole("listitem")).toHaveCount(2);
  await expect(region(anaPage, "Viewings by year").getByText("2024: 2 viewings")).toBeAttached();
  await expect(region(anaPage, "Viewings by year").getByText("2025: 6 viewings")).toBeAttached();

  // A year with nothing in it, and nonsense in the address.
  await anaPage.goto(`/app/family/${group}?view=stats&year=2019`);
  await expect(anaPage.getByText("Nothing watched together in 2019.")).toBeVisible();
  await expect(year(anaPage, "2019")).toHaveAttribute("aria-current", "page");
  await expect(anaPage.getByRole("button", { name: "Share" })).toHaveCount(0);
  for (const nonsense of ["abc", "20x6", "99999", "-1", "2025&year=2024"]) {
    await anaPage.goto(`/app/family/${group}?view=stats&year=${nonsense}`);
    await expect(year(anaPage, "2025")).toHaveAttribute("aria-current", "page");
    await expect(tile(anaPage, "Titles watched")).toHaveText("5");
  }

  // ---- Sharing: what is sent is what is shown, and has nobody's name in it ----------------------------------------------------
  await anaPage.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await anaPage.addInitScript(() => Object.defineProperty(navigator, "share", { value: undefined, configurable: true }));
  await anaPage.goto(`/app/family/${group}?view=stats&year=2025`);
  const preview = anaPage.locator("blockquote");
  const sentence = "Our 2025 on FamFlix: 5 titles watched together, 8 h of movies, 2 movie nights. Our top pick: Stats Bravo (7.5/10).";
  await expect(preview).toHaveText(sentence);
  await anaPage.getByRole("button", { name: "Share" }).click();
  await expect(anaPage.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  expect(await anaPage.evaluate(() => navigator.clipboard.readText())).toBe(sentence);
  // On a phone with a share sheet, the same text goes to it.
  await anaPage.evaluate(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    Object.defineProperty(navigator, "share", {
      value: async (data: unknown) => (window as unknown as { shared: unknown[] }).shared.push(data),
      configurable: true,
    });
  });
  await anaPage.getByRole("button", { name: "Share" }).click();
  await expect.poll(() => anaPage.evaluate(() => (window as unknown as { shared: unknown[] }).shared)).toEqual([{ text: sentence }]);

  // ---- The other tabs still work -------------------------------------------------------------------------------------------------
  await anaPage.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(anaPage).toHaveURL(/view=activity$/);
  await expect(anaPage.getByRole("link", { name: "Activity", exact: true })).toHaveAttribute("aria-current", "page");
  await anaPage.getByRole("link", { name: "List", exact: true }).click();
  await expect(anaPage.getByRole("link", { name: "List", exact: true })).toHaveAttribute("aria-current", "page");
  await anaPage.getByRole("button", { name: /^Watched together/ }).click();
  await expect(anaPage.getByRole("link", { name: "Stats Bravo", exact: true })).toBeVisible();

  // ---- Only the family sees it, and nothing of another family is in it ------------------------------------------------------------
  await anaPage.goto(`/app/family/${group}?view=stats&year=all`);
  await expect(anaPage.getByText("Other Secret")).toHaveCount(0);
  await expect(tile(anaPage, "Titles watched")).toHaveText("6");
  // Dina is in another family: she can't open this one's stats, whatever the year, and sees nothing of it.
  for (const view of ["stats&year=2025", "stats&year=all", "stats"]) {
    await dinaPage.goto(`/app/family/${group}?view=${view}`);
    await expect(dinaPage.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
    await expect(dinaPage.getByText("Stats Bravo")).toHaveCount(0);
  }
  await openFamily(dinaPage, "Other Family");
  await dinaPage.getByRole("link", { name: "Stats", exact: true }).click();
  await expect(tile(dinaPage, "Titles watched")).toHaveText("1");
  await expect(region(dinaPage, "Top 5")).toContainText("Other Secret");
  await expect(dinaPage.getByText("Stats Bravo")).toHaveCount(0);
  // Someone who isn't signed in is sent to sign in.
  const stranger = await openAnonymous(browser, testInfo.project);
  await stranger.goto(`/app/family/${group}?view=stats`);
  await expect(stranger).toHaveURL(/\/login/);
  await expect(stranger.getByText("Stats Bravo")).toHaveCount(0);

  await Promise.all([anaPage, bogdanPage, coraPage, dinaPage, stranger].map((page) => page.context().close()));
});
