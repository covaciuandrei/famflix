import { test, type Page } from "@playwright/test";

import { admin, expect } from "./helpers";
import { closeAll, finishStack, makeFamily, openFamilyNight, rows, startNight, TMDB, topCard } from "./night-helpers";

const people = (page: Page) => page.getByRole("list", { name: "Who is taking part" });
const personIn = (page: Page, name: string) => people(page).getByRole("listitem").filter({ hasText: name });

/** A link's token, from the address a guest would open. */
const tokenOf = (url: string) => url.split("/guest/")[1];

test("members invite guests from the night's menu: a link to copy, replace and turn off, and guests they can take out", async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { pages } = await makeFamily(browser, testInfo.project, "Guest Crew", ["Ana", "Ben"]);
  const [anaPage, benPage] = pages;
  await anaPage.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await startNight(anaPage, "Guest Crew");
  const nightId = anaPage.url().split("/").pop()!;
  const storedToken = async () =>
    (await admin.from("movie_night_links").select("token").eq("night_id", nightId).maybeSingle()).data?.token ?? null;
  const linkIsOpen = async (token: string) =>
    ((await admin.rpc("guest_link_info", { p_token: token })).data as { open: boolean }).open;

  // The menu offers a link, made on the spot, that points at a page outside the app.
  await anaPage.getByRole("button", { name: "Movie night menu" }).click();
  await anaPage.getByRole("menuitem", { name: "Invite a guest" }).click();
  const dialog = anaPage.getByRole("dialog", { name: "Invite a guest" });
  await expect(dialog).toBeVisible();
  const link = dialog.getByRole("textbox", { name: "Guest link" });
  await expect(link).toHaveValue(/\/guest\/[0-9a-f]{64}$/);
  const first = await link.inputValue();
  expect(await storedToken()).toBe(tokenOf(first));
  expect(await linkIsOpen(tokenOf(first))).toBe(true);

  // Copying puts the link on the clipboard.
  await dialog.getByRole("button", { name: "Copy" }).click();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await anaPage.evaluate(() => navigator.clipboard.readText())).toBe(first);

  // A new link replaces the old one, which stops working.
  await dialog.getByRole("button", { name: "New link" }).click();
  await expect(link).not.toHaveValue(first);
  const second = await link.inputValue();
  expect(second).toMatch(/\/guest\/[0-9a-f]{64}$/);
  expect(await storedToken()).toBe(tokenOf(second));
  expect(await linkIsOpen(tokenOf(first))).toBe(false);
  expect(await linkIsOpen(tokenOf(second))).toBe(true);

  // Turning it off stops it too, and a link can be made again.
  await dialog.getByRole("button", { name: "Turn off link" }).click();
  await expect(dialog.getByText("The link is turned off")).toBeVisible();
  await expect(link).toHaveCount(0);
  expect(await storedToken()).toBeNull();
  expect(await linkIsOpen(tokenOf(second))).toBe(false);
  await dialog.getByRole("button", { name: "Make a link" }).click();
  await expect(link).toHaveValue(/\/guest\/[0-9a-f]{64}$/);
  const third = await link.inputValue();
  expect(await storedToken()).toBe(tokenOf(third));
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  // A guest joins with the link and votes; they are not in the app, so this is what the guest page will do.
  const joined = (await admin.rpc("guest_join", { p_token: tokenOf(third), p_name: "Zoe" })).data as {
    secret: string;
    guest_id: string;
  };
  const { data: cards } = await admin
    .from("movie_night_candidates")
    .select("id, stack_id, media(title)")
    .eq("night_id", nightId)
    .order("position")
    .limit(2);
  const [loved, liked] = cards as unknown as { id: string; stack_id: string; media: { title: string } }[];
  const cast = await admin.rpc("guest_cast_votes", {
    p_secret: joined.secret,
    p_stack: loved.stack_id,
    p_votes: [
      { candidate_id: loved.id, vote: "love" },
      { candidate_id: liked.id, vote: "yes" },
    ],
  });
  expect(cast.error).toBeNull();
  expect((await admin.rpc("guest_finish_stack", { p_secret: joined.secret, p_stack: loved.stack_id })).error).toBeNull();

  // Ana finishes her stack and sees Zoe among the people, marked Guest and done, and her votes on the board.
  await finishStack(anaPage);
  await expect(personIn(anaPage, "Zoe")).toContainText("Guest", { timeout: 30_000 });
  await expect(personIn(anaPage, "Zoe")).toContainText("done");
  await expect(rows(anaPage)).toHaveCount(2);
  await expect(rows(anaPage).first()).toContainText(loved.media.title);
  await rows(anaPage).first().getByRole("button").first().click();
  await expect(rows(anaPage).first()).toContainText("Zoe (guest)");

  // "We watched this" is for the family: a guest isn't offered as someone who watched.
  await rows(anaPage).first().getByRole("button", { name: "We watched this" }).click();
  const watched = anaPage.getByRole("dialog", { name: /^Who watched/ });
  await expect(watched.getByText("Ana (you)", { exact: true })).toBeVisible();
  await expect(watched.getByText("Ben", { exact: true })).toBeVisible();
  await expect(watched.getByText("Zoe", { exact: true })).toHaveCount(0);
  await watched.getByRole("button", { name: "Cancel" }).click();
  await expect(watched).toBeHidden();

  // Any member can take a guest out, Ben as well as the one who made the link, and their votes go with them.
  await openFamilyNight(benPage, "Guest Crew");
  await benPage.getByRole("region", { name: "Movie night in progress" }).getByRole("link", { name: "Join in" }).click();
  await expect(topCard(benPage)).toBeVisible({ timeout: TMDB });
  await finishStack(benPage);
  await expect(personIn(benPage, "Zoe")).toContainText("Guest");
  await benPage.getByRole("button", { name: "Take Zoe out of this movie night" }).click();
  await expect(personIn(benPage, "Zoe")).toHaveCount(0);
  await expect(benPage.getByText("Nobody has voted yet.")).toBeVisible();
  await expect(personIn(anaPage, "Zoe")).toHaveCount(0, { timeout: 30_000 });
  const left = await admin.from("movie_night_guests").select("id").eq("night_id", nightId);
  expect(left.data).toEqual([]);
  expect((await admin.rpc("guest_movie_night_state", { p_secret: joined.secret })).error?.message).toMatch(/not available/);

  // A night that is over has no link to give out: the menu doesn't offer one, and the link says the night is over.
  await anaPage.getByRole("button", { name: "Movie night menu" }).click();
  await anaPage.getByRole("menuitem", { name: "Cancel movie night" }).click();
  await expect(anaPage.getByText(/cancelled this movie night/)).toBeVisible();
  await anaPage.getByRole("button", { name: "Movie night menu" }).click();
  await expect(anaPage.getByRole("menuitem", { name: "Invite a guest" })).toHaveCount(0);
  expect(await linkIsOpen(tokenOf(third))).toBe(false);

  await closeAll(pages);
});
