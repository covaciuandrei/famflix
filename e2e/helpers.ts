import { randomUUID } from "node:crypto";

import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// The local Supabase from scripts/e2e.sh.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url?.startsWith("http://127.0.0.1")) {
  throw new Error("The browser tests only run against the local Supabase. Use `npm run test:e2e`.");
}

export const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface TestUser {
  id: string;
  name: string;
  email: string;
  password: string;
}

/** A new confirmed account (the live app only allows Google; the local one also allows passwords, for tests). */
export async function createUser(name: string): Promise<TestUser> {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@e2e.test`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw error;
  return { id: data.user.id, name, email, password };
}

/** Signs the user in the way the app's server would, then hands the session cookies to the browser. */
export async function signIn(context: BrowserContext, user: TestUser) {
  const jar = new Map<string, string>();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) =>
        cookies.forEach(({ name, value }) =>
          value ? jar.set(name, value) : jar.delete(name),
        ),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw error;
  await context.addCookies(
    [...jar].map(([name, value]) => ({
      name,
      value,
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax" as const,
    })),
  );
  // Skip the welcome tour.
  await context.addInitScript(() =>
    localStorage.setItem("famflix:welcome-seen", "1"),
  );
}

/**
 * Adds a title to a list: "Add to…" opens a menu (a sheet on phones) to pick the list; someone without a
 * family only has My list, so their button just says "Add".
 */
export async function addTo(page: Page, scope: Locator | Page, listName: string) {
  const button = scope.getByRole("button", { name: /^(Add to…|Add)$/ });
  await expect(button).toBeVisible();
  const opensMenu = (await button.textContent())?.trim() === "Add to…";
  await button.click();
  if (!opensMenu) return;
  await page
    .locator("[popover]:popover-open, dialog[open]")
    .getByRole("button", { name: listName, exact: true })
    .click();
}

/** Sets a score slider (a range input) the way a person dragging it would. */
export async function setSlider(slider: Locator, value: number) {
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

/** The first card of a Browse row. */
export function firstCard(page: Page, row: string): Locator {
  return page
    .locator("section", { has: page.getByRole("heading", { name: row, exact: true }) })
    .locator(":scope > div > div")
    .first();
}

/** A browser window for one signed-in person, sized like the project's screen (a computer or a phone). */
export async function openAs(
  browser: Browser,
  project: TestInfo["project"],
  user: TestUser,
): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } =
    project.use;
  const context = await browser.newContext({
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    baseURL,
  });
  await signIn(context, user);
  return context.newPage();
}

/** The owner starts a family and the others join it with its invite code. */
export async function startFamily(owner: Page, others: Page[], name: string) {
  await owner.goto("/app/groups");
  await owner.getByPlaceholder("Family name").fill(name);
  await owner.getByRole("button", { name: "Create family" }).click();
  await expect(owner.getByRole("heading", { name })).toBeVisible();
  const code = (await owner.getByTitle("Copy invite code").first().textContent())!.trim();
  for (const page of others) {
    await page.goto("/app/groups");
    await page.getByPlaceholder("Invite code").fill(code.toLowerCase());
    await page.getByRole("button", { name: "Join family" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
}

/** Opens a family's list from the Families page. */
export async function openFamily(page: Page, name: string) {
  await page.goto("/app/groups");
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

/** A title's card on a list page. */
export function listCard(page: Page, title: string): Locator {
  return page
    .locator("div.rounded-xl", { has: page.getByRole("link", { name: title, exact: true }) })
    .last();
}

export { expect };
