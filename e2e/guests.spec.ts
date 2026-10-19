import { test, type Page } from "@playwright/test";

import { admin, createUser, expect, openAnonymous, openAs } from "./helpers";
import {
  acceptConfirms,
  closeAll,
  finishStack,
  makeFamily,
  openFamilyNight,
  rows,
  startNight,
  TMDB,
  topCard,
  vote,
} from "./night-helpers";

const people = (page: Page) => page.getByRole("list", { name: "Who is taking part" });
const personIn = (page: Page, name: string) => people(page).getByRole("listitem").filter({ hasText: name });

/** A link's token, from the address a guest would open. */
const tokenOf = (url: string) => url.split("/guest/")[1];

/** The night's guest link, from the invite window of a member's page. */
async function inviteLink(page: Page, action?: "New link" | "Turn off link"): Promise<string> {
  await page.getByRole("button", { name: "Movie night menu" }).click();
  await page.getByRole("menuitem", { name: "Invite a guest" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a guest" });
  const link = dialog.getByRole("textbox", { name: "Guest link" });
  await expect(link).toHaveValue(/\/guest\/[0-9a-f]{64}$/);
  const before = await link.inputValue();
  if (action === "New link") {
    await dialog.getByRole("button", { name: action }).click();
    await expect(link).not.toHaveValue(before);
  } else if (action === "Turn off link") {
    await dialog.getByRole("button", { name: action }).click();
    await expect(dialog.getByText("The link is turned off")).toBeVisible();
  }
  const url = action === "Turn off link" ? before : await link.inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  return url;
}

async function returningGuestLink(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "Invite a guest", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a guest", exact: true });
  const returning = dialog.getByRole("region", { name: "Invite a returning guest" });
  await returning.getByRole("listitem").filter({ hasText: name })
    .getByRole("button", { name: "Invite to this night" }).click();
  const link = await returning.getByRole("textbox", { name: "Personal invitation link" }).inputValue();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toBeHidden();
  return link;
}

/** Opens a guest link and joins with a name; waits for the first card. */
async function joinAs(guest: Page, link: string, name: string) {
  await guest.goto(link);
  await guest.getByLabel("Your name").fill(name);
  await guest.getByRole("button", { name: "Join the movie night" }).click();
  await expect(topCard(guest)).toBeVisible({ timeout: TMDB });
}

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

  // Voting guests are offered as attendees, but can be unticked independently of their votes.
  await rows(anaPage).first().getByRole("button", { name: "We watched this" }).click();
  const watched = anaPage.getByRole("dialog", { name: /^Who watched/ });
  await expect(watched.getByText("Ana (you)", { exact: true })).toBeVisible();
  await expect(watched.getByText("Ben", { exact: true })).toBeVisible();
  await expect(watched.getByRole("checkbox", { name: /Zoe/ })).toBeChecked();
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

test("a guest joins with the link and no account, votes, sees the leaderboard and can leave", async ({ browser, request }, testInfo) => {
  test.setTimeout(300_000);
  const { pages } = await makeFamily(browser, testInfo.project, "Link Crew", ["Ana", "Ben"]);
  const [anaPage] = pages;
  const keys = testInfo.project.name === "desktop";
  await startNight(anaPage, "Link Crew");
  const nightId = anaPage.url().split("/").pop()!;
  const link = await inviteLink(anaPage);
  const path = new URL(link).pathname;

  // The link opens a page of its own: a name to give and none of the app, nothing the search engines or other
  // sites would get to know about.
  const guest = await openAnonymous(browser, testInfo.project);
  acceptConfirms(guest);
  const response = await guest.goto(link);
  expect(response!.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response!.headers()["x-robots-tag"]).toContain("noindex");
  expect(response!.headers()["cache-control"]).toMatch(/no-store|private/);
  await expect(guest.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(guest.getByRole("heading", { name: "Link Crew's movie night" })).toBeVisible();
  await expect(guest.getByRole("link", { name: /^(Browse|Movie night|My list|Families)$/ })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: "Join the movie night" })).toBeDisabled();

  // Joining gives the guest a cookie that scripts can't read and only this link's pages get.
  await guest.getByLabel("Your name").fill("  Zoe ");
  await guest.getByRole("button", { name: "Join the movie night" }).click();
  await expect(topCard(guest)).toBeVisible({ timeout: TMDB });
  const cookie = (await guest.context().cookies()).find((c) => c.name === "famflix_guest")!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path });
  expect(await guest.evaluate(() => document.cookie)).not.toContain("famflix_guest");

  // The same room, without what the family does: the menu has no way to pick, cancel, invite or show results.
  await expect(guest.getByRole("heading", { name: /^Movie night/ })).toBeVisible();
  await guest.getByRole("button", { name: "Movie night menu" }).click();
  const menu = guest.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Leave this movie night" })).toBeVisible();
  for (const name of ["Invite a guest", "Cancel movie night", "Show results now", "Pick something else", "Back to Movie night"]) {
    await expect(menu.getByRole("menuitem", { name })).toHaveCount(0);
  }
  await guest.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  if (!keys) {
    // A phone has no bottom bar here, so the stack has the room and the page doesn't scroll.
    expect(await guest.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    const caption = (await guest.getByText(/^Love( · \d+ left)?$/).boundingBox())!;
    expect(caption.y + caption.height).toBeLessThanOrEqual(guest.viewportSize()!.height);
  }

  // Votes of all four kinds, then the leaderboard, with the guest's own votes in it as "You".
  for (const kind of ["love", "yes", "nope", "seen"] as const) await vote(guest, kind, keys);
  await finishStack(guest);
  const { data: zoe } = await admin.from("movie_night_guests").select("id, name").eq("night_id", nightId).single();
  expect(zoe!.name).toBe("Zoe");
  const saved = await admin.from("movie_night_guest_votes").select("vote").eq("guest_id", zoe!.id);
  expect((saved.data ?? []).map((v) => v.vote).sort()).toEqual(["love", "nope", "seen", "yes"]);
  await expect(rows(guest)).toHaveCount(4);
  await rows(guest).first().getByRole("button").first().click();
  await expect(rows(guest).first()).toContainText("You");
  for (const name of [/We watched this/, /^Add to/, /More like this/, "Pick something else", "More suggestions", "Show results now"]) {
    await expect(guest.getByRole("button", { name })).toHaveCount(0);
  }
  // A title's details are there, without a way into the app.
  await rows(guest).first().getByRole("button", { name: "Details" }).click();
  const sheet = guest.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Open the title page" })).toHaveCount(0);
  await guest.keyboard.press("Escape");

  // The family sees the guest's votes, marked as a guest's.
  await finishStack(anaPage);
  await expect(personIn(anaPage, "Zoe")).toContainText("Guest", { timeout: 30_000 });
  await rows(anaPage).first().getByRole("button").first().click();
  await expect(rows(anaPage).first()).toContainText("Zoe (guest)");

  // What a guest can reach: their own night, and nothing of the family's or the app's.
  expect((await guest.request.get(`/api/movie-night/${nightId}/state`)).status()).toBe(401);
  const own = await guest.request.get(`${path}/state`);
  expect(own.status()).toBe(200);
  const state = await own.json();
  expect(state.viewer).toBe("guest");
  expect(state.results.length).toBeGreaterThan(0);
  expect(state.results.every((r: { family_item_id: string | null; on_my_list: boolean }) => r.family_item_id === null && !r.on_my_list)).toBe(true);
  expect((await request.get(`${path}/state`)).status()).toBe(404);
  // The cookie belongs to this link's address alone: at any other the guest is a stranger.
  await guest.goto(`/guest/${"0".repeat(64)}`);
  await expect(guest.getByRole("heading", { name: "This link isn't working" })).toBeVisible();
  expect((await guest.request.get(`/guest/${"0".repeat(64)}/state`)).status()).toBe(404);
  await guest.goto("/app/movie-night");
  await expect(guest).toHaveURL(/\/login/);
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "Leaderboard" })).toBeVisible();

  // Leaving takes the guest's name, votes and cookie with them.
  await guest.getByRole("button", { name: "Movie night menu" }).click();
  await guest.getByRole("menuitem", { name: "Leave this movie night" }).click();
  await expect(guest.getByRole("heading", { name: "You left the movie night" })).toBeVisible();
  expect((await guest.context().cookies()).some((c) => c.name === "famflix_guest")).toBe(false);
  expect((await admin.from("movie_night_guests").select("id").eq("night_id", nightId)).data).toEqual([]);
  await expect(personIn(anaPage, "Zoe")).toHaveCount(0, { timeout: 30_000 });
  await expect(rows(anaPage)).toHaveCount(0);

  await closeAll([...pages, guest]);
});

test("the family keeps control of the link, and a guest hears when the night is over", async ({ browser }, testInfo) => {
  test.setTimeout(400_000);
  const { pages } = await makeFamily(browser, testInfo.project, "Control Crew", ["Ana", "Ben"]);
  const [anaPage, benPage] = pages;
  const cara = await openAs(browser, testInfo.project, await createUser("Cara"));
  const keys = testInfo.project.name === "desktop";
  await startNight(anaPage, "Control Crew");
  const nightId = anaPage.url().split("/").pop()!;
  const link = await inviteLink(anaPage);
  const guests = async () => ((await admin.from("movie_night_guests").select("name").eq("night_id", nightId)).data ?? []).map((g) => g.name);

  const zoe = await openAnonymous(browser, testInfo.project);
  await joinAs(zoe, link, "Zoe");
  await vote(zoe, "yes", keys);
  expect(await guests()).toEqual(["Zoe"]);

  // A signed-in member who opens the link is offered the night in the app; somebody from another family is not.
  await benPage.goto(link);
  await expect(benPage.getByRole("heading", { name: "Control Crew's movie night" })).toBeVisible();
  await benPage.getByRole("link", { name: "Open the night in the app" }).click();
  await expect(benPage).toHaveURL(new RegExp(`/app/movie-night/${nightId}$`));
  await cara.goto(link);
  await expect(cara.getByRole("heading", { name: "Control Crew's movie night" })).toBeVisible();
  await expect(cara.getByRole("link", { name: "Open the night in the app" })).toHaveCount(0);

  // A returning person rejoins through a profile-bound invitation, never by claiming a name on the general link.
  await finishStack(anaPage);
  await anaPage.getByRole("button", { name: "Take Zoe out of this movie night" }).click();
  await expect(personIn(anaPage, "Zoe")).toHaveCount(0);
  await expect(zoe.getByRole("heading", { name: "You're not in this movie night any more" })).toBeVisible({ timeout: 30_000 });
  await zoe.reload();
  await expect(zoe.getByRole("heading", { name: "Control Crew's movie night" })).toBeVisible();
  await zoe.goto(await returningGuestLink(anaPage, "Zoe"));
  await zoe.getByRole("button", { name: "Join as Zoe", exact: true }).click();
  await expect(topCard(zoe)).toBeVisible({ timeout: TMDB });
  expect(await guests()).toEqual(["Zoe"]);

  // A new link stops the old one for anybody new, and a guest who is in carries on with the address they have.
  const newer = await inviteLink(anaPage, "New link");
  expect(newer).not.toBe(link);
  const late = await openAnonymous(browser, testInfo.project);
  await late.goto(link);
  await expect(late.getByRole("heading", { name: "This link isn't working" })).toBeVisible();
  await late.goto(newer);
  await expect(late.getByRole("heading", { name: "Control Crew's movie night" })).toBeVisible();
  await zoe.reload();
  await expect(topCard(zoe)).toBeVisible();

  // Turned off, nobody new gets in either; the guest who is in still is.
  await inviteLink(anaPage, "Turn off link");
  await late.goto(newer);
  await expect(late.getByRole("heading", { name: "This link isn't working" })).toBeVisible();
  await zoe.reload();
  await expect(topCard(zoe)).toBeVisible();

  // When the night ends the guest is thanked, and the link says nothing else.
  await anaPage.getByRole("button", { name: "Movie night menu" }).click();
  await anaPage.getByRole("menuitem", { name: "Cancel movie night" }).click();
  await expect(anaPage.getByText(/cancelled this movie night/)).toBeVisible();
  await expect(zoe.getByRole("heading", { name: "This movie night is over" })).toBeVisible({ timeout: 30_000 });
  await expect(zoe.getByText("Thanks for voting!")).toBeVisible();
  await zoe.reload();
  await expect(zoe.getByRole("heading", { name: "This movie night is over" })).toBeVisible();
  await late.goto(link);
  await expect(late.getByRole("heading", { name: "This link isn't working" })).toBeVisible();

  // The night is in the family's history as cancelled, with the guest among the people who took part.
  await openFamilyNight(anaPage, "Control Crew");
  const cancelled = anaPage.locator("#movie-nights ul > li").first();
  await expect(cancelled).toContainText("Cancelled by Ana");
  await expect(cancelled.getByRole("img", { name: /^Took part: .*Zoe \(guest\)$/ })).toBeVisible();

  await closeAll([...pages, cara, zoe, late]);
});

test("guest attendees can be confirmed independently of voting and appear on the night and in history", async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { pages } = await makeFamily(browser, testInfo.project, "Pick Crew", ["Ana", "Ben"]);
  const [anaPage] = pages;
  const keys = testInfo.project.name === "desktop";
  await startNight(anaPage, "Pick Crew");
  const link = await inviteLink(anaPage);

  // Two guests join the way their page does it. Ben never opens the night, so he isn't among those who were there.
  for (const name of ["Zoe", "Yan"]) {
    const joined = await admin.rpc("guest_join", { p_token: tokenOf(link), p_name: name });
    expect(joined.error).toBeNull();
  }
  await vote(anaPage, "yes", keys);
  await finishStack(anaPage);
  await expect(personIn(anaPage, "Zoe")).toContainText("Guest", { timeout: 30_000 });

  // Joined guests start selected, but the picker can correct their actual attendance.
  const top = rows(anaPage).first();
  const title = (await top.getByRole("button").first().innerText()).trim();
  await top.getByRole("button").first().click();
  await top.getByRole("button", { name: "We watched this" }).click();
  const dialog = anaPage.getByRole("dialog", { name: /^Who watched / });
  await expect(dialog.getByRole("checkbox", { name: /Ana/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Ben/ })).not.toBeChecked();
  const guests = dialog.getByRole("region", { name: "Guest participants" });
  await expect(guests.getByRole("checkbox")).toHaveCount(2);
  await expect(guests.getByRole("checkbox", { name: /Yan/ })).toBeChecked();
  await expect(guests.getByRole("checkbox", { name: /Zoe/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(anaPage.getByRole("status").filter({ hasText: "picked" })).toContainText(title);

  // The night's page says who watched: Ana, who was ticked, and the two guests, marked, but not Ben.
  const watched = anaPage.getByRole("list", { name: "Who watched it" }).getByRole("listitem");
  await expect(watched.filter({ hasText: "You" })).toHaveCount(1);
  await expect(watched.filter({ hasText: "Zoe" })).toContainText("Guest");
  await expect(watched.filter({ hasText: "Yan" })).toContainText("Guest");
  await expect(watched.filter({ hasText: "Ben" })).toHaveCount(0);

  // So does the family's history, where the night is finished: everyone who watched, guests after the family.
  await openFamilyNight(anaPage, "Pick Crew");
  const entry = anaPage.locator("#movie-nights ul > li").first();
  await expect(entry).toContainText(title);
  await expect(entry).toContainText("Finished");
  await expect(entry.getByRole("img", { name: "Watched by: Ana, Yan (guest), Zoe (guest)" })).toBeVisible();

  await closeAll(pages);
});
