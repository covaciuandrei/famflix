import { test } from "@playwright/test";

import { admin, createUser, expect, signIn, type TestUser } from "./helpers";

// Chernobyl (TMDB 87108): a miniseries that has ended, one season of five episodes.
const CHERNOBYL = "/app/media/tv/87108";

/** The series' entry on someone's My list and the episodes ticked on it ("1:1,1:3"). */
async function myChernobyl(user: TestUser) {
  const { data: item } = await admin
    .from("list_items")
    .select("id, status, watched_at")
    .eq("added_by", user.id)
    .is("group_id", null)
    .single();
  const { data: logs } = await admin
    .from("episode_logs")
    .select("season_number, episode_number")
    .eq("list_item_id", item!.id)
    .order("episode_number");
  return {
    status: item!.status as string,
    dated: item!.watched_at !== null,
    ticks: (logs ?? []).map((l) => `${l.season_number}:${l.episode_number}`).join(","),
  };
}

test("tick the episodes of a series: the next one, one by one, up to an episode, and the last one finishes it", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);

  await page.goto(CHERNOBYL);
  const episodes = page.getByRole("region", { name: "Episodes" });
  await expect(episodes.getByText("Not started", { exact: true })).toBeVisible();
  await expect(episodes.getByText("0 of 5 aired episodes watched")).toBeVisible();
  await expect(episodes.getByText("Next: S1E1 · 1:23:45")).toBeVisible();
  await expect(episodes.getByText("Ticking an episode puts this series on My list.")).toBeVisible();
  // The season that is next is open, with its five episodes (the name of the first one is "1:23:45").
  await expect(episodes.getByRole("checkbox")).toHaveCount(5);
  await expect(episodes.getByRole("checkbox", { name: "S1E1 1:23:45" })).not.toBeChecked();

  // One tap on the next episode, and the series is on My list as one being watched.
  await episodes.getByRole("button", { name: "Watched S1E1" }).click();
  await expect(episodes.getByText("1 of 5 aired episodes watched")).toBeVisible();
  await expect(episodes.getByText("Watching", { exact: true })).toBeVisible();
  await expect(episodes.getByRole("checkbox", { name: /^S1E1 / })).toBeChecked();
  await expect(page.getByRole("img", { name: /On My list/ })).toBeVisible();
  await expect(episodes.getByText("Ticking an episode puts this series on My list.")).toHaveCount(0);
  await expect.poll(async () => (await myChernobyl(ana)).ticks).toBe("1:1");

  // One by one, with the tick; the next episode follows what is ticked.
  await episodes.getByRole("checkbox", { name: /^S1E3 / }).check();
  await expect(episodes.getByText("2 of 5 aired episodes watched")).toBeVisible();
  await expect(episodes.getByText(/^Next: S1E2/)).toBeVisible();
  await expect.poll(async () => (await myChernobyl(ana)).ticks).toBe("1:1,1:3");

  // Everything up to an episode, for catching up.
  await episodes.getByRole("button", { name: "Mark all up to S1E4" }).click();
  await expect(episodes.getByText("4 of 5 aired episodes watched")).toBeVisible();
  await expect.poll(async () => (await myChernobyl(ana)).ticks).toBe("1:1,1:2,1:3,1:4");
  expect((await myChernobyl(ana)).status).toBe("want");

  // The last episode of a series that has ended finishes it: it is Watched, and we ask how it was.
  await episodes.getByRole("checkbox", { name: /^S1E5 / }).check();
  const ask = page.getByRole("dialog", { name: "How was Chernobyl?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Later" }).click();
  await expect(episodes.getByText("Completed", { exact: true })).toBeVisible();
  await expect(episodes.getByText(/You've watched all of it/)).toBeVisible();
  await expect.poll(async () => (await myChernobyl(ana)).status).toBe("watched");
  expect((await myChernobyl(ana)).dated).toBe(true);

  // Unticking an episode of a Watched series opens it up again with every other episode still ticked.
  await episodes.getByRole("checkbox", { name: /^S1E2 / }).uncheck();
  await expect(episodes.getByText("Watching", { exact: true })).toBeVisible();
  await expect(episodes.getByText("4 of 5 aired episodes watched")).toBeVisible();
  await expect(episodes.getByRole("checkbox", { name: /^S1E2 / })).not.toBeChecked();
  await expect(episodes.getByRole("checkbox", { name: /^S1E4 / })).toBeChecked();
  await expect.poll(async () => (await myChernobyl(ana)).status).toBe("want");
  expect((await myChernobyl(ana)).ticks).toBe("1:1,1:3,1:4,1:5");
  expect((await myChernobyl(ana)).dated).toBe(false);

  // A whole season, and un-doing it.
  await episodes.getByRole("button", { name: "Mark season 1 watched" }).click();
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Later" }).click();
  await expect(episodes.getByText("Completed", { exact: true })).toBeVisible();
  await episodes.getByRole("button", { name: "Unmark season 1" }).click();
  await expect(episodes.getByText("Not started", { exact: true })).toBeVisible();
  await expect.poll(async () => (await myChernobyl(ana)).ticks).toBe("");

  // The page follows the database: after a reload it is the same.
  await page.reload();
  await expect(page.getByRole("region", { name: "Episodes" }).getByText("0 of 5 aired episodes watched")).toBeVisible();
});

test("marking a series watched shows every episode as watched, and un-marking brings back the ticks", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);

  await page.goto(CHERNOBYL);
  const episodes = page.getByRole("region", { name: "Episodes" });
  await episodes.getByRole("button", { name: "Watched S1E1" }).click();
  await expect(episodes.getByText("1 of 5 aired episodes watched")).toBeVisible();

  await page.getByRole("button", { name: "Mark as watched" }).click();
  const ask = page.getByRole("dialog", { name: "How was Chernobyl?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Later" }).click();
  await expect(episodes.getByText("Completed", { exact: true })).toBeVisible();
  await expect(episodes.getByRole("checkbox", { name: /^S1E5 / })).toBeChecked();
  // The ticks themselves weren't rewritten.
  expect((await myChernobyl(ana)).ticks).toBe("1:1");

  await page.getByRole("button", { name: "Watched", exact: true }).click();
  await expect(episodes.getByText("Watching", { exact: true })).toBeVisible();
  await expect(episodes.getByText("1 of 5 aired episodes watched")).toBeVisible();
  await expect(episodes.getByRole("checkbox", { name: /^S1E5 / })).not.toBeChecked();
});
