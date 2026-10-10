import { test, type Browser, type Page, type TestInfo } from "@playwright/test";

import { admin, createUser, expect, openAs, signIn, startFamily } from "./helpers";

// A stack is built from TMDB, which can take a few seconds (more when it is slow).
const TMDB = 90_000;

type Kind = "yes" | "nope" | "love" | "seen";
const KEYS: Record<Kind, string> = { yes: "ArrowRight", nope: "ArrowLeft", love: "ArrowUp", seen: "s" };
const BUTTONS: Record<Kind, string | RegExp> = { yes: "Yes", nope: "Nope", love: /^Love it/, seen: /^Seen it/ };

/** The card on top of the stack, and the counter above it ("3 / 25"). */
const topCard = (page: Page) => page.getByRole("group", { name: /, \d+ of \d+$/ });
const counter = (page: Page) => page.getByText(/^\d+ \/ \d+$/).first();

/** One vote on the top card, by key on a computer and by button on a phone, then waits for the next card. */
async function vote(page: Page, kind: Kind, keys: boolean) {
  const [position, total] = (await counter(page).innerText()).split(" / ").map(Number);
  if (keys) await page.keyboard.press(KEYS[kind]);
  else await page.getByRole("button", { name: BUTTONS[kind], exact: typeof BUTTONS[kind] === "string" }).click();
  if (position < total) await expect(counter(page)).toHaveText(`${position + 1} / ${total}`);
}

/**
 * On a phone the card is nearly as wide as the screen and tall, leaves room for three or more lines of the
 * description, and the whole row of buttons (captions too) sits above the bottom bar, so the page doesn't scroll.
 */
async function expectRoomyCardOnPhone(page: Page) {
  const view = page.viewportSize()!;
  const card = (await topCard(page).boundingBox())!;
  expect(card.width).toBeGreaterThan(view.width - 48);
  expect(card.height).toBeGreaterThan(view.height * 0.5);

  const blurb = topCard(page).locator(".swipe-blurb");
  if (await blurb.count()) {
    expect(await blurb.evaluate((el) => Number(getComputedStyle(el).webkitLineClamp))).toBeGreaterThanOrEqual(3);
  }

  const caption = (await page.getByText(/^Love( · \d+ left)?$/).boundingBox())!;
  const bar = (await page.locator("nav.fixed").boundingBox())!;
  expect(caption.y + caption.height).toBeLessThanOrEqual(bar.y);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
}

const leaderboard = (page: Page) => page.getByRole("heading", { name: "Leaderboard" });
const rows = (page: Page) => page.locator("ol > li");
const noDialogOpen = (page: Page) => expect(page.locator("dialog[open]")).toHaveCount(0);

/** Everybody confirms the questions the app asks ("Cancel this movie night?"). */
function acceptConfirms(...pages: Page[]) {
  for (const page of pages) page.on("dialog", (dialog) => void dialog.accept());
}

/** People with their own browser windows, and a family made by the first one that the others join. */
async function makeFamily(browser: Browser, project: TestInfo["project"], name: string, people: string[]) {
  const users = await Promise.all(people.map((person) => createUser(person)));
  const pages = await Promise.all(users.map((user) => openAs(browser, project, user)));
  acceptConfirms(...pages);
  await startFamily(pages[0], pages.slice(1), name);
  return { users, pages };
}

/** The family's open night, started from Movie night; waits for the first card. */
async function startNight(page: Page, family: string) {
  await page.goto("/app/movie-night");
  await page.getByRole("link", { name: new RegExp(`^${family}`) }).click();
  await page.getByRole("button", { name: `Start movie night for ${family}` }).click();
  await expect(topCard(page)).toBeVisible({ timeout: TMDB });
  await expect(page).toHaveURL(/\/app\/movie-night\/[0-9a-f-]{36}$/);
}

async function finishStack(page: Page) {
  await page.getByRole("button", { name: "Skip the rest" }).click();
  await expect(leaderboard(page)).toBeVisible();
}

const closeAll = (pages: Page[]) => Promise.all(pages.map((page) => page.context().close()));

test("on your own: swipe a stack with the keyboard or the buttons, and what you like lands on My list", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  const ana = await createUser("Ana");
  await signIn(context, ana);
  const keys = testInfo.project.name === "desktop";

  await page.goto("/app/movie-night");
  await expect(page.getByRole("heading", { name: "What are you in the mood for?" })).toBeVisible();

  // Moods (ready-made mixes) and genres are separate, labelled groups, and picking a mood fills in its genres.
  const moods = page.getByRole("group", { name: "Moods" });
  const genres = page.getByRole("group", { name: "Genres" });
  await expect(moods.getByRole("button")).toHaveCount(8);
  await moods.getByRole("button", { name: "Laugh" }).click();
  await expect(moods.getByRole("button", { name: "Laugh" })).toHaveAttribute("aria-pressed", "true");
  await expect(genres.getByRole("button", { name: "Comedy" })).toHaveAttribute("aria-pressed", "true");
  await moods.getByRole("button", { name: "Laugh" }).click();
  await expect(genres.getByRole("button", { name: "Comedy" })).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Start swiping" }).click();
  await expect(topCard(page)).toBeVisible({ timeout: TMDB });
  await expect(counter(page)).toHaveText("1 / 25");
  if (!keys) await expectRoomyCardOnPhone(page);

  // A yes and a love go on My list; a nope and a seen-it don't, nor do the rest.
  await vote(page, "yes", keys);
  await vote(page, "nope", keys);
  await vote(page, "love", keys);
  await vote(page, "seen", keys);
  for (let i = 4; i < 25; i++) await vote(page, "nope", keys);

  await page.getByRole("button", { name: "Show my list" }).click();
  await expect(page).toHaveURL(/\/app\/movie-night\/list\?list=mine&added=2/, { timeout: 60_000 });
  await expect(page.getByText("Added 2 titles from your stack to My list.")).toBeVisible();
  const { data } = await admin.from("list_items").select("id").eq("added_by", ana.id).is("group_id", null);
  expect(data).toHaveLength(2);
});

test("a family night: the invite, swiping, a leaderboard without popups, and a pick that ends it", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { users, pages } = await makeFamily(browser, testInfo.project, "Movie Crew", ["Ana", "Ben", "Cara"]);
  const [ana, ben] = users;
  const [anaPage, benPage, caraPage] = pages;
  const keys = testInfo.project.name === "desktop";

  await startNight(anaPage, "Movie Crew");
  await expect(counter(anaPage)).toHaveText("1 / 25");
  if (!keys) await expectRoomyCardOnPhone(anaPage);

  // Cara hears about it, and closes the invite with "not now": a dot and a banner keep the way back.
  await caraPage.goto("/app");
  const caraInvite = caraPage.getByRole("dialog", { name: "Ana started a movie night" });
  await expect(caraInvite).toBeVisible();
  await caraPage.keyboard.press("Escape");
  await expect(caraInvite).toBeHidden();
  await expect(caraPage.getByRole("link", { name: /a movie night is waiting for you/ })).toBeVisible();
  await expect(caraPage.getByRole("region", { name: "Movie nights in progress" }).getByRole("link", { name: "Join in" })).toBeVisible();

  // Ben takes the invite straight into the stack.
  await benPage.goto("/app");
  await benPage.getByRole("dialog", { name: "Ana started a movie night" }).getByRole("link", { name: "Take me there" }).click();
  await expect(topCard(benPage)).toBeVisible();

  // Ana loves one and says yes to one; Ben says yes twice. Finishing goes straight to the leaderboard, with no popup.
  await vote(anaPage, "love", keys);
  await vote(anaPage, "yes", keys);
  await finishStack(anaPage);
  await vote(benPage, "yes", keys);
  await vote(benPage, "yes", keys);
  await finishStack(benPage);
  await noDialogOpen(anaPage);
  await noDialogOpen(benPage);

  // Ben's board: the top title is the one Ana loved, with who voted what by name.
  await expect(rows(benPage).first()).toBeVisible();
  await rows(benPage).first().getByRole("button").first().click();
  await expect(rows(benPage).first().locator("dl")).toContainText("Ana");

  // Cara never opened the night, so Ana shows the results now.
  await expect(anaPage.getByText("hasn't joined")).toBeVisible();
  await anaPage.getByRole("button", { name: "Show results now" }).click();
  await expect(anaPage.getByRole("button", { name: "Show results now" })).toBeHidden();

  // Ana picks the top title: Ana and Ben were there, Cara wasn't.
  const top = rows(anaPage).first();
  const title = (await top.getByRole("button").first().innerText()).trim();
  await top.getByRole("button").first().click();
  await top.getByRole("button", { name: "We watched this" }).click();
  const dialog = anaPage.getByRole("dialog", { name: /^Who watched / });
  await expect(dialog.getByRole("checkbox", { name: /Ana/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Ben/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Cara/ })).not.toBeChecked();
  await dialog.getByRole("textbox", { name: "Your note" }).fill("Great pick");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  // The night is over for everybody: a banner, no more picking, and Ben's page catches up by itself.
  const banner = anaPage.getByRole("status").filter({ hasText: "picked" });
  await expect(banner).toContainText(title);
  await expect(banner).toContainText("The best titles joined Movie Crew's list.");
  await expect(anaPage.getByRole("button", { name: "We watched this" })).toHaveCount(0);
  await expect(benPage.getByRole("status").filter({ hasText: "picked" })).toBeVisible({ timeout: 30_000 });

  // Nothing but the votes decided what was added: the pick and the other liked titles are on the family list.
  const { data: night } = await admin
    .from("movie_nights")
    .select("status, group_id, picked_list_item_id")
    .eq("started_by", ana.id)
    .single();
  expect(night?.status).toBe("closed");
  const onList = await admin.from("list_items").select("id", { count: "exact", head: true }).eq("group_id", night!.group_id).is("deleted_at", null);
  expect(onList.count).toBeGreaterThanOrEqual(2);
  const { data: watches } = await admin.from("watches").select("user_id").eq("list_item_id", night!.picked_list_item_id!);
  expect((watches ?? []).map((w) => w.user_id).sort()).toEqual([ana.id, ben.id].sort());
  // The pick went on those two people's My lists as watched, and not on Cara's, who wasn't there.
  const { data: onMyLists } = await admin
    .from("list_items")
    .select("added_by, status")
    .is("group_id", null)
    .eq("source_item_id", night!.picked_list_item_id!);
  expect((onMyLists ?? []).map((m) => m.added_by).sort()).toEqual([ana.id, ben.id].sort());
  expect((onMyLists ?? []).every((m) => m.status === "watched")).toBe(true);

  // It is kept in the family's list of movie nights as finished, and Ben is asked how he liked it once he leaves the night.
  await anaPage.goto("/app/movie-night");
  await anaPage.getByRole("link", { name: /^Movie Crew/ }).click();
  const history = anaPage.locator("#movie-nights");
  await expect(history.getByText(title)).toBeVisible();
  await expect(history.getByText("Finished", { exact: true })).toBeVisible();
  await benPage.goto("/app");
  await expect(benPage.getByRole("dialog", { name: "How did you like it?" })).toBeVisible();

  await closeAll(pages);
});

test("cancelling ends a night for everybody, and one that goes quiet closes by itself", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { users, pages } = await makeFamily(browser, testInfo.project, "Quiet Crew", ["Ana", "Ben"]);
  const [ana] = users;
  const [anaPage, benPage] = pages;

  await startNight(anaPage, "Quiet Crew");
  await benPage.goto("/app/movie-night");
  await benPage.getByRole("link", { name: /^Quiet Crew/ }).click();
  await benPage.getByRole("link", { name: "Join in" }).click();
  await expect(topCard(benPage)).toBeVisible();

  // Ana cancels from the menu; Ben, still swiping, is told by the next check.
  await anaPage.getByRole("button", { name: "Movie night menu" }).click();
  await anaPage.getByRole("menuitem", { name: "Cancel movie night" }).click();
  await expect(anaPage.getByText(/cancelled this movie night/)).toBeVisible();
  await expect(benPage.getByText(/cancelled this movie night/)).toBeVisible({ timeout: 30_000 });
  await expect(topCard(benPage)).toBeHidden();

  // A new night can be started, and after 12 hours without anyone voting it expires when it is next looked at.
  await startNight(anaPage, "Quiet Crew");
  const { data: open } = await admin.from("movie_nights").select("id").eq("started_by", ana.id).eq("status", "open").single();
  await admin
    .from("movie_nights")
    .update({ last_activity_at: new Date(Date.now() - 13 * 3600_000).toISOString() })
    .eq("id", open!.id);
  await anaPage.reload();
  await expect(anaPage.getByText(/ended after 12 hours/)).toBeVisible();

  // Both are in the list, newest first, with their status.
  await anaPage.goto("/app/movie-night");
  await anaPage.getByRole("link", { name: /^Quiet Crew/ }).click();
  const history = anaPage.locator("#movie-nights ul > li");
  await expect(history).toHaveCount(2);
  await expect(history.nth(0)).toContainText("Nobody picked");
  await expect(history.nth(0)).toContainText("Expired");
  await expect(history.nth(1)).toContainText("Cancelled by Ana");
  await expect(history.nth(1)).toContainText("Cancelled");

  await closeAll(pages);
});

test("more suggestions give everybody another stack, and more like this makes one from a title", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { pages } = await makeFamily(browser, testInfo.project, "Stack Crew", ["Ana", "Ben"]);
  const [anaPage, benPage] = pages;
  const keys = testInfo.project.name === "desktop";

  await startNight(anaPage, "Stack Crew");
  await benPage.goto("/app/movie-night");
  await benPage.getByRole("link", { name: /^Stack Crew/ }).click();
  await benPage.getByRole("link", { name: "Join in" }).click();
  await expect(topCard(benPage)).toBeVisible();
  await vote(anaPage, "yes", keys);
  await finishStack(anaPage);
  await vote(benPage, "yes", keys);
  await finishStack(benPage);

  // Ana asks for more: she goes straight into the new stack, and Ben's board says so within a few seconds.
  await anaPage.getByRole("button", { name: "More suggestions" }).click();
  await expect(counter(anaPage)).toHaveText(/^1 \/ \d+$/, { timeout: TMDB });
  await expect(benPage.getByText(/Ana added \d+ more suggestions/)).toBeVisible({ timeout: 30_000 });
  // He can't ask for more until he has swiped these.
  await expect(benPage.getByRole("button", { name: "More suggestions" })).toHaveCount(0);
  await benPage.getByRole("button", { name: "Swipe them" }).click();
  await expect(topCard(benPage)).toBeVisible();
  await finishStack(benPage);
  await expect(benPage.getByRole("button", { name: "More suggestions" })).toBeVisible();

  // A stack like a title from the leaderboard.
  await finishStack(anaPage);
  await rows(anaPage).first().getByRole("button").first().click();
  await rows(anaPage).first().getByRole("button", { name: "More like this" }).click();
  await expect(counter(anaPage)).toHaveText(/^1 \/ \d+$/, { timeout: TMDB });

  await closeAll(pages);
});

test("the history keeps every night and shows 20 at a time", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const page = await openAs(browser, testInfo.project, ana);
  await startFamily(page, [], "History Crew");
  const { data: group } = await admin.from("groups").select("id").eq("name", "History Crew").eq("created_by", ana.id).single();

  // 25 Watched together logs, and a night that was cancelled, for the same family.
  const media: string[] = [];
  for (let i = 0; i < 25; i++) {
    const { data } = await admin
      .from("media")
      .upsert({ tmdb_id: 880000 + i, media_type: "movie", title: `Archive Film ${i}`, release_year: 2000, genres: [] }, { onConflict: "tmdb_id,media_type" })
      .select("id")
      .single();
    media.push(data!.id);
  }
  const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
  await admin.from("movie_nights").insert([
    { group_id: group!.id, source: "swipe", status: "cancelled", started_by: ana.id, ended_by: ana.id, happened_on: day(0) },
    ...media.map((id, i) => ({
      group_id: group!.id,
      source: "logged",
      status: "closed",
      started_by: ana.id,
      ended_by: ana.id,
      picked_media_id: id,
      happened_on: day(1 + i),
    })),
  ]);

  await page.goto(`/app/movie-night?who=${group!.id}`);
  const entries = page.locator("#movie-nights ul > li");
  await expect(entries).toHaveCount(20);
  await expect(entries.first()).toContainText("Cancelled by Ana");
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(entries).toHaveCount(26);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  // A Watched together log is told apart, and opens its title.
  await expect(entries.nth(1)).toContainText("Archive Film 0");
  await expect(entries.nth(1)).toContainText("Watched together");
  await expect(entries.nth(1)).toContainText("Finished");

  await page.context().close();
});

test("the list shows every night with its status, the one in progress first, across families", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const ben = await createUser("Ben");
  const anaPage = await openAs(browser, testInfo.project, ana);
  const benPage = await openAs(browser, testInfo.project, ben);
  acceptConfirms(anaPage);
  await startFamily(anaPage, [benPage], "Alpha Crew");
  await startFamily(anaPage, [], "Beta Crew");
  const { data: groups } = await admin.from("groups").select("id, name").eq("created_by", ana.id);
  const alpha = groups!.find((g) => g.name === "Alpha Crew")!.id;
  const beta = groups!.find((g) => g.name === "Beta Crew")!.id;

  const media: string[] = [];
  for (let i = 0; i < 12; i++) {
    const { data } = await admin
      .from("media")
      .upsert({ tmdb_id: 870100 + i, media_type: "movie", title: `List Film ${i}`, release_year: 2001, genres: [] }, { onConflict: "tmdb_id,media_type" })
      .select("id")
      .single();
    media.push(data!.id);
  }
  const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
  const night = async (row: Record<string, unknown>) =>
    (await admin.from("movie_nights").insert({ genres: [], ...row }).select("id").single()).data!.id as string;

  // Alpha has one going (started by Ben, with a stack to swipe) and one of each way a night can end; Beta one log.
  const going = await night({ group_id: alpha, source: "swipe", status: "open", started_by: ben.id, genres: ["comedy"], happened_on: day(0) });
  await admin.from("movie_night_members").insert({ night_id: going, user_id: ben.id });
  const { data: stack } = await admin.from("movie_night_stacks").insert({ night_id: going, position: 1, created_by: ben.id }).select("id").single();
  await admin.from("movie_night_candidates").insert(
    media.slice(0, 8).map((id, i) => ({ night_id: going, stack_id: stack!.id, media_id: id, origin: "suggested", position: i + 1 })),
  );
  await night({ group_id: alpha, source: "swipe", status: "closed", started_by: ana.id, ended_by: ana.id, picked_media_id: media[8], happened_on: day(1) });
  await night({ group_id: alpha, source: "swipe", status: "cancelled", started_by: ben.id, ended_by: ben.id, happened_on: day(2) });
  await night({ group_id: alpha, source: "swipe", status: "expired", started_by: ana.id, happened_on: day(3) });
  await night({ group_id: alpha, source: "logged", status: "closed", started_by: ana.id, ended_by: ana.id, picked_media_id: media[9], happened_on: day(4) });
  await night({ group_id: beta, source: "logged", status: "closed", started_by: ana.id, ended_by: ana.id, picked_media_id: media[10], happened_on: day(5) });

  // Just me: every family's nights, each saying which family it is for, with their status in words.
  await anaPage.goto("/app/movie-night");
  const list = anaPage.locator("#movie-nights");
  await expect(list.getByRole("heading", { name: "Movie nights", exact: true })).toBeVisible();
  await expect(list).toContainText("Alpha Crew");
  await expect(list).toContainText("Beta Crew");
  for (const status of ["Finished", "Cancelled", "Expired"]) {
    await expect(list.getByText(status, { exact: true }).first()).toBeVisible();
  }
  // The night in progress: its row heads the list on a computer, and is at the top of the page on a phone (the list
  // is far below the form there). Either way it says it is in progress and what you can do next.
  const row = anaPage.getByRole("link", { name: /Started by Ben/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("In progress");
  await expect(row).toContainText("Join in");
  if (testInfo.project.name === "desktop") {
    await expect(list.locator("ul > li").first()).toContainText("In progress");
  } else {
    const rowBox = (await row.boundingBox())!;
    const startBox = (await anaPage.getByRole("button", { name: "Start swiping" }).boundingBox())!;
    expect(rowBox.y).toBeLessThan(startBox.y);
  }

  // One family: just its nights, with the card for the one going in place of the form, and the same night in the list.
  await anaPage.goto(`/app/movie-night?who=${alpha}`);
  await expect(list.getByRole("heading", { name: "Movie nights in Alpha Crew" })).toBeVisible();
  await expect(list).not.toContainText("Beta Crew");
  await expect(anaPage.getByRole("region", { name: "Movie night in progress" })).toBeVisible();
  await expect(list.getByRole("link", { name: /Started by Ben/ })).toContainText("In progress");

  // Cancelling it from the card puts it in the list as cancelled, straight away.
  await anaPage.getByRole("button", { name: "Cancel it" }).click();
  await expect(list.getByRole("link", { name: /Started by Ben/ })).toHaveCount(0);
  await expect(list.locator("ul > li").first()).toContainText("Cancelled by Ana");
  await expect(anaPage.getByRole("button", { name: "Start movie night for Alpha Crew" })).toBeVisible();

  // The next page of the list is for every family when none is named, and answers for what it is asked.
  const all = await (await anaPage.request.get("/api/movie-night/history?offset=0")).json();
  expect(all.entries).toHaveLength(6);
  expect(new Set(all.entries.map((e: { groupName: string }) => e.groupName))).toEqual(new Set(["Alpha Crew", "Beta Crew"]));
  const onlyBeta = await (await anaPage.request.get(`/api/movie-night/history?group=${beta}&offset=0`)).json();
  expect(onlyBeta.entries).toHaveLength(1);
  expect((await anaPage.request.get("/api/movie-night/history?group=nope")).status()).toBe(400);

  await closeAll([anaPage, benPage]);
});
