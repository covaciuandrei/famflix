import { test, type Page } from "@playwright/test";

import {
  addTo,
  admin,
  createUser,
  expect,
  firstCard,
  listCard,
  openAs,
  openFamily,
  setSlider,
  signIn,
  startFamily,
} from "./helpers";

/** Today as the app writes it on a My list card: dd.mm.yyyy. */
function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

/**
 * My list, on its Watched tab. A person with a rating waiting has the "How did you like it?" popup open by itself over
 * any page, so for them (`popup`) it is closed with "Later" first.
 */
async function openMyWatched(page: Page, { popup = false } = {}) {
  await page.goto("/app/mine");
  if (popup) {
    const ask = page.getByRole("dialog", { name: "How did you like it?" });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Later" }).click();
    await expect(ask).toBeHidden();
  }
  await page.getByRole("button", { name: /^Watched \d+$/ }).click();
}

/** The rating popup: it opens by itself once a session, and after "Later" the star in the header brings it back. */
async function openRatingRequests(page: Page) {
  await page.goto("/app");
  const ask = page.getByRole("dialog", { name: "How did you like it?" });
  const star = page.getByRole("button", { name: /waiting for your rating/ });
  await expect(ask.or(star)).toBeVisible();
  if (!(await ask.isVisible())) await star.click();
  await expect(ask).toBeVisible();
  return ask;
}

test("the login page only offers Google", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
});

test("the menu has four tabs, and the app opens on Browse", async ({ page, context }, testInfo) => {
  await signIn(context, await createUser("Ana"));

  // Old links and bookmarks to /app (and the installed app's start page) land on the first tab.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/browse$/);

  const menu = testInfo.project.name === "desktop" ? page.locator("header nav") : page.locator("nav.fixed");
  await expect(menu.getByRole("link")).toHaveText(["Browse", "Movie night", "My list", "Families"]);
  await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveCount(0);

  // The logo goes to the same place.
  await page.goto("/app/mine");
  await page.getByRole("link", { name: "FamFlix" }).click();
  await expect(page).toHaveURL(/\/app\/browse$/);
});

test("signed-out visitors go to the login page", async ({ page }) => {
  await page.goto("/app/mine");
  await expect(page).toHaveURL(/\/login$/);
});

test("the privacy policy and terms load without signing in", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy policy" })).toBeVisible();
  await page.getByRole("link", { name: "Terms" }).last().click();
  await expect(page.getByRole("heading", { name: "Terms", exact: true })).toBeVisible();
});

test("add a title from Browse and find it on My list", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);

  await page.goto("/app/browse");
  const card = firstCard(page, "Trending this week");
  const title = (await card.locator("a.line-clamp-1").textContent())!.trim();
  await addTo(page, card, "My list");
  await expect(card.getByRole("img", { name: /On My list/ })).toBeVisible();

  await page.goto("/app/mine");
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test("a series is saved with its seasons, a movie without", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);

  // Chernobyl: one season of five episodes, ended.
  await page.goto("/app/media/tv/87108");
  await expect(page.getByRole("heading", { name: "Chernobyl", level: 1 })).toBeVisible();
  await addTo(page, page, "My list");
  await expect(page.getByRole("img", { name: /On My list/ })).toBeVisible();
  const series = await admin.from("media").select("series").eq("tmdb_id", 87108).eq("media_type", "tv").single();
  expect(series.data!.series).toEqual({
    status: "Ended",
    seasons: [{ n: 1, episodes: 5 }],
    last_aired: { s: 1, e: 5 },
    next_air: null,
  });

  await page.goto("/app/media/movie/438631");
  await addTo(page, page, "My list");
  await expect(page.getByRole("img", { name: /On My list/ })).toBeVisible();
  const movie = await admin.from("media").select("series").eq("tmdb_id", 438631).eq("media_type", "movie").single();
  expect(movie.data!.series).toBeNull();
});

test("mark a title watched from its page, with a score and a note", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);

  await page.goto("/app/media/movie/438631");
  await expect(page.getByRole("heading", { name: "Dune", level: 1 })).toBeVisible();
  // No streaming services, and the trailer waits for a click before loading YouTube.
  await expect(page.getByText("Where to watch")).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);

  await page.getByRole("button", { name: "Mark as watched" }).click();
  const popup = page.getByRole("dialog", { name: /How was Dune/ });
  await expect(popup).toBeVisible();
  await setSlider(popup.locator('input[type="range"]'), 8.5);
  await popup.getByRole("textbox", { name: "Your note" }).fill("Great on a big screen");
  await popup.getByRole("button", { name: "Save" }).click();
  await expect(popup).toBeHidden();
  await expect(page.getByRole("button", { name: "Watched" })).toBeVisible();

  const { data } = await admin
    .from("ratings")
    .select("score, comment")
    .eq("user_id", ana.id)
    .single();
  expect(data).toEqual({ score: 8.5, comment: "Great on a big screen" });

  await page.getByRole("button", { name: /Play the Dune trailer/ }).click();
  await expect(page.locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\//);
});

test("watched together: the others confirm their score and add a note", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const bogdan = await createUser("Bogdan");
  const anaPage = await openAs(browser, testInfo.project, ana);
  const bogdanPage = await openAs(browser, testInfo.project, bogdan);
  await startFamily(anaPage, [bogdanPage], "Test family");

  // Ana adds Dune and logs that they watched it together, filling in Bogdan's score.
  await anaPage.goto("/app/media/movie/438631");
  await addTo(anaPage, anaPage, "Test family");
  await expect(anaPage.getByRole("img", { name: /On Test family/ })).toBeVisible();
  await openFamily(anaPage, "Test family");
  // The card's button (the family list also has a "Watched together" tab, with a count).
  await anaPage.getByRole("button", { name: "Watched together", exact: true }).click();
  const dialog = anaPage.getByRole("dialog", { name: /Who watched Dune/ });
  await dialog.getByRole("checkbox", { name: "Bogdan" }).check();
  const bogdanRow = dialog.locator("li", { hasText: "Bogdan" });
  await setSlider(bogdanRow.locator('input[type="range"]'), 8.5);
  await dialog.getByRole("textbox", { name: "Your note" }).fill("Ana's note");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await anaPage.getByRole("button", { name: /^Watched together \d+$/ }).click();
  await listCard(anaPage, "Dune").getByRole("button", { name: /^View family ratings/ }).click();
  const familyRatings = anaPage.getByRole("dialog", { name: "Family ratings", exact: true });
  await expect(familyRatings.getByRole("listitem")).toHaveCount(1);
  await expect(familyRatings.getByRole("listitem")).toContainText("Bogdan");
  await expect(familyRatings.getByRole("listitem")).toContainText("8.5/10");
  await expect(familyRatings.getByText("Filled in by Ana", { exact: true })).toBeVisible();
  await familyRatings.getByRole("button", { name: "Close", exact: true }).click();

  // Who has seen it is told on the title's own page...
  await anaPage.goto("/app/media/movie/438631");
  await expect(anaPage.getByText(/^Seen by (You, Bogdan|Bogdan, You)$/)).toBeVisible();
  // ...and not on Browse's cards, where it would make some taller than the rest: they only wear their list's badge.
  await anaPage.goto("/app/browse");
  await anaPage.getByRole("searchbox", { name: "Search movies and series" }).fill("Dune");
  await anaPage.getByRole("button", { name: "Search", exact: true }).click();
  await expect(anaPage.getByRole("img", { name: "On My list, Test family" })).toBeVisible();
  await expect(anaPage.getByText(/^Seen by/)).toHaveCount(0);

  // It is on Ana's My list as watched, with Bogdan and today's date, and her note.
  await openMyWatched(anaPage);
  const anaCard = listCard(anaPage, "Dune");
  await expect(anaCard.getByText(`Watched with Bogdan on ${today()}`)).toBeVisible();
  await expect(anaCard.getByRole("button", { name: /Your note/ })).toBeVisible();

  // Bogdan's too, with the 8.5 Ana filled in for him, before he has even been asked.
  await openMyWatched(bogdanPage, { popup: true });
  const bogdanCard = listCard(bogdanPage, "Dune");
  await expect(bogdanCard.getByText(`Watched with Ana on ${today()}`)).toBeVisible();
  await expect(bogdanCard.getByRole("button", { name: /Your rating 8\.5/ })).toBeVisible();

  // Bogdan is asked to confirm the 8.5 Ana filled in, and adds his note.
  const ask = await openRatingRequests(bogdanPage);
  await expect(ask.getByText(/filled in 8\.5\/10 for you/)).toBeVisible();
  await ask.getByPlaceholder("Add a note (optional)").fill("Bogdan's note");
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(ask).toBeHidden();

  // The family's ratings are the two above (My list has its own copies, checked below).
  const { data } = await admin
    .from("ratings")
    .select("user_id, score, comment, rated_by, list_items!inner(group_id)")
    .in("user_id", [ana.id, bogdan.id])
    .not("list_items.group_id", "is", null)
    .order("comment");
  expect(data?.map((r) => ({ user_id: r.user_id, score: r.score, comment: r.comment, rated_by: r.rated_by }))).toEqual([
    { user_id: ana.id, score: null, comment: "Ana's note", rated_by: ana.id },
    { user_id: bogdan.id, score: 8.5, comment: "Bogdan's note", rated_by: bogdan.id },
  ]);

  // His note follows to his My list, where the score is now his own.
  const { data: mine } = await admin
    .from("ratings")
    .select("score, comment, rated_by, list_items!inner(group_id)")
    .eq("user_id", bogdan.id)
    .is("list_items.group_id", null);
  expect(mine).toEqual([{ score: 8.5, comment: "Bogdan's note", rated_by: bogdan.id, list_items: { group_id: null } }]);
  await openMyWatched(bogdanPage);
  await listCard(bogdanPage, "Dune").getByRole("button", { name: /Your rating 8\.5/ }).click();
  await expect(listCard(bogdanPage, "Dune").getByPlaceholder("Add a note (optional)")).toHaveValue("Bogdan's note");
  await Promise.all([anaPage, bogdanPage].map((page) => page.context().close()));
});

test("I wasn't there, or deleting an account: the title goes back to To watch only when nobody is left on the record", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const bogdan = await createUser("Bogdan");
  const anaPage = await openAs(browser, testInfo.project, ana);
  const bogdanPage = await openAs(browser, testInfo.project, bogdan);
  await startFamily(anaPage, [bogdanPage], "Test family");

  await anaPage.goto("/app/media/movie/438631");
  await addTo(anaPage, anaPage, "Test family");
  await expect(anaPage.getByRole("img", { name: /On Test family/ })).toBeVisible();

  const { data: item } = await admin
    .from("list_items")
    .select("id")
    .eq("added_by", ana.id)
    .not("group_id", "is", null)
    .single();
  const dune = async () => {
    const { data } = await admin
      .from("list_items")
      .select("status, watches(user_id)")
      .eq("id", (item as { id: string }).id)
      .single();
    const row = data as { status: string; watches: { user_id: string }[] };
    return { status: row.status, viewers: row.watches.map((w) => w.user_id) };
  };
  async function logWatchedTogether(page: Page, who: { ana: boolean; bogdan: boolean }) {
    await openFamily(page, "Test family");
    await page.getByRole("button", { name: "Watched together", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Who watched Dune/ });
    await dialog.getByRole("checkbox", { name: /Ana/ }).setChecked(who.ana);
    await dialog.getByRole("checkbox", { name: "Bogdan" }).setChecked(who.bogdan);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  }
  // What is on someone's My list (the entries a Watched together log put there say so).
  const mine = async (userId: string) => {
    const { data } = await admin
      .from("list_items")
      .select("status, watch_origin, source_item_id")
      .eq("added_by", userId)
      .is("group_id", null);
    return data;
  };
  async function bogdanSaysHeWasntThere() {
    const ask = await openRatingRequests(bogdanPage);
    await ask.getByRole("button", { name: "I wasn't there" }).click();
    await expect(ask).toBeHidden();
  }

  // Ana logs only Bogdan; he says he wasn't there. Nobody watched it, so it is back on To watch, unticked.
  await logWatchedTogether(anaPage, { ana: false, bogdan: true });
  expect(await dune()).toEqual({ status: "watched", viewers: [bogdan.id] });
  // It is on Bogdan's My list as watched (alone, so no "with"), and not on Ana's, who isn't on the log.
  expect(await mine(bogdan.id)).toEqual([{ status: "watched", watch_origin: "created", source_item_id: (item as { id: string }).id }]);
  expect(await mine(ana.id)).toEqual([]);
  await openMyWatched(bogdanPage, { popup: true });
  await expect(listCard(bogdanPage, "Dune").getByText(`Watched on ${today()}`)).toBeVisible();
  await bogdanSaysHeWasntThere();
  // ... and he says he wasn't there, so it is off his list again.
  expect(await mine(bogdan.id)).toEqual([]);
  await bogdanPage.goto("/app/mine");
  await expect(bogdanPage.getByRole("button", { name: "Watched 0" })).toBeVisible();
  await openFamily(bogdanPage, "Test family");
  const card = listCard(bogdanPage, "Dune");
  await expect(card.getByRole("button", { name: "Mark watched" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Watched", exact: true })).toHaveCount(0);
  expect(await dune()).toEqual({ status: "want", viewers: [] });

  // Ana logs both and Bogdan says it again. Ana was there, so it stays watched together, with only her on it.
  await logWatchedTogether(anaPage, { ana: true, bogdan: true });
  expect(await mine(ana.id)).toHaveLength(1);
  expect(await mine(bogdan.id)).toHaveLength(1);
  await bogdanSaysHeWasntThere();
  // Ana stays on the record, and on hers; Bogdan's is gone.
  expect(await mine(bogdan.id)).toEqual([]);
  expect(await mine(ana.id)).toEqual([{ status: "watched", watch_origin: "created", source_item_id: (item as { id: string }).id }]);
  await openFamily(bogdanPage, "Test family");
  await bogdanPage.getByRole("button", { name: /^Watched together \d+$/ }).click();
  await expect(
    listCard(bogdanPage, "Dune").getByRole("button", { name: "Watched", exact: true }),
  ).toBeVisible();
  expect(await dune()).toEqual({ status: "watched", viewers: [ana.id] });

  // Ana, the only one left on the record, deletes her account, which takes her off it too. Bogdan carries on with
  // the family and its titles, and Dune is back on his To watch.
  await anaPage.goto("/app/settings");
  await anaPage.getByRole("button", { name: "Delete account" }).click();
  await anaPage.getByLabel("Type DELETE to confirm").fill("DELETE");
  await anaPage.getByRole("button", { name: "Delete my account" }).click();
  await expect(anaPage.getByText("Your account and your data have been deleted.")).toBeVisible();
  expect(await dune()).toEqual({ status: "want", viewers: [] });
  await openFamily(bogdanPage, "Test family");
  await expect(
    listCard(bogdanPage, "Dune").getByRole("button", { name: "Mark watched" }),
  ).toBeVisible();

  await Promise.all([anaPage, bogdanPage].map((page) => page.context().close()));
});

test("delete an account", async ({ page, context }) => {
  const cara = await createUser("Cara");
  await signIn(context, cara);

  await page.goto("/app/settings");
  await page.getByRole("button", { name: "Delete account" }).click();
  const confirm = page.getByRole("button", { name: "Delete my account" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await confirm.click();

  await expect(page.getByText("Your account and your data have been deleted.")).toBeVisible();
  const { data } = await admin.auth.admin.getUserById(cara.id);
  expect(data.user).toBeNull();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
});
