import { test } from "@playwright/test";

import { addTo, admin, createUser, expect, listCard, setSlider, signIn, type TestUser } from "./helpers";

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

/** One ticked episode of season 1 of someone's series on My list: its score and note, or null when it isn't ticked. */
async function myEpisode(user: TestUser, number: number) {
  const { data: item } = await admin.from("list_items").select("id").eq("added_by", user.id).is("group_id", null).maybeSingle();
  if (!item) return null;
  const { data } = await admin
    .from("episode_logs")
    .select("score, comment")
    .eq("list_item_id", item.id)
    .eq("season_number", 1)
    .eq("episode_number", number)
    .maybeSingle();
  return data ? { score: data.score as number | null, comment: data.comment as string | null } : null;
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

test("rate and note an episode: it ticks it and shows on the row, and unticking it asks first", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);

  await page.goto(CHERNOBYL);
  const episodes = page.getByRole("region", { name: "Episodes" });
  const panel = (n: number) => episodes.getByRole("group", { name: `Your rating for S1E${n}` });

  // Rating an episode ticks it, and puts the series on My list.
  await episodes.getByRole("button", { name: "Rate or add a note to S1E2" }).click();
  await setSlider(panel(2).locator('input[type="range"]'), 8.5);
  await panel(2).getByRole("textbox", { name: "Your note" }).fill("Tense and brilliant");
  await panel(2).getByRole("button", { name: "Save" }).click();
  await expect(panel(2)).toBeHidden();
  await expect(episodes.getByRole("button", { name: "Your rating for S1E2: 8.5" })).toBeVisible();
  await expect(episodes.getByText("“Tense and brilliant”")).toBeVisible();
  await expect(episodes.getByRole("checkbox", { name: /^S1E2 / })).toBeChecked();
  await expect(page.getByRole("img", { name: /On My list/ })).toBeVisible();
  await expect.poll(() => myEpisode(ana, 2)).toEqual({ score: 8.5, comment: "Tense and brilliant" });

  // Change the note; the score stays.
  await episodes.getByRole("button", { name: "Your rating for S1E2: 8.5" }).click();
  await panel(2).getByRole("textbox", { name: "Your note" }).fill("Even better the second time");
  await panel(2).getByRole("button", { name: "Save" }).click();
  await expect(episodes.getByText("“Even better the second time”")).toBeVisible();
  await expect.poll(() => myEpisode(ana, 2)).toEqual({ score: 8.5, comment: "Even better the second time" });

  // Take both off: the episode stays ticked.
  await episodes.getByRole("button", { name: "Your rating for S1E2: 8.5" }).click();
  await panel(2).getByRole("button", { name: "Remove" }).click();
  await expect(episodes.getByRole("button", { name: "Rate or add a note to S1E2" })).toBeVisible();
  await expect(episodes.getByRole("checkbox", { name: /^S1E2 / })).toBeChecked();
  await expect.poll(() => myEpisode(ana, 2)).toEqual({ score: null, comment: null });

  // A note alone is enough.
  await episodes.getByRole("button", { name: "Rate or add a note to S1E3" }).click();
  await panel(3).getByRole("textbox", { name: "Your note" }).fill("Slow burn");
  await panel(3).getByRole("button", { name: "Save" }).click();
  await expect(episodes.getByRole("button", { name: "Your note for S1E3" })).toBeVisible();
  await expect.poll(() => myEpisode(ana, 3)).toEqual({ score: null, comment: "Slow burn" });

  // Unticking an episode with a score or note asks first: "Cancel" leaves it, "OK" takes the score and note with it.
  await episodes.getByRole("button", { name: "Rate or add a note to S1E4" }).click();
  await setSlider(panel(4).locator('input[type="range"]'), 7);
  await panel(4).getByRole("button", { name: "Save" }).click();
  await expect(episodes.getByRole("button", { name: "Your rating for S1E4: 7" })).toBeVisible();
  await expect.poll(() => myEpisode(ana, 4)).toEqual({ score: 7, comment: null });
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("also removes your score and note");
    void dialog.dismiss();
  });
  await episodes.getByRole("checkbox", { name: /^S1E4 / }).click();
  await expect(episodes.getByRole("checkbox", { name: /^S1E4 / })).toBeChecked();
  await page.waitForTimeout(500);
  expect(await myEpisode(ana, 4)).toEqual({ score: 7, comment: null });
  page.once("dialog", (dialog) => void dialog.accept());
  await episodes.getByRole("checkbox", { name: /^S1E4 / }).click();
  await expect(episodes.getByRole("checkbox", { name: /^S1E4 / })).not.toBeChecked();
  await expect.poll(() => myEpisode(ana, 4)).toBeNull();

  // Rating the last episode of a series that has ended finishes it, like ticking it.
  await episodes.getByRole("button", { name: "Mark all up to S1E4" }).click();
  await expect(episodes.getByText("4 of 5 aired episodes watched")).toBeVisible();
  await episodes.getByRole("button", { name: "Rate or add a note to S1E5" }).click();
  await setSlider(panel(5).locator('input[type="range"]'), 9.5);
  await panel(5).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog", { name: "How was Chernobyl?" })).toBeVisible();
  await expect(episodes.getByText("Completed", { exact: true })).toBeVisible();
});

test("a series on My list shows how far you are, with a button for the next episode and a Watching tab", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);

  // Added without ticking anything: it is on To watch, with no progress.
  await page.goto(CHERNOBYL);
  await addTo(page, page, "My list");
  await expect(page.getByRole("img", { name: /On My list/ })).toBeVisible();
  await page.goto("/app/mine");
  await expect(page.getByRole("button", { name: /^To watch 1$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Watching/ })).toHaveCount(0);
  await expect(listCard(page, "Chernobyl").getByRole("progressbar")).toHaveCount(0);

  // The first episode, ticked on its page: now it is Watching, in a tab of its own.
  await page.goto(CHERNOBYL);
  const episodes = page.getByRole("region", { name: "Episodes" });
  await episodes.getByRole("button", { name: "Watched S1E1" }).click();
  await expect(episodes.getByText("1 of 5 aired episodes watched")).toBeVisible();
  // The tick shows at once and is saved a moment later: leaving the page before that would lose it.
  await expect.poll(async () => (await myChernobyl(ana)).ticks).toBe("1:1");
  await page.goto("/app/mine");
  await expect(page.getByRole("button", { name: /^To watch 0$/ })).toBeVisible();
  await page.getByRole("button", { name: /^Watching 1$/ }).click();
  const card = listCard(page, "Chernobyl");
  await expect(card.getByText("Watching", { exact: true })).toBeVisible();
  await expect(card.getByText("1 of 5 aired episodes")).toBeVisible();
  await expect(card.getByRole("progressbar", { name: "Chernobyl progress" })).toBeVisible();

  // One tap for the next episode, again and again.
  await card.getByRole("button", { name: "Watched S1E2" }).click();
  await expect(card.getByText("2 of 5 aired episodes")).toBeVisible();
  await card.getByRole("button", { name: "Watched S1E3" }).click();
  await expect(card.getByText("3 of 5 aired episodes")).toBeVisible();
  await card.getByRole("button", { name: "Watched S1E4" }).click();
  await expect(card.getByText("4 of 5 aired episodes")).toBeVisible();

  // The last one finishes it: we ask how it was, and it moves to Watched.
  await card.getByRole("button", { name: "Watched S1E5" }).click();
  const ask = page.getByRole("dialog", { name: "How was Chernobyl?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Later" }).click();
  await expect(page.getByRole("button", { name: /^Watching/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Watched 1$/ })).toBeVisible();
  await page.getByRole("button", { name: /^Watched 1$/ }).click();
  await expect(listCard(page, "Chernobyl").getByRole("progressbar")).toHaveCount(0);
  expect((await myChernobyl(ana)).status).toBe("watched");
});

/** A day `n` days ago the way a date field takes it (YYYY-MM-DD), in this machine's time zone like the browser's. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-CA");
/** The same day the way the app writes it: dd.mm.yyyy. */
const numeric = (iso: string) => iso.split("-").reverse().join(".");

test("start a series again as a new pass, watch an episode again, and finish the new pass", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);
  // "Start Chernobyl again?" is asked first.
  page.on("dialog", (dialog) => void dialog.accept());

  // The first time through, a month ago: the whole season, which finishes the series.
  await page.goto(CHERNOBYL);
  const episodes = page.getByRole("region", { name: "Episodes" });
  await expect(episodes.getByRole("button", { name: "Start again" })).toHaveCount(0);
  await episodes.getByRole("button", { name: "Mark season 1 watched" }).click();
  const ask = page.getByRole("dialog", { name: "How was Chernobyl?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Later" }).click();
  await expect(episodes.getByText("Completed", { exact: true })).toBeVisible();
  const { data: item } = await admin.from("list_items").select("id").eq("added_by", ana.id).single();
  await admin.from("episode_logs").update({ watched_on: daysAgo(30) }).eq("list_item_id", item!.id);

  // Start again: the ticks go to the history as pass 1, and the series is Not started, on pass 2.
  await page.reload();
  await episodes.getByRole("button", { name: "Start again" }).click();
  await expect(episodes.getByText("Not started", { exact: true })).toBeVisible();
  await expect(episodes.getByText("0 of 5 aired episodes watched")).toBeVisible();
  await expect(episodes.getByText("Watching again · pass 2")).toBeVisible();
  await expect(episodes.getByRole("button", { name: "Start again" })).toHaveCount(0);
  const { data: kept } = await admin.from("episode_history").select("pass, watched_on").eq("list_item_id", item!.id);
  expect(kept).toHaveLength(5);
  expect(kept!.every((row) => row.pass === 1 && row.watched_on === daysAgo(30))).toBe(true);
  expect((await myChernobyl(ana)).ticks).toBe("");

  // On My list it waits on To watch, and says it was seen before.
  await page.goto("/app/mine");
  await expect(listCard(page, "Chernobyl").getByText("Watch again · seen once")).toBeVisible();

  // The first episode of the new pass: it has now been watched twice, on these days.
  await page.goto(CHERNOBYL);
  await episodes.getByRole("button", { name: "Watched S1E1" }).click();
  await expect(episodes.getByText("1 of 5 aired episodes watched")).toBeVisible();
  await expect(episodes.getByText(`Watched 2× · ${numeric(daysAgo(0))}, ${numeric(daysAgo(30))}`)).toBeVisible();
  await expect(episodes.getByText("Watched 2×")).toHaveCount(1);

  // Watched it again yesterday: three days, and the one it had is in the history.
  await episodes.getByRole("button", { name: "Watched S1E1 again" }).click();
  const again = episodes.getByRole("group", { name: "Watched S1E1 again" });
  await again.getByLabel("The day you watched S1E1 again").fill(daysAgo(1));
  await again.getByRole("button", { name: "Save" }).click();
  await expect(again).toBeHidden();
  await expect(
    episodes.getByText(`Watched 3× · ${numeric(daysAgo(0))}, ${numeric(daysAgo(1))}, ${numeric(daysAgo(30))}`),
  ).toBeVisible();
  // The same day it already has is refused.
  await episodes.getByRole("button", { name: "Watched S1E1 again" }).click();
  await again.getByLabel("The day you watched S1E1 again").fill(daysAgo(1));
  await again.getByRole("button", { name: "Save" }).click();
  await expect(again.getByRole("alert")).toContainText("already has that day");
  await again.getByRole("button", { name: "Cancel" }).click();

  // Finishing the new pass completes the series again: pass 2, and it is Watched twice on My list.
  await episodes.getByRole("button", { name: "Mark season 1 watched" }).click();
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Later" }).click();
  await expect(episodes.getByText("Pass 2", { exact: true })).toBeVisible();
  await page.goto("/app/mine");
  await page.getByRole("button", { name: /^Watched 1$/ }).click();
  const card = listCard(page, "Chernobyl");
  await expect(card.getByText("Watched 2×")).toBeVisible();

  // And from its card it can be started again once more.
  await card.getByRole("button", { name: "Start again" }).click();
  await expect(page.getByRole("button", { name: /^To watch 1$/ })).toBeVisible();
  await page.getByRole("button", { name: /^To watch 1$/ }).click();
  await expect(listCard(page, "Chernobyl").getByText("Watch again · seen 2×")).toBeVisible();
  const { data: passes } = await admin.from("episode_history").select("pass").eq("list_item_id", item!.id).not("pass", "is", null);
  expect(new Set(passes!.map((row) => row.pass))).toEqual(new Set([1, 2]));
});
