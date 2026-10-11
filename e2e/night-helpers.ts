import type { Browser, Page, TestInfo } from "@playwright/test";

import { createUser, expect, openAs, startFamily } from "./helpers";

// What the movie night specs share: people with their own browser windows, a family, a night, and the swipe stack.

// A stack is built from TMDB, which can take a few seconds (more when it is slow).
export const TMDB = 90_000;

export type Kind = "yes" | "nope" | "love" | "seen";
const KEYS: Record<Kind, string> = { yes: "ArrowRight", nope: "ArrowLeft", love: "ArrowUp", seen: "s" };
const BUTTONS: Record<Kind, string | RegExp> = { yes: "Yes", nope: "Nope", love: /^Love it/, seen: /^Seen it/ };

/** The card on top of the stack, and the counter above it ("3 / 25"). */
export const topCard = (page: Page) => page.getByRole("group", { name: /, \d+ of \d+$/ });
export const counter = (page: Page) => page.getByText(/^\d+ \/ \d+$/).first();

/** One vote on the top card, by key on a computer and by button on a phone, then waits for the next card. */
export async function vote(page: Page, kind: Kind, keys: boolean) {
  const [position, total] = (await counter(page).innerText()).split(" / ").map(Number);
  if (keys) await page.keyboard.press(KEYS[kind]);
  else await page.getByRole("button", { name: BUTTONS[kind], exact: typeof BUTTONS[kind] === "string" }).click();
  if (position < total) await expect(counter(page)).toHaveText(`${position + 1} / ${total}`);
}

export const leaderboard = (page: Page) => page.getByRole("heading", { name: "Leaderboard" });
export const rows = (page: Page) => page.locator("ol > li");

/** Everybody confirms the questions the app asks ("Cancel this movie night?"). */
export function acceptConfirms(...pages: Page[]) {
  for (const page of pages) page.on("dialog", (dialog) => void dialog.accept());
}

/** People with their own browser windows, and a family made by the first one that the others join. */
export async function makeFamily(browser: Browser, project: TestInfo["project"], name: string, people: string[]) {
  const users = await Promise.all(people.map((person) => createUser(person)));
  const pages = await Promise.all(users.map((user) => openAs(browser, project, user)));
  acceptConfirms(...pages);
  await startFamily(pages[0], pages.slice(1), name);
  return { users, pages };
}

/** Movie night for one family: with several the family is picked with a pill, with one it is already chosen. */
export async function openFamilyNight(page: Page, family: string) {
  await page.goto("/app/movie-night");
  const pill = page.getByRole("link", { name: new RegExp(`^${family}`) });
  if (await pill.count()) await pill.click();
}

/** The family's open night, started from Movie night; waits for the first card. */
export async function startNight(page: Page, family: string) {
  await openFamilyNight(page, family);
  await page.getByRole("button", { name: `Start movie night for ${family}` }).click();
  await expect(topCard(page)).toBeVisible({ timeout: TMDB });
  await expect(page).toHaveURL(/\/app\/movie-night\/[0-9a-f-]{36}$/);
}

/** Skips what is left of the stack and waits for the leaderboard. */
export async function finishStack(page: Page) {
  await page.getByRole("button", { name: "Skip the rest" }).click();
  await expect(leaderboard(page)).toBeVisible();
}

export const closeAll = (pages: Page[]) => Promise.all(pages.map((page) => page.context().close()));
