import { randomUUID } from "node:crypto";

import { test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { formatDay } from "../src/lib/format";
import { admin, expect, listCard, openFamily, type TestUser } from "./helpers";
import { closeAll, makeFamily } from "./night-helpers";

// Changing who watched a movie night that is over, and deleting it, from its page. The nights are made straight in the
// test database, as a family logging a title as Watched together does (that puts a night in its history), so none of
// this needs TMDB.

const FAMILY = "Edit family";

/** A day `n` days ago the way a date field takes it (YYYY-MM-DD), in this machine's time zone like the browser's. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-CA");
/** The same day the way My list writes it: dd.mm.yyyy. */
const numeric = (iso: string) => iso.split("-").reverse().join(".");

function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as NonNullable<T>;
}

/** For what is only done, not read back. */
function check(result: { error: { message: string } | null }, what: string) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
}

/** Somebody's own connection to the database, as their browser has it. */
async function connectAs(user: TestUser): Promise<SupabaseClient> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}

async function familyOf(user: TestUser): Promise<string> {
  return must(await admin.from("group_members").select("group_id").eq("user_id", user.id).single(), "the family").group_id;
}

interface Night {
  group: string;
  title: string;
  itemId: string;
  mediaId: string;
  tmdbId: number;
  nightId: string;
}

/**
 * A new title on the family's list that `logger` logs as watched together by `viewers`, `daysBack` days ago, with a score
 * filled in for whoever is in `scores`. `before` runs once the title is on the list and before it is logged.
 */
async function loggedNight(
  group: string,
  logger: TestUser,
  viewers: TestUser[],
  daysBack: number,
  options: { scores?: Record<string, number>; before?: (itemId: string) => Promise<void> } = {},
): Promise<Night> {
  const title = `Edit night ${randomUUID().slice(0, 6)}`;
  const tmdbId = 300_000_000 + Math.floor(Math.random() * 90_000_000);
  const media = must(
    await admin
      .from("media")
      .insert({ tmdb_id: tmdbId, media_type: "movie", title, release_year: 2021, runtime: 120, genres: [] })
      .select("id")
      .single(),
    "the title",
  );
  const item = must(
    await admin
      .from("list_items")
      .insert({ group_id: group, added_by: logger.id, media_id: media.id, status: "want" })
      .select("id")
      .single(),
    "the list entry",
  );
  await options.before?.(item.id);
  const me = await connectAs(logger);
  check(
    await me.rpc("log_watch", {
      p_item: item.id,
      p_watched_on: daysAgo(daysBack),
      p_viewers: viewers.map((v) => ({ user_id: v.id, score: options.scores?.[v.id] ?? null })),
    }),
    "logging the watch",
  );
  const night = must(await admin.from("movie_nights").select("id").eq("picked_list_item_id", item.id).single(), "the night");
  return { group, title, itemId: item.id, mediaId: media.id, tmdbId, nightId: night.id };
}

const history = (page: Page) => page.locator("#movie-nights");
const watchedBy = (page: Page) => page.getByRole("list", { name: "Who watched it" });
const menu = (page: Page) => page.getByRole("button", { name: "Movie night menu" });
const editDialog = (page: Page, night: Night) => page.getByRole("dialog", { name: `Who watched ${night.title}?` });
const deleteDialog = (page: Page) => page.getByRole("dialog", { name: "Delete this movie night?" });

/** From the family's Movie night page, through its history, to the page of the night. */
async function openNight(page: Page, night: Night) {
  await page.goto(`/app/movie-night?who=${night.group}`);
  await history(page).getByRole("link", { name: night.title }).click();
  await expect(page).toHaveURL(new RegExp(`/app/movie-night/${night.nightId}$`));
  await expect(menu(page)).toBeVisible();
}

async function choose(page: Page, item: string) {
  await menu(page).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** The banner above a night that is over says on which day it was. */
const dayBanner = (page: Page, day: string) => page.getByRole("status").filter({ hasText: `on ${formatDay(day)}` });

const onMyList = async (user: TestUser, night: Night) =>
  must(
    await admin
      .from("list_items")
      .select("id")
      .is("group_id", null)
      .eq("added_by", user.id)
      .eq("media_id", night.mediaId)
      .is("deleted_at", null),
    "My list",
  ).length > 0;

const whoIsOnIt = async (night: Night) =>
  must(await admin.from("watches").select("user_id").eq("list_item_id", night.itemId), "the record").map(
    (w: { user_id: string }) => w.user_id,
  );

async function openFeed(page: Page) {
  await openFamily(page, FAMILY);
  await page.getByRole("link", { name: "Activity" }).click();
}

test("a person who was left out is added to a night, and the day is put right", async ({ browser }, testInfo) => {
  const {
    users: [ana, bogdan, cora],
    pages: [anaPage, bogdanPage, coraPage],
  } = await makeFamily(browser, testInfo.project, FAMILY, ["Ana", "Bogdan", "Cora"]);
  const night = await loggedNight(await familyOf(ana), ana, [ana, bogdan], 3);

  await openNight(anaPage, night);
  await expect(watchedBy(anaPage)).toContainText("Bogdan");
  await expect(watchedBy(anaPage)).not.toContainText("Cora");
  await expect(dayBanner(anaPage, daysAgo(3))).toBeVisible();
  await expect(anaPage.getByRole("link", { name: `Open ${night.title}` })).toHaveAttribute(
    "href",
    `/app/media/movie/${night.tmdbId}`,
  );

  // Cora was left out, and it was two days ago, not three.
  await choose(anaPage, "Edit who watched");
  const dialog = editDialog(anaPage, night);
  await expect(dialog.getByRole("checkbox", { name: "Ana" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Bogdan" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Cora" })).not.toBeChecked();
  await expect(dialog.locator('input[type="date"]')).toHaveValue(daysAgo(3));
  // Only the people who are added are asked for a score.
  await expect(dialog.getByLabel("Score for Bogdan")).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "Cora" }).check();
  await expect(dialog.getByLabel("Score for Cora")).toBeVisible();
  await dialog.locator('input[type="date"]').fill(daysAgo(2));
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  await expect(watchedBy(anaPage)).toContainText("Cora");
  await expect(dayBanner(anaPage, daysAgo(2))).toBeVisible();
  await expect(anaPage.getByText("Saved.", { exact: true })).toBeVisible();

  // Everyone is on the record, on the new day.
  const watches = must(await admin.from("watches").select("user_id, watched_on").eq("list_item_id", night.itemId), "the record");
  expect(watches.map((w: { user_id: string }) => w.user_id).sort()).toEqual([ana.id, bogdan.id, cora.id].sort());
  expect(new Set(watches.map((w: { watched_on: string }) => w.watched_on))).toEqual(new Set([daysAgo(2)]));
  // Cora has it on her My list with the others, and is asked how she liked it.
  await coraPage.goto("/app/mine");
  const ask = coraPage.getByRole("dialog", { name: "How did you like it?" });
  await expect(ask).toContainText(night.title);
  await expect(ask).toContainText(`Ana logged it on ${formatDay(daysAgo(2))}`);
  await ask.getByRole("button", { name: "Later" }).click();
  await coraPage.getByRole("button", { name: /^Watched \d+$/ }).click();
  await expect(listCard(coraPage, night.title).getByText(`Watched with Ana, Bogdan on ${numeric(daysAgo(2))}`)).toBeVisible();
  // Bogdan, who was there all along, sees the same day and the new face.
  await bogdanPage.goto("/app/mine");
  await bogdanPage.getByRole("dialog", { name: "How did you like it?" }).getByRole("button", { name: "Later" }).click();
  await bogdanPage.getByRole("button", { name: /^Watched \d+$/ }).click();
  await expect(listCard(bogdanPage, night.title).getByText(`Watched with Ana, Cora on ${numeric(daysAgo(2))}`)).toBeVisible();

  // The history and the feed say so.
  await anaPage.goto(`/app/movie-night?who=${night.group}`);
  await expect(history(anaPage).getByRole("link", { name: night.title })).toContainText(formatDay(daysAgo(2)));
  await openFeed(anaPage);
  await expect(
    anaPage.getByText(`You edited the movie night for ${night.title}: now watched by Ana, Bogdan, Cora`),
  ).toBeVisible();
  await closeAll([anaPage, bogdanPage, coraPage]);
});

test("someone who rated it can only take themselves off, anyone else can be taken off", async ({ browser }, testInfo) => {
  const {
    users: [ana, bogdan, cora],
    pages: [anaPage, , coraPage],
  } = await makeFamily(browser, testInfo.project, FAMILY, ["Ana", "Bogdan", "Cora"]);
  const night = await loggedNight(await familyOf(ana), ana, [ana, bogdan, cora], 1);
  check(
    await (await connectAs(bogdan)).from("ratings").insert({ list_item_id: night.itemId, user_id: bogdan.id, score: 9 }),
    "Bogdan's score",
  );

  await openNight(anaPage, night);
  await choose(anaPage, "Edit who watched");
  const dialog = editDialog(anaPage, night);
  // Bogdan rated it: his box stays ticked, with the reason. Cora didn't, so she can be taken off.
  const bogdanBox = dialog.getByRole("checkbox", { name: "Bogdan" });
  await expect(bogdanBox).toBeChecked();
  await expect(bogdanBox).toBeDisabled();
  await expect(dialog.getByText(/only they can take themselves off it/)).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Cora" })).toBeEnabled();
  await dialog.getByRole("checkbox", { name: "Cora" }).uncheck();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  await expect(watchedBy(anaPage)).not.toContainText("Cora");
  await expect(watchedBy(anaPage)).toContainText("Bogdan");
  expect((await whoIsOnIt(night)).sort()).toEqual([ana.id, bogdan.id].sort());
  expect(await onMyList(cora, night)).toBe(false);
  expect(await onMyList(bogdan, night)).toBe(true);
  // Bogdan's score is still there, and Cora's list no longer shows the title.
  expect(must(await admin.from("ratings").select("score").eq("list_item_id", night.itemId).eq("user_id", bogdan.id), "score")).toHaveLength(1);
  await coraPage.goto("/app/mine");
  await expect(coraPage.getByRole("link", { name: night.title, exact: true })).toHaveCount(0);
  await closeAll([anaPage, coraPage]);
});

test("someone who only left a note stays on the night, even when a score was filled in beside it", async ({ browser }, testInfo) => {
  const {
    users: [ana, bogdan, cora],
    pages: [anaPage, , coraPage],
  } = await makeFamily(browser, testInfo.project, FAMILY, ["Ana", "Bogdan", "Cora"]);
  // Cora wrote a note and nothing else; Ana then logged the night with a score of her own for Cora.
  const night = await loggedNight(await familyOf(ana), ana, [ana, bogdan, cora], 1, {
    scores: { [cora.id]: 8 },
    before: async (itemId) =>
      check(
        await (await connectAs(cora)).from("ratings").insert({ list_item_id: itemId, user_id: cora.id, comment: "Loved the ending" }),
        "Cora's note",
      ),
  });
  const row = must(
    await admin.from("ratings").select("score, comment, rated_by").eq("list_item_id", night.itemId).eq("user_id", cora.id).single(),
    "Cora's rating",
  );
  expect(row).toMatchObject({ score: 8, comment: "Loved the ending", rated_by: ana.id });

  await openNight(anaPage, night);
  await choose(anaPage, "Edit who watched");
  const dialog = editDialog(anaPage, night);
  // Her box is locked up front, with the reason, although the score is Ana's; Bogdan, who has nothing of his own, isn't.
  const coraBox = dialog.getByRole("checkbox", { name: "Cora" });
  await expect(coraBox).toBeChecked();
  await expect(coraBox).toBeDisabled();
  await expect(dialog.getByText("Rated it or left a note, so only they can take themselves off it.")).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Bogdan" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  // Nothing of hers was touched, and the delete window warns about it when the title would go back to To watch.
  expect((await whoIsOnIt(night)).sort()).toEqual([ana.id, bogdan.id, cora.id].sort());
  await choose(anaPage, "Delete movie night");
  const deleting = deleteDialog(anaPage);
  await deleting.getByLabel(`Also put ${night.title} back on To watch`).check();
  await deleting.getByRole("button", { name: "Delete movie night" }).click();
  await expect(deleting.getByRole("alert")).toContainText("Cora can only take themselves off it");
  expect(must(await admin.from("ratings").select("comment").eq("list_item_id", night.itemId).eq("user_id", cora.id).single(), "her note").comment).toBe(
    "Loved the ending",
  );
  expect(must(await admin.from("movie_nights").select("id").eq("id", night.nightId), "night")).toHaveLength(1);
  await closeAll([anaPage, coraPage]);
});

test("an edit made over somebody else's change is refused, and the night is read again", async ({ browser }, testInfo) => {
  const {
    users: [ana, bogdan, cora],
    pages: [anaPage],
  } = await makeFamily(browser, testInfo.project, FAMILY, ["Ana", "Bogdan", "Cora"]);
  const night = await loggedNight(await familyOf(ana), ana, [ana, bogdan], 2);

  await openNight(anaPage, night);
  await choose(anaPage, "Edit who watched");
  const dialog = editDialog(anaPage, night);
  await expect(dialog.getByRole("checkbox", { name: "Ana" })).toBeChecked();

  // While Ana has it open, Bogdan adds Cora.
  check(
    await (await connectAs(bogdan)).rpc("update_movie_night", {
      p_night: night.nightId,
      p_watched_on: daysAgo(2),
      p_viewers: [ana, bogdan, cora].map((u) => ({ user_id: u.id, score: null })),
    }),
    "Bogdan's edit",
  );
  await dialog.locator('input[type="date"]').fill(daysAgo(1));
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Someone changed this movie night");
  // Nothing of Ana's was saved, and the page caught up with Bogdan's edit.
  expect(must(await admin.from("movie_nights").select("happened_on").eq("id", night.nightId).single(), "night").happened_on).toBe(
    daysAgo(2),
  );
  await expect(watchedBy(anaPage)).toContainText("Cora");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  // Opened again, it starts from what the night is now.
  await choose(anaPage, "Edit who watched");
  await expect(dialog.getByRole("checkbox", { name: "Cora" })).toBeChecked();
  await closeAll([anaPage]);
});

test("who may delete a night: its starter and the owner, not a member who had nothing to do with it", async ({ browser }, testInfo) => {
  const {
    users: [ana, bogdan, cora],
    pages: [anaPage, bogdanPage, coraPage],
  } = await makeFamily(browser, testInfo.project, FAMILY, ["Ana", "Bogdan", "Cora"]);
  // Ana owns the family; Bogdan logged this one.
  const night = await loggedNight(await familyOf(ana), bogdan, [bogdan, cora], 2);

  // Cora can put right who watched it, but can't delete it.
  await openNight(coraPage, night);
  await menu(coraPage).click();
  await expect(coraPage.getByRole("menuitem", { name: "Edit who watched" })).toBeVisible();
  await expect(coraPage.getByRole("menuitem", { name: "Delete movie night" })).toHaveCount(0);
  await coraPage.keyboard.press("Escape");

  // Bogdan, who started it, can.
  await openNight(bogdanPage, night);
  await menu(bogdanPage).click();
  await expect(bogdanPage.getByRole("menuitem", { name: "Delete movie night" })).toBeVisible();
  await bogdanPage.keyboard.press("Escape");

  // Ana, the owner, deletes it: it says what goes and what stays, and Cancel changes nothing.
  await openNight(anaPage, night);
  await choose(anaPage, "Delete movie night");
  const dialog = deleteDialog(anaPage);
  await expect(dialog).toContainText(`${night.title}, ${formatDay(daysAgo(2))}`);
  await expect(dialog).toContainText(`${night.title} stays on ${FAMILY}'s Watched together list`);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(must(await admin.from("movie_nights").select("id").eq("id", night.nightId), "night")).toHaveLength(1);

  await choose(anaPage, "Delete movie night");
  await dialog.getByRole("button", { name: "Delete movie night" }).click();
  await expect(anaPage).toHaveURL(new RegExp(`/app/movie-night\\?who=${night.group}$`));
  await expect(history(anaPage).getByRole("link", { name: night.title })).toHaveCount(0);

  // The night is gone for everyone; the title stays watched together, on everyone's My list.
  expect(must(await admin.from("movie_nights").select("id").eq("id", night.nightId), "night")).toHaveLength(0);
  expect(must(await admin.from("list_items").select("status").eq("id", night.itemId).single(), "title").status).toBe("watched");
  expect((await whoIsOnIt(night)).sort()).toEqual([bogdan.id, cora.id].sort());
  expect(await onMyList(cora, night)).toBe(true);
  await openFeed(anaPage);
  await expect(anaPage.getByText(`You deleted the movie night for ${night.title} of ${formatDay(daysAgo(2))}`)).toBeVisible();
  // Someone who still had it open finds it gone when they open it again.
  await coraPage.reload();
  await expect(coraPage.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
  await closeAll([anaPage, bogdanPage, coraPage]);
});

test("deleting a night can put the title back on To watch, once nobody who rated it is on it", async ({ browser }, testInfo) => {
  const {
    users: [ana, bogdan, cora],
    pages: [anaPage],
  } = await makeFamily(browser, testInfo.project, FAMILY, ["Ana", "Bogdan", "Cora"]);
  const night = await loggedNight(await familyOf(ana), ana, [ana, bogdan, cora], 1);
  check(
    await (await connectAs(cora)).from("ratings").insert({ list_item_id: night.itemId, user_id: cora.id, score: 8 }),
    "Cora's score",
  );

  await openNight(anaPage, night);
  await choose(anaPage, "Delete movie night");
  const dialog = deleteDialog(anaPage);
  await dialog.getByLabel(`Also put ${night.title} back on To watch`).check();
  await expect(dialog).toContainText(`${night.title} goes back to To watch`);
  await dialog.getByRole("button", { name: "Delete movie night" }).click();
  // Cora rated it, so only she can take herself off: nothing is deleted.
  await expect(dialog.getByRole("alert")).toContainText("Cora can only take themselves off it");
  expect(must(await admin.from("movie_nights").select("id").eq("id", night.nightId), "night")).toHaveLength(1);
  expect((await whoIsOnIt(night)).length).toBe(3);

  // She does ("I wasn't there"), and then it goes through.
  check(
    await (await connectAs(cora)).from("watches").delete().eq("list_item_id", night.itemId).eq("user_id", cora.id),
    "Cora taking herself off",
  );
  await dialog.getByRole("button", { name: "Delete movie night" }).click();
  await expect(anaPage).toHaveURL(new RegExp(`/app/movie-night\\?who=${night.group}$`));
  expect(must(await admin.from("movie_nights").select("id").eq("id", night.nightId), "night")).toHaveLength(0);
  expect(must(await admin.from("list_items").select("status").eq("id", night.itemId).single(), "title").status).toBe("want");
  expect(await whoIsOnIt(night)).toEqual([]);
  expect(await onMyList(bogdan, night)).toBe(false);

  await openFamily(anaPage, FAMILY);
  await anaPage.getByRole("button", { name: /^To watch \d+$/ }).click();
  await expect(listCard(anaPage, night.title)).toBeVisible();
  await openFeed(anaPage);
  await expect(
    anaPage.getByText(`You deleted the movie night for ${night.title} of ${formatDay(daysAgo(1))} and put it back on To watch`),
  ).toBeVisible();
  await closeAll([anaPage]);
});

test("a night of an earlier viewing can't be edited, but can still be deleted", async ({ browser }, testInfo) => {
  const {
    users: [ana, bogdan],
    pages: [anaPage],
  } = await makeFamily(browser, testInfo.project, FAMILY, ["Ana", "Bogdan"]);
  const night = await loggedNight(await familyOf(ana), ana, [ana, bogdan], 5);
  // The family puts the title back on the list to watch it again: this night is the viewing it had.
  check(await (await connectAs(ana)).rpc("watch_again", { p_item: night.itemId }), "watching it again");

  await openNight(anaPage, night);
  await menu(anaPage).click();
  await expect(anaPage.getByRole("menuitem", { name: "Edit who watched" })).toHaveCount(0);
  await anaPage.getByRole("menuitem", { name: "Delete movie night" }).click();
  const dialog = deleteDialog(anaPage);
  await expect(dialog.getByText(/Also put .* back on To watch/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Delete movie night" }).click();
  await expect(anaPage).toHaveURL(new RegExp(`/app/movie-night\\?who=${night.group}$`));

  // The night goes; the viewing it was stays in the title's history.
  expect(must(await admin.from("movie_nights").select("id").eq("id", night.nightId), "night")).toHaveLength(0);
  expect(
    must(await admin.from("watch_history").select("user_id").eq("media_id", night.mediaId), "history"),
  ).toHaveLength(2);
  await closeAll([anaPage]);
});
