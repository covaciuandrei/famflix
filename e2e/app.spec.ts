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

test("the login page only offers Google", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
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

test("mark a title watched from its page, with a score and a note", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);

  await page.goto("/app/media/movie/438631");
  await expect(page.getByRole("heading", { name: "Dune" })).toBeVisible();
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
  await dialog.getByRole("checkbox").nth(1).check();
  const bogdanRow = dialog.locator("li", { hasText: "Bogdan" });
  await setSlider(bogdanRow.locator('input[type="range"]'), 8.5);
  await dialog.getByRole("textbox", { name: "Your note" }).fill("Ana's note");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  // Bogdan is asked to confirm the 8.5 Ana filled in, and adds his note.
  await bogdanPage.goto("/app");
  const ask = bogdanPage.getByRole("dialog", { name: "How did you like it?" });
  await expect(ask).toBeVisible();
  await expect(ask.getByText(/filled in 8\.5\/10 for you/)).toBeVisible();
  await ask.getByPlaceholder("Add a note (optional)").fill("Bogdan's note");
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(ask).toBeHidden();

  const { data } = await admin
    .from("ratings")
    .select("user_id, score, comment, rated_by")
    .in("user_id", [ana.id, bogdan.id])
    .order("comment");
  expect(data).toEqual([
    { user_id: ana.id, score: null, comment: "Ana's note", rated_by: ana.id },
    { user_id: bogdan.id, score: 8.5, comment: "Bogdan's note", rated_by: bogdan.id },
  ]);
  await Promise.all([anaPage, bogdanPage].map((page) => page.context().close()));
});

test("I wasn't there: the title goes back to To watch only when nobody else was there", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const bogdan = await createUser("Bogdan");
  const anaPage = await openAs(browser, testInfo.project, ana);
  const bogdanPage = await openAs(browser, testInfo.project, bogdan);
  await startFamily(anaPage, [bogdanPage], "Test family");

  await anaPage.goto("/app/media/movie/438631");
  await addTo(anaPage, anaPage, "Test family");
  await expect(anaPage.getByRole("img", { name: /On Test family/ })).toBeVisible();

  const dune = async () => {
    const { data } = await admin
      .from("list_items")
      .select("status, watches(user_id)")
      .eq("added_by", ana.id)
      .not("group_id", "is", null)
      .single();
    const row = data as { status: string; watches: { user_id: string }[] };
    return { status: row.status, viewers: row.watches.map((w) => w.user_id) };
  };
  async function logWatchedTogether(page: Page, who: { ana: boolean; bogdan: boolean }) {
    await openFamily(page, "Test family");
    await page.getByRole("button", { name: "Watched together", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Who watched Dune/ });
    await dialog.getByRole("checkbox").nth(0).setChecked(who.ana);
    await dialog.getByRole("checkbox").nth(1).setChecked(who.bogdan);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  }
  async function bogdanSaysHeWasntThere() {
    await bogdanPage.goto("/app");
    const ask = bogdanPage.getByRole("dialog", { name: "How did you like it?" });
    await ask.getByRole("button", { name: "I wasn't there" }).click();
    await expect(ask).toBeHidden();
  }

  // Ana logs only Bogdan; he says he wasn't there. Nobody watched it, so it is back on To watch, unticked.
  await logWatchedTogether(anaPage, { ana: false, bogdan: true });
  expect(await dune()).toEqual({ status: "watched", viewers: [bogdan.id] });
  await bogdanSaysHeWasntThere();
  await openFamily(bogdanPage, "Test family");
  const card = listCard(bogdanPage, "Dune");
  await expect(card.getByRole("button", { name: "Mark watched" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Watched", exact: true })).toHaveCount(0);
  expect(await dune()).toEqual({ status: "want", viewers: [] });

  // Ana logs both and Bogdan says it again. Ana was there, so it stays watched together, with only her on it.
  await logWatchedTogether(anaPage, { ana: true, bogdan: true });
  await bogdanSaysHeWasntThere();
  await openFamily(bogdanPage, "Test family");
  await bogdanPage.getByRole("button", { name: /^Watched together \d+$/ }).click();
  await expect(
    listCard(bogdanPage, "Dune").getByRole("button", { name: "Watched", exact: true }),
  ).toBeVisible();
  expect(await dune()).toEqual({ status: "watched", viewers: [ana.id] });

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
