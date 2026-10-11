import type { Page } from "@playwright/test";

import { expect } from "./helpers";

// How the stats screens (a family's and a person's) are read in the browser tests.

/** A box of the stats, by its heading. */
export const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/** A number at the top of the page, by what it counts (a label can carry a hint after it, so it is matched by its start). */
export const tile = (page: Page, label: string) => page.locator("dl > div", { hasText: label }).first().locator("dd");

/** One line of a box, by its small heading. */
export const fact = (page: Page, card: string, label: string) => region(page, card).locator("dl > div", { hasText: label });

/** A choice in the year picker. */
export const year = (page: Page, label: string) =>
  page.getByRole("navigation", { name: "Year" }).getByRole("link", { name: label, exact: true });

/** The page doesn't scroll sideways (it would on a phone if something were too wide). */
export async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}
