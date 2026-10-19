import { randomUUID } from "node:crypto";

import { test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { admin, createUser, expect, listCard, openAnonymous, setSlider, signIn, type TestUser } from "./helpers";
import { noSideways } from "./stats-page";
import { rows } from "./night-helpers";

const day = (daysBack: number) => new Date(Date.now() - daysBack * 86_400_000).toLocaleDateString("en-CA");

function must<T>({ data, error }: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) throw new Error("The test fixture was not returned.");
  return data as NonNullable<T>;
}

async function asUser(user: TestUser) {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return db;
}

async function seed() {
  const [ana, ben, daria] = await Promise.all(["Ana", "Ben", "Daria"].map(createUser));
  const group = must(await admin.from("groups").insert({
    name: "Attendance family", invite_code: randomUUID().slice(0, 8), created_by: ana.id,
  }).select("id").single());
  const members = await admin.from("group_members").insert([
    { group_id: group.id, user_id: ana.id, role: "owner" }, { group_id: group.id, user_id: ben.id, role: "member" },
  ]);
  if (members.error) throw members.error;
  const base = 400_000_000 + Math.floor(Math.random() * 90_000_000);
  const media = must(await admin.from("media").insert([
    { tmdb_id: base, media_type: "movie", title: "Attendance feature A", release_year: 2021 },
    { tmdb_id: base + 1, media_type: "movie", title: "Attendance feature B", release_year: 2022 },
  ]).select("id,title"));
  const items = must(await admin.from("list_items").insert(media.map((m) => ({
    group_id: group.id, added_by: ana.id, media_id: m.id, status: "want",
  }))).select("id,media_id"));
  const db = await asUser(ana);
  const guestId = must(await db.rpc("save_family_guest", { p_group: group.id, p_name: "Daria" })) as string;
  return { ana, ben, daria, groupId: group.id as string, itemId: items[0].id as string, item2: items[1].id as string,
    mediaId: media[0].id as string, db, guestId };
}

async function log(s: Awaited<ReturnType<typeof seed>>, watchedOn: string | null, again = false) {
  const saved = must(await s.db.rpc("save_family_watch", {
    p_item: s.itemId, p_on: watchedOn,
    p_members: [{ user_id: s.ana.id, score: 8 }],
    p_guests: [{ guest_id: s.guestId, score: 9 }], p_again: again,
  })) as { viewing_id: string };
  const night = must(await admin.from("movie_nights").select("id").eq("viewing_id", saved.viewing_id).single());
  return { viewingId: saved.viewing_id, nightId: night.id as string };
}

test("attendance: offline guests, unknown dates, guest averages and reopening the same viewing", async ({ page, context }) => {
  const s = await seed();
  await signIn(context, s.ana);
  await page.goto(`/app/family/${s.groupId}`);
  const card = listCard(page, "Attendance feature A");
  await card.getByRole("button", { name: "Watched together", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Who watched Attendance feature A?" });
  await dialog.getByRole("checkbox", { name: "I don't remember" }).check();
  await dialog.getByRole("checkbox", { name: /Daria/ }).check();
  await setSlider(dialog.getByRole("slider", { name: "Score for Ana", exact: true }), 8);
  await setSlider(dialog.getByRole("slider", { name: "Guest score for Daria", exact: true }), 9);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: /^Watched together 1$/ }).click();
  await card.getByRole("button", { name: /^View family ratings/ }).click();
  const scores = page.getByRole("dialog", { name: "Family ratings", exact: true });
  await expect(scores).toContainText("8.5/10");
  await expect(scores.getByRole("listitem")).toHaveCount(2);
  await expect(scores.getByRole("listitem").filter({ hasText: "Daria" })).toContainText("9/10");
  await expect(scores.getByRole("listitem").filter({ hasText: "Daria" })).toContainText("(Guest)");
  await scores.getByRole("button", { name: "Close", exact: true }).click();

  await card.getByRole("button", { name: "Watched together", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "I don't remember" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Daria/ })).toBeChecked();
  await expect(dialog.locator('input[type="range"]')).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Your note" })).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "I don't remember" }).uncheck();
  await dialog.getByLabel("Date", { exact: true }).fill(day(4));
  await expect(dialog.getByRole("status").filter({ hasText: "Changing the original date" })).toBeVisible();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  expect(must(await admin.from("movie_nights").select("id,happened_on").eq("picked_list_item_id", s.itemId))).toHaveLength(1);
  expect(must(await admin.from("movie_nights").select("happened_on").eq("picked_list_item_id", s.itemId).single()).happened_on).toBe(day(4));
  await noSideways(page);
  await page.goto(`/app/family/${s.groupId}?view=stats&year=${new Date().getFullYear()}`);
  const top = page.getByRole("region", { name: "Top 5", exact: true }).getByRole("listitem").filter({ hasText: "Attendance feature A" });
  await expect(top).toContainText("8.5");
  await expect(top).toContainText("2 scores");
});

test("attendance: an older viewing can be corrected without changing the later one or its feedback", async ({ page, context }) => {
  const s = await seed();
  const first = await log(s, day(8));
  const second = await log(s, day(2), true);
  await signIn(context, s.ana);
  const before = must(await admin.from("ratings").select("id,score,comment,rated_by").eq("list_item_id", s.itemId));
  await page.goto(`/app/movie-night/${first.nightId}`);
  await page.getByRole("button", { name: "Edit participants", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Who watched Attendance feature A?" });
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveValue(day(8));
  await dialog.getByRole("checkbox", { name: /Ben/ }).check();
  await dialog.getByLabel("Date", { exact: true }).fill(day(1));
  await expect(dialog.getByText(/Changing the original date/)).toBeVisible();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("list", { name: "Who watched it" })).toContainText("Ben");
  expect(must(await admin.from("family_viewings").select("watched_on").eq("id", second.viewingId).single()).watched_on).toBe(day(2));
  expect(must(await admin.from("list_items").select("watched_at").is("group_id", null).eq("added_by", s.ana.id).eq("media_id", s.mediaId).single()).watched_at.slice(0, 10)).toBe(day(2));
  expect(must(await admin.from("ratings").select("id,score,comment,rated_by").eq("list_item_id", s.itemId))).toEqual(before);
  await noSideways(page);
});

test("attendance: visible invitations reuse a saved guest rather than matching a typed name", async ({ page, context, browser }, testInfo) => {
  const s = await seed();
  const night = must(await admin.from("movie_nights").insert({ group_id: s.groupId, started_by: s.ana.id }).select("id").single());
  await signIn(context, s.ana);
  await page.goto(`/app/movie-night/${night.id}`);
  await page.getByRole("button", { name: "Invite a guest", exact: true }).click();
  const invite = page.getByRole("dialog", { name: "Invite a guest", exact: true });
  const returning = invite.getByRole("region", { name: "Invite a returning guest" });
  await returning.getByRole("listitem").filter({ hasText: "Daria" }).getByRole("button", { name: "Invite to this night" }).click();
  const url = await returning.getByRole("textbox", { name: "Personal invitation link" }).inputValue();
  const guest = await openAnonymous(browser, testInfo.project);
  await guest.goto(url);
  await expect(guest.getByRole("textbox", { name: "Your name" })).toHaveCount(0);
  await guest.getByRole("button", { name: "Join as Daria" }).click();
  await expect(guest.getByRole("list", { name: "Who is taking part" })).toContainText("You");
  await expect(guest.getByRole("list", { name: "Who is taking part" })).toContainText("Guest");
  await expect(guest.getByRole("button", { name: "Invite a guest", exact: true })).toHaveCount(0);
  expect(must(await admin.from("movie_night_guests").select("profile_id").eq("night_id", night.id))).toEqual([{ profile_id: s.guestId }]);
  await guest.context().close();
});

test("attendance: a guest confirms account linking and imports history without double-counting", async ({ page, context, browser }, testInfo) => {
  const s = await seed();
  await log(s, null);
  await signIn(context, s.ana);
  await page.goto(`/app/family/${s.groupId}?view=members`);
  const saved = page.getByRole("region", { name: "Saved guests", exact: true });
  await saved.getByRole("listitem").filter({ hasText: "Daria" }).getByRole("button", { name: "Invite to FamFlix" }).click();
  const url = await saved.getByRole("textbox", { name: "Personal invitation link" }).inputValue();
  const guest = await openAnonymous(browser, testInfo.project);
  await guest.goto(url);
  await expect(guest.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", /\/login\?next=/);
  expect(must(await admin.from("group_members").select("user_id").eq("group_id", s.groupId).eq("user_id", s.daria.id))).toHaveLength(0);
  await signIn(guest.context(), s.daria);
  await guest.goto(url);
  await expect(guest.getByText(/Signed in as/)).toContainText("Daria");
  await guest.getByRole("button", { name: "Link my history and join the family" }).click();
  await expect(guest.getByRole("heading", { name: "Your history is linked" })).toBeVisible();
  await expect(guest.getByRole("status")).toContainText("1 viewing record and 1 family score imported");
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Your history is linked" })).toBeVisible();
  await guest.getByRole("link", { name: "Open the family", exact: true }).click();
  const confirmation = guest.getByRole("dialog", { name: "How did you like it?", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Later", exact: true }).click();
  await guest.getByRole("button", { name: /^Watched together 1$/ }).click();
  const card = listCard(guest, "Attendance feature A");
  await expect(card.getByRole("button", { name: /^View family ratings/ })).toContainText("8.5/10");
  await card.getByRole("button", { name: /^View family ratings/ }).click();
  const ratings = guest.getByRole("dialog", { name: "Family ratings", exact: true });
  await expect(ratings.getByRole("listitem")).toHaveCount(2);
  await expect(ratings).not.toContainText("(Guest)");
  expect(must(await admin.from("family_guests").select("account_id").eq("id", s.guestId).single()).account_id).toBe(s.daria.id);
  expect(must(await admin.from("reactions").select("id").eq("user_id", s.daria.id))).toHaveLength(0);
  await noSideways(guest);
  await guest.context().close();
});

test("attendance: guest names can be corrected across past movies", async ({ page, context }) => {
  const s = await seed();
  const first = await log(s, day(4));
  must(await s.db.rpc("save_family_watch", { p_item: s.item2, p_on: day(3),
    p_members: [{ user_id: s.ana.id }], p_guests: [{ guest_id: s.guestId }] }));
  await signIn(context, s.ana);
  await page.goto(`/app/family/${s.groupId}?view=members`);
  const saved = page.getByRole("region", { name: "Saved guests", exact: true });
  await saved.getByRole("button", { name: "Rename Daria", exact: true }).click();
  await saved.getByRole("textbox", { name: "Name for Daria" }).fill("Daria P");
  await saved.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(saved.getByRole("button", { name: "Rename Daria P", exact: true })).toBeVisible();
  await page.goto(`/app/movie-night/${first.nightId}`);
  await expect(page.getByRole("list", { name: "Who watched it" })).toContainText("Daria P");
  expect(must(await admin.from("family_viewing_guests").select("viewing_id").eq("guest_id", s.guestId))).toHaveLength(2);
});

test("attendance: voting guests can be excluded from watching without changing their votes", async ({ page, context }) => {
  const s = await seed();
  const night = must(await admin.from("movie_nights").insert({ group_id: s.groupId, started_by: s.ana.id }).select("id").single());
  const stack = must(await admin.from("movie_night_stacks").insert({
    night_id: night.id, position: 1, created_by: s.ana.id, revealed_at: new Date().toISOString(),
  }).select("id").single());
  const candidate = must(await admin.from("movie_night_candidates").insert({
    night_id: night.id, stack_id: stack.id, position: 1, origin: "list", media_id: s.mediaId, list_item_id: s.itemId,
  }).select("id").single());
  const token = must(await s.db.rpc("create_guest_invitation", { p_guest: s.guestId, p_night: night.id })) as string;
  const session = must(await admin.rpc("guest_join", { p_token: token, p_name: "" })) as { guest_id: string };
  const voted = await admin.from("movie_night_guest_votes").insert({ candidate_id: candidate.id, guest_id: session.guest_id, vote: "love" });
  if (voted.error) throw voted.error;
  await signIn(context, s.ana);
  await page.goto(`/app/movie-night/${night.id}`);
  await rows(page).first().getByRole("button").first().click();
  await page.getByRole("button", { name: "We watched this", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Who watched Attendance feature A?" });
  await expect(dialog.getByRole("checkbox", { name: /Daria/ })).toBeChecked();
  await dialog.getByRole("checkbox", { name: /Daria/ }).uncheck();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("list", { name: "Who watched it" })).not.toContainText("Daria");
  expect(must(await admin.from("movie_night_guest_votes").select("vote").eq("guest_id", session.guest_id))).toEqual([{ vote: "love" }]);
  expect(must(await admin.from("family_viewing_guests").select("guest_id").eq("guest_id", s.guestId))).toHaveLength(0);
});

test("attendance: a failed guest-directory request shows an error and can be retried", async ({ page, context }) => {
  const s = await seed();
  await signIn(context, s.ana);
  let block = true;
  await page.route(`**/app/family/${s.groupId}*`, async (route) => {
    if (block && route.request().method() === "POST") await route.abort();
    else await route.continue();
  });
  await page.goto(`/app/family/${s.groupId}?view=members`);
  const saved = page.getByRole("region", { name: "Saved guests", exact: true });
  await expect(saved.getByRole("alert")).toContainText("Check your connection");
  block = false;
  await saved.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(saved.getByRole("listitem").filter({ hasText: "Daria" })).toBeVisible();
  await expect(saved.getByRole("alert")).toHaveCount(0);
});
