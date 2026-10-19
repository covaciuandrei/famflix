import { test, type Page } from "@playwright/test";

import { addTo, admin, createUser, expect, listCard, openAs, openFamily, signIn, startFamily, type TestUser } from "./helpers";
import { tile } from "./stats-page";

// The day a title or an episode was watched on: picked when it is marked, changed afterwards, or "I don't remember"
// (it stays watched but is not counted in Your year).

/** A day `n` days ago the way a date field takes it (YYYY-MM-DD), in this machine's time zone like the browser's. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-CA");
/** The same day the way the app writes it: dd.mm.yyyy. */
const numeric = (iso: string) => iso.split("-").reverse().join(".");

const DUNE = "/app/media/movie/438631";
// Chernobyl (TMDB 87108): a miniseries that has ended, one season of five episodes.
const CHERNOBYL = "/app/media/tv/87108";

/** A person's only entry on My list (null before it exists): whether it is watched, and when (null: no day), as a UTC moment. */
async function myEntry(user: TestUser) {
  const { data } = await admin
    .from("list_items")
    .select("id, status, watched_at")
    .eq("added_by", user.id)
    .is("group_id", null)
    .maybeSingle();
  if (!data) return null;
  // The database answers in its own time zone: the same moment, written in UTC.
  const watchedAt = data.watched_at ? new Date(data.watched_at as string).toISOString() : null;
  return { id: data.id as string, status: data.status as string, watchedAt };
}

/** The episodes ticked on it, as [episode, day] (the day is null when nobody remembers it). */
async function myTicks(user: TestUser) {
  const entry = await myEntry(user);
  if (!entry) return [];
  const { data } = await admin
    .from("episode_logs")
    .select("episode_number, watched_on")
    .eq("list_item_id", entry.id)
    .order("episode_number");
  return (data ?? []).map((t) => [t.episode_number, t.watched_on] as [number, string | null]);
}

/** My list's Watched tab. */
async function openWatched(page: Page, count: number) {
  await page.goto("/app/mine");
  await page.getByRole("button", { name: new RegExp(`^Watched ${count}$`) }).click();
}

test("mark a movie watched on a day, change it, then say you don't remember: its page, My list and Your year follow", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);

  // The popup after marking it asks the day too (today to start with); this one was watched in 2023.
  await page.goto(DUNE);
  await page.getByRole("button", { name: "Mark as watched" }).click();
  const ask = page.getByRole("dialog", { name: "How was Dune?" });
  await expect(ask.getByLabel("Watched on")).toHaveValue(daysAgo(0));
  await ask.getByLabel("Watched on").fill("2023-05-14");
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(ask).toBeHidden();
  await expect.poll(async () => (await myEntry(ana))?.watchedAt).toBe("2023-05-14T12:00:00.000Z");
  await expect(page.getByText("Watched 14.05.2023")).toBeVisible();

  // It counts in 2023 and in no other year.
  await page.goto("/app/mine/stats?year=2023");
  await expect(tile(page, "Titles watched")).toHaveText("1");
  await page.goto(`/app/mine/stats?year=${new Date().getFullYear()}`);
  await expect(page.getByText(/^Nothing watched in \d{4}\.$/)).toBeVisible();

  // On My list the card says the day too.
  await openWatched(page, 1);
  await expect(listCard(page, "Dune").getByText("Watched 14.05.2023")).toBeVisible();

  // A day in the future can't be saved.
  await page.goto(DUNE);
  await page.getByRole("button", { name: "Change date for Dune" }).click();
  const change = page.getByRole("dialog", { name: "When did you watch Dune?" });
  await expect(change.getByLabel("Watched on")).toHaveValue("2023-05-14");
  await change.getByLabel("Watched on").fill(daysAgo(-5));
  await expect(change.getByRole("button", { name: "Save" })).toBeDisabled();

  // "I don't remember": it stays watched, with no day.
  await change.getByLabel("I don't remember").check();
  await expect(change.getByLabel("Watched on")).toBeDisabled();
  await change.getByRole("button", { name: "Save" }).click();
  await expect(change).toBeHidden();
  await expect.poll(() => myEntry(ana)).toMatchObject({ status: "watched", watchedAt: null });
  await expect(page.getByText("Date unknown")).toBeVisible();
  await expect(page.getByRole("button", { name: "Watched", exact: true })).toBeVisible();

  // On My list it says so, and no year counts it, not even all time.
  await openWatched(page, 1);
  await expect(listCard(page, "Dune").getByText("Date unknown")).toBeVisible();
  await page.goto("/app/mine/stats?year=all");
  await expect(page.getByText("Nothing watched yet.")).toBeVisible();

  // Putting a day back, from the card: it counts again.
  await openWatched(page, 1);
  await listCard(page, "Dune").getByRole("button", { name: "Change date for Dune" }).click();
  const back = page.getByRole("dialog", { name: "When did you watch Dune?" });
  await expect(back.getByLabel("I don't remember")).toBeChecked();
  await back.getByLabel("I don't remember").uncheck();
  await back.getByLabel("Watched on").fill(daysAgo(3));
  await back.getByRole("button", { name: "Save" }).click();
  await expect(listCard(page, "Dune").getByText(`Watched ${numeric(daysAgo(3))}`)).toBeVisible();
  await expect.poll(async () => (await myEntry(ana))?.watchedAt).toBe(`${daysAgo(3)}T12:00:00.000Z`);
  await page.goto("/app/mine/stats?year=all");
  await expect(tile(page, "Titles watched")).toHaveText("1");
});

test("marking a title watched from its card with \"I don't remember\" keeps it watched, out of Your year", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);
  await page.goto(DUNE);
  await addTo(page, page, "My list");
  await expect(page.getByRole("img", { name: /On My list/ })).toBeVisible();
  await page.goto("/app/mine");
  await expect(page.getByRole("button", { name: /^To watch 1$/ })).toBeVisible();

  await listCard(page, "Dune").getByRole("button", { name: "Mark watched" }).click();
  const ask = page.getByRole("dialog", { name: "How was Dune?" });
  await ask.getByLabel("I don't remember").check();
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(ask).toBeHidden();
  await expect.poll(() => myEntry(ana)).toMatchObject({ status: "watched", watchedAt: null });

  await openWatched(page, 1);
  await expect(listCard(page, "Dune").getByText("Date unknown")).toBeVisible();
  await page.goto("/app/mine/stats?year=all");
  await expect(page.getByText("Nothing watched yet.")).toBeVisible();
});

test("catching up on a series: several episodes get a day or none, and each day can be changed", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);
  await page.goto(CHERNOBYL);
  const episodes = page.getByRole("region", { name: "Episodes" });

  // Up to episode 3, on a day a month ago: it is asked first, for all three.
  await episodes.getByRole("button", { name: "Mark all up to S1E3" }).click();
  const when = page.getByRole("dialog", { name: "When did you watch these 3 episodes?" });
  await expect(when.getByLabel("Watched on")).toHaveValue(daysAgo(0));
  await when.getByLabel("Watched on").fill(daysAgo(30));
  await when.getByRole("button", { name: "Mark watched" }).click();
  await expect(episodes.getByText("3 of 5 aired episodes watched")).toBeVisible();
  await expect.poll(() => myTicks(ana)).toEqual([
    [1, daysAgo(30)],
    [2, daysAgo(30)],
    [3, daysAgo(30)],
  ]);
  await expect(episodes.getByText(`Watched ${numeric(daysAgo(30))}`)).toHaveCount(3);

  // The rest of the season with no day: the series is finished (asks how it was, which has no day to pick).
  await episodes.getByRole("button", { name: "Mark rest of season 1 watched" }).click();
  const rest = page.getByRole("dialog", { name: "When did you watch these 2 episodes?" });
  await rest.getByLabel("I don't remember").check();
  await rest.getByRole("button", { name: "Mark watched" }).click();
  const ask = page.getByRole("dialog", { name: "How was Chernobyl?" });
  await expect(ask).toBeVisible();
  await expect(ask.getByLabel("Watched on")).toHaveCount(0);
  await ask.getByRole("button", { name: "Later" }).click();
  await expect(episodes.getByText("Completed", { exact: true })).toBeVisible();
  await expect.poll(() => myTicks(ana)).toEqual([
    [1, daysAgo(30)],
    [2, daysAgo(30)],
    [3, daysAgo(30)],
    [4, null],
    [5, null],
  ]);
  // Finished with ticks that have no day, so the series has none either.
  expect(await myEntry(ana)).toMatchObject({ status: "watched", watchedAt: null });
  await expect(episodes.getByText("Date unknown")).toHaveCount(2);

  // One of them gets its day after all.
  await episodes.getByRole("button", { name: "Change date for S1E4" }).click();
  const change = page.getByRole("dialog", { name: "When did you watch S1E4?" });
  await expect(change.getByLabel("I don't remember")).toBeChecked();
  await change.getByLabel("I don't remember").uncheck();
  await change.getByLabel("Watched on").fill(daysAgo(2));
  await change.getByRole("button", { name: "Save" }).click();
  await expect(episodes.getByText(`Watched ${numeric(daysAgo(2))}`)).toBeVisible();
  await expect(episodes.getByText("Date unknown")).toHaveCount(1);
  await expect.poll(() => myTicks(ana)).toEqual([
    [1, daysAgo(30)],
    [2, daysAgo(30)],
    [3, daysAgo(30)],
    [4, daysAgo(2)],
    [5, null],
  ]);

  // Your year counts the four episodes that have a day, not the one that has none.
  await page.goto("/app/mine/stats?year=all");
  await expect(tile(page, "Episodes")).toHaveText("4");

  // The page follows the database: after a reload it is the same.
  await page.goto(CHERNOBYL);
  await expect(page.getByRole("region", { name: "Episodes" }).getByText("Date unknown")).toHaveCount(1);
});

test("a family's watch shows its day with who was there, and a member's My list keeps the family's day", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const bogdan = await createUser("Bogdan");
  const anaPage = await openAs(browser, testInfo.project, ana);
  const bogdanPage = await openAs(browser, testInfo.project, bogdan);
  await startFamily(anaPage, [bogdanPage], "Dates family");

  await anaPage.goto(DUNE);
  await addTo(anaPage, anaPage, "Dates family");
  await expect(anaPage.getByRole("img", { name: /On Dates family/ })).toBeVisible();
  await openFamily(anaPage, "Dates family");
  await anaPage.getByRole("button", { name: "Watched together", exact: true }).click();
  const log = anaPage.getByRole("dialog", { name: /Who watched Dune/ });
  await log.locator('input[type="date"]').fill(daysAgo(10));
  await log.getByRole("checkbox", { name: "Bogdan" }).check();
  await log.getByRole("button", { name: "Save" }).click();
  await expect(log).toBeHidden();

  // On the family's list, for everyone on it: the day, and who was there.
  await anaPage.getByRole("button", { name: /^Watched together \d+$/ }).click();
  await expect(listCard(anaPage, "Dune").getByText(`Watched ${numeric(daysAgo(10))} · You, Bogdan`)).toBeVisible();
  // Bogdan was marked as having watched it: the "How did you like it?" popup opens by itself, and the Families page tells
  // him there is a rating waiting, so his list is opened directly and the popup closed with "Later".
  const group = (await admin.from("groups").select("id").eq("created_by", ana.id).single()).data!.id as string;
  await bogdanPage.goto(`/app/family/${group}`);
  const request = bogdanPage.getByRole("dialog", { name: "How did you like it?" });
  await expect(request).toBeVisible();
  await request.getByRole("button", { name: "Later" }).click();
  await expect(request).toBeHidden();
  await bogdanPage.getByRole("button", { name: /^Watched together \d+$/ }).click();
  await expect(listCard(bogdanPage, "Dune").getByText(`Watched ${numeric(daysAgo(10))} · You, Ana`)).toBeVisible();

  // On Bogdan's My list it is the family's day: it says so, and can't be changed there.
  await openWatched(bogdanPage, 1);
  const mine = listCard(bogdanPage, "Dune");
  await expect(mine.getByText(`Watched with Ana on ${numeric(daysAgo(10))}`)).toBeVisible();
  await expect(mine.getByRole("button", { name: /Change date/ })).toHaveCount(0);
  await Promise.all([anaPage, bogdanPage].map((p) => p.context().close()));
});
