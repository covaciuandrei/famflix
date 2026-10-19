import { randomUUID } from "node:crypto";

import { test } from "@playwright/test";

import type { MediaType } from "../src/lib/types";
import { admin, createUser, expect, listCard, signIn } from "./helpers";
import { noSideways } from "./stats-page";
import { seedTitles } from "./stats-seed";

async function seedFeedback(type: MediaType = "movie") {
  const [ana, bogdan, cara] = await Promise.all(
    ["Ana", "Bogdan", "Cara"].map((name) => createUser(name)),
  );
  const { data: group, error } = await admin
    .from("groups")
    .insert({ name: "Feedback family", invite_code: randomUUID().slice(0, 8), created_by: ana.id })
    .select("id")
    .single();
  if (error) throw error;
  const { error: membersError } = await admin.from("group_members").insert(
    [ana, bogdan, cara].map((user) => ({
      group_id: group.id,
      user_id: user.id,
      role: user.id === ana.id ? "owner" : "member",
    })),
  );
  if (membersError) throw membersError;

  const title = type === "movie" ? "Feedback movie" : "Feedback series";
  const seeded = await seedTitles(group.id, ana.id, { Ana: ana.id, Bogdan: bogdan.id, Cara: cara.id }, [
    { name: title, type, runtime: 100, genres: ["Drama"], scores: { Ana: 8.5, Bogdan: 6.5 } },
    { name: "Unrated feedback", type: "movie", runtime: 90, genres: [] },
  ]);
  const itemId = seeded.items[title];
  const { error: noteError } = await admin.from("ratings").insert({
    list_item_id: itemId,
    user_id: cara.id,
    comment: "A note without a score",
  });
  if (noteError) throw noteError;
  const { error: reactionError } = await admin.from("reactions").upsert([
    { list_item_id: itemId, user_id: ana.id, value: "like" },
    { list_item_id: itemId, user_id: bogdan.id, value: "dislike" },
    { list_item_id: itemId, user_id: cara.id, value: "like" },
  ], { onConflict: "list_item_id,user_id" });
  if (reactionError) throw reactionError;
  return { ana, bogdan, groupId: group.id, itemId, mediaId: seeded.media[title], title };
}

async function feedbackRows(itemId: string) {
  const [ratings, reactions] = await Promise.all([
    admin.from("ratings").select("*").eq("list_item_id", itemId).order("user_id"),
    admin.from("reactions").select("*").eq("list_item_id", itemId).order("user_id"),
  ]);
  if (ratings.error) throw ratings.error;
  if (reactions.error) throw reactions.error;
  return { ratings: ratings.data, reactions: reactions.data };
}

for (const type of ["movie", "tv"] as const) {
  test(`family feedback: a ${type} score opens each member's rating without changing anything`, async ({ page, context }) => {
    const seeded = await seedFeedback(type);
    await signIn(context, seeded.ana);
    await page.goto(`/app/family/${seeded.groupId}`);
    const card = listCard(page, seeded.title);
    const trigger = card.getByRole("button", { name: /^View family ratings/ });
    await expect(trigger).toContainText("7.5/10");
    await expect(trigger).toContainText("(2)");
    const before = await feedbackRows(seeded.itemId);

    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Family ratings", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(seeded.title, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    const ana = dialog.getByRole("listitem").filter({ hasText: "Ana" });
    await expect(ana).toContainText("8.5/10");
    await expect(ana).toContainText("(You)");
    await expect(dialog.getByRole("listitem").filter({ hasText: "Bogdan" })).toContainText("6.5/10");
    await expect(dialog).not.toContainText("Cara");
    await expect(dialog).not.toContainText("A note without a score");
    await expect(dialog.locator("button")).toHaveCount(1);
    await noSideways(page);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    await dialog.getByRole("heading").click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(card.getByRole("button", { name: "Like (2)", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await feedbackRows(seeded.itemId)).toEqual(before);
  });
}

test("family feedback: reactions list the right people and inspecting them never casts a vote", async ({ page, context }) => {
  const seeded = await seedFeedback();
  await signIn(context, seeded.ana);
  await page.goto(`/app/family/${seeded.groupId}`);
  const card = listCard(page, seeded.title);
  const trigger = card.getByRole("button", { name: /^View family reactions/ });
  const before = await feedbackRows(seeded.itemId);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Family reactions", exact: true });
  const likes = dialog.getByRole("region", { name: "Liked", exact: true });
  const dislikes = dialog.getByRole("region", { name: "Disliked", exact: true });
  await expect(likes.getByRole("heading")).toHaveText("Liked (2)");
  await expect(likes.getByRole("listitem").locator("p")).toHaveText(["Ana (You)", "Cara"]);
  await expect(dislikes.getByRole("heading")).toHaveText("Disliked (1)");
  await expect(dislikes.getByRole("listitem").locator("p")).toHaveText(["Bogdan"]);
  await noSideways(page);

  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await feedbackRows(seeded.itemId)).toEqual(before);

  // The thumbs still switch and clear your own reaction, independently of the read-only breakdown.
  await card.getByRole("button", { name: "Dislike (1)", exact: true }).click();
  const myDislike = card.getByRole("button", { name: "Dislike (2)", exact: true });
  await expect(myDislike).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "Like (1)", exact: true })).toHaveAttribute("aria-pressed", "false");
  await trigger.click();
  await expect(likes.getByRole("listitem").locator("p")).toHaveText(["Cara"]);
  await expect(dislikes.getByRole("listitem").locator("p")).toHaveText(["Ana (You)", "Bogdan"]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await myDislike.click();
  await expect(card.getByRole("button", { name: "Dislike (1)", exact: true })).toHaveAttribute("aria-pressed", "false");
  await trigger.click();
  await expect(dislikes.getByRole("listitem").locator("p")).toHaveText(["Bogdan"]);
  await expect(dialog.getByText("(You)", { exact: true })).toHaveCount(0);
});

test("family feedback: a title without ratings or reactions has clear empty states", async ({ page, context }) => {
  const seeded = await seedFeedback();
  await signIn(context, seeded.ana);
  await page.goto(`/app/family/${seeded.groupId}`);
  const card = listCard(page, "Unrated feedback");
  await expect(card.getByRole("button", { name: /^View family ratings/ })).toHaveCount(0);
  await card.getByRole("button", { name: /^View family reactions/ }).click();
  const dialog = page.getByRole("dialog", { name: "Family reactions", exact: true });
  await expect(dialog.getByRole("heading", { name: "Liked (0)", exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Disliked (0)", exact: true })).toBeVisible();
  await expect(dialog.getByText("No likes yet.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No dislikes yet.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("family feedback: personal feedback stays separate and outsiders cannot see a family's breakdown", async ({ page, context }) => {
  const seeded = await seedFeedback();
  const { data: personal, error } = await admin.from("list_items")
    .insert({ added_by: seeded.ana.id, media_id: seeded.mediaId, status: "want" })
    .select("id").single();
  if (error) throw error;
  const { error: scoreError } = await admin.from("ratings")
    .insert({ list_item_id: personal.id, user_id: seeded.ana.id, score: 4.2 });
  if (scoreError) throw scoreError;
  const { error: reactionError } = await admin.from("reactions")
    .insert({ list_item_id: personal.id, user_id: seeded.ana.id, value: "dislike" });
  if (reactionError) throw reactionError;
  await signIn(context, seeded.ana);
  await page.goto("/app/mine");
  const personalCard = listCard(page, seeded.title);
  await expect(personalCard.getByText(/^4\.2\/10\s*\(1\)$/)).toBeVisible();
  await expect(personalCard.getByRole("button", { name: /^View family/ })).toHaveCount(0);
  await expect(personalCard.getByText("Who reacted?", { exact: true })).toHaveCount(0);

  await page.goto(`/app/family/${seeded.groupId}`);
  await listCard(page, seeded.title).getByRole("button", { name: /^View family ratings/ }).click();
  const ratings = page.getByRole("dialog", { name: "Family ratings", exact: true });
  await expect(ratings.getByRole("listitem")).toHaveCount(2);
  await expect(ratings).not.toContainText("4.2");
  await ratings.getByRole("button", { name: "Close", exact: true }).click();
  await signIn(context, await createUser("Outsider"));
  await page.goto(`/app/family/${seeded.groupId}`);
  await expect(page.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^View family/ })).toHaveCount(0);
  await expect(page.getByText(seeded.title, { exact: true })).toHaveCount(0);
});

test("family feedback: unavailable profiles do not drop a member's score or reaction", async ({ page, context }) => {
  const seeded = await seedFeedback();
  const { error } = await admin.from("group_members").delete()
    .eq("group_id", seeded.groupId).eq("user_id", seeded.bogdan.id);
  if (error) throw error;
  await signIn(context, seeded.ana);
  await page.goto(`/app/family/${seeded.groupId}`);
  const card = listCard(page, seeded.title);
  await card.getByRole("button", { name: /^View family ratings/ }).click();
  const ratings = page.getByRole("dialog", { name: "Family ratings", exact: true });
  await expect(ratings.getByRole("listitem")).toHaveCount(2);
  await expect(ratings.getByRole("listitem").filter({ hasText: "Family member" })).toContainText("6.5/10");
  await expect(ratings).not.toContainText("Bogdan");
  await ratings.getByRole("button", { name: "Close", exact: true }).click();
  await card.getByRole("button", { name: /^View family reactions/ }).click();
  const reactions = page.getByRole("dialog", { name: "Family reactions", exact: true });
  const dislikes = reactions.getByRole("region", { name: "Disliked", exact: true });
  await expect(dislikes.getByRole("heading")).toHaveText("Disliked (1)");
  await expect(dislikes.getByRole("listitem").locator("p")).toHaveText(["Family member"]);
});

test("family feedback: movie-night scores and counts open the same breakdown without navigating", async ({ page, context }) => {
  const seeded = await seedFeedback();
  await signIn(context, seeded.ana);
  const path = `/app/movie-night/list?list=${seeded.groupId}`;
  await page.goto(path);
  await page.getByRole("button", { name: new RegExp(`^View family ratings for ${seeded.title}:`) }).click();
  const ratings = page.getByRole("dialog", { name: "Family ratings", exact: true });
  await expect(ratings.getByRole("listitem")).toHaveCount(2);
  await expect(page).toHaveURL(path);
  await ratings.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^View family reactions for ${seeded.title}:`) }).click();
  const reactions = page.getByRole("dialog", { name: "Family reactions", exact: true });
  await expect(reactions.getByRole("region", { name: "Liked", exact: true }).getByRole("listitem")).toHaveCount(2);
  await expect(reactions.getByRole("region", { name: "Disliked", exact: true }).getByRole("listitem")).toHaveCount(1);
  await expect(page).toHaveURL(path);
  await noSideways(page);
  await reactions.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("a button")).toHaveCount(0);
  await expect(page.locator('a[href^="/app/media/"]').filter({ hasText: seeded.title })).toHaveCount(1);
});
