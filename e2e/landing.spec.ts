import { expect, test } from "@playwright/test";

test("the landing page explains personal and shared use and keeps signup and legal links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Less choosing\.\s*More watching\./);
  await expect(page.getByText("Your own watchlist. A shared one", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Create your watchlist" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("heading", { name: "Your watchlist, your way." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Less back-and-forth. More movie night." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pick up where you left off." })).toBeHidden();
  await expect(page.getByRole("heading", { name: "The good nights, remembered." })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Make a night of it." })).toHaveCount(0);
  await expect(page.getByText("Plan ahead", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute("href", "/privacy");
  await expect(page.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute("href", "/terms");
  await expect(page.getByText("not endorsed or certified by TMDB", { exact: false })).toBeVisible();
});

test("the preview switches between personal lists, family lists and movie night without API calls", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.goto("/");
  const mine = page.getByRole("tabpanel", { name: "My list", exact: true });
  const family = page.getByRole("tabpanel", { name: "Family list", exact: true });
  const night = page.getByRole("tabpanel", { name: "Movie night", exact: true });
  await expect(mine).toBeVisible();
  await expect(family).toBeHidden();
  await expect(night).toBeHidden();
  const previewHeight = await mine.evaluate((element) => element.clientHeight);

  await page.getByRole("tab", { name: "Family list", exact: true }).click();
  await expect(family).toBeVisible();
  await expect(mine).toBeHidden();
  await expect(family.getByRole("heading", { name: "Friday crew" })).toBeVisible();
  await expect(family.getByText("Alex's pick", { exact: true })).toBeVisible();
  expect(await family.evaluate((element) => element.clientHeight)).toBe(previewHeight);

  await page.getByRole("tab", { name: "Movie night", exact: true }).click();
  await expect(night).toBeVisible();
  await expect(night.getByText("5 points", { exact: true })).toBeVisible();
  await expect(night.getByText("without creating an account", { exact: false })).toBeVisible();
  const rows = night.getByRole("list", { name: "Example movie-night leaderboard" }).getByRole("listitem");
  await expect(rows).toHaveCount(4);
  const results = [
    { title: "Orbit Club", points: "5 points", votes: "2 Love · 1 Yes" },
    { title: "Sunday in Bloom", points: "3 points", votes: "1 Love · 1 Yes · 1 Seen it" },
    { title: "The Last Lighthouse", points: "1 point", votes: "1 Love · 1 Nope · 1 Seen it" },
    { title: "Midnight Metro", points: "-1 point", votes: "1 Yes · 2 Nope" },
  ];
  for (const [index, result] of results.entries()) {
    await expect(rows.nth(index).getByRole("heading", { name: result.title })).toBeVisible();
    await expect(rows.nth(index).getByText(result.points, { exact: true })).toBeVisible();
    await expect(rows.nth(index).getByText(result.votes, { exact: true })).toBeVisible();
  }
  expect(await night.evaluate((element) => element.clientHeight)).toBe(previewHeight);
  await expect(page.getByText("nothing is saved", { exact: false })).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test("the personal preview marks a title watched, keeps its state when changing tabs and can reset", async ({ page }) => {
  await page.goto("/");
  const mine = page.getByRole("tabpanel", { name: "My list", exact: true });
  await expect(mine.getByRole("listitem")).toHaveCount(3);
  await mine.getByRole("button", { name: "Mark watched", exact: true }).click();
  await expect(mine.getByRole("listitem")).toHaveCount(1);
  await expect(mine.getByRole("status")).toContainText("Marked watched, just in this preview");
  await expect(mine.getByText("To watch 2", { exact: true })).toBeVisible();
  await expect(mine.getByText("Watched 1", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Family list", exact: true }).click();
  await page.getByRole("tab", { name: "My list", exact: true }).click();
  await expect(mine.getByRole("listitem")).toHaveCount(1);
  await mine.getByRole("button", { name: "Reset preview", exact: true }).click();
  await expect(mine.getByRole("listitem")).toHaveCount(3);
  await expect(mine.getByText("To watch 3", { exact: true })).toBeVisible();
});

test("the preview tabs support arrow keys, Home and End with associated panels", async ({ page }) => {
  await page.goto("/");
  const mine = page.getByRole("tab", { name: "My list", exact: true });
  const family = page.getByRole("tab", { name: "Family list", exact: true });
  const night = page.getByRole("tab", { name: "Movie night", exact: true });
  await mine.focus();
  await mine.press("ArrowRight");
  await expect(family).toBeFocused();
  await expect(family).toHaveAttribute("aria-selected", "true");
  await family.press("End");
  await expect(night).toBeFocused();
  await night.press("ArrowRight");
  await expect(mine).toBeFocused();
  await mine.press("ArrowLeft");
  await expect(night).toBeFocused();
  await night.press("Home");
  await expect(mine).toBeFocused();
  await expect(mine).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: "My list", exact: true });
  await expect(mine).toHaveAttribute("aria-controls", (await panel.getAttribute("id"))!);
});

test("the account-deletion notice still appears on the redesigned landing page", async ({ page }) => {
  await page.goto("/?deleted=1");
  await expect(page.getByRole("status").filter({ hasText: "Your account and your data have been deleted." })).toBeVisible();
});

test("the landing page works in the light theme without horizontal overflow", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("famflix:theme", "light"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  for (const name of ["My list", "Family list", "Movie night"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await page.locator("#more-features > summary").click();
  await expect(page.getByRole("progressbar", { name: "Example season progress" })).toHaveAttribute("aria-valuenow", "6");
  await expect(page.getByRole("button", { name: "Watch intro with narration (25 seconds)" })).toBeVisible();
});

test("extra features expand inline and collapse with the keyboard without losing focus", async ({ page }) => {
  await page.goto("/");
  const details = page.locator("#more-features");
  const control = page.locator("#more-features > summary");
  await control.focus();
  await control.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { name: "Pick up where you left off." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The good nights, remembered." })).toBeVisible();
  await expect(control.getByText("Show less", { exact: true })).toBeVisible();
  await expect(control).toBeFocused();
  await control.press("Space");
  await expect(details).not.toHaveAttribute("open");
  await expect(control).toBeFocused();
  await expect(control.getByText("Show more features", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pick up where you left off." })).toBeHidden();
});

test("scroll reveals finish once and preview rows arrive in a staggered sequence", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("tab", { name: "Family list", exact: true }).click();
  const heading = page.locator("#features > [data-reveal]").first();
  await expect(heading).toHaveAttribute("data-reveal-pending", "");
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).not.toHaveAttribute("data-reveal-pending");
  await expect.poll(() => heading.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await page.getByRole("tab", { name: "Movie night", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Movie night", exact: true });
  expect(await panel.evaluate((element) => getComputedStyle(element).animationName)).toBe("landing-panel-in");
  const rows = panel.locator(".landing-preview-row");
  expect(await rows.evaluateAll((elements) => elements.map((element) => ({
    name: getComputedStyle(element).animationName,
    delay: getComputedStyle(element).animationDelay,
  })))).toEqual([
    { name: "landing-row-in", delay: "0.16s" },
    { name: "landing-row-in", delay: "0.24s" },
    { name: "landing-row-in", delay: "0.32s" },
    { name: "landing-row-in", delay: "0.4s" },
  ]);
  expect(await panel.locator(".landing-points-value").first().evaluate(
    (element) => getComputedStyle(element).animationName,
  )).toBe("landing-score-in");
  await expect(heading).not.toHaveAttribute("data-reveal-pending");
});

test("the hero uses a coordinated two-line mask reveal and a separate product arrival", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const nativeAnimate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, keyframes, options) {
      const animation = nativeAnimate.call(this, keyframes, options);
      queueMicrotask(() => {
        const effect = animation.effect;
        if (!animation.id.startsWith("landing-") || !(effect instanceof KeyframeEffect)) return;
        this.setAttribute("data-test-motion-id", animation.id);
        this.setAttribute("data-test-motion-delay", String(effect.getTiming().delay));
        this.setAttribute("data-test-motion-duration", String(effect.getTiming().duration));
        this.setAttribute("data-test-motion-clip", String(effect.getKeyframes()[0].clipPath ?? ""));
        this.setAttribute("data-test-motion-transform", String(effect.getKeyframes()[0].transform ?? ""));
      });
      return animation;
    };
  });
  await page.goto("/");
  const lines = page.locator("[data-hero-line]");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toHaveAttribute("data-test-motion-id", "landing-hero-line-1");
  await expect(lines.nth(0)).toHaveAttribute("data-test-motion-delay", "100");
  await expect(lines.nth(1)).toHaveAttribute("data-test-motion-delay", "240");
  await expect(lines.nth(1)).toHaveAttribute("data-test-motion-duration", "820");
  await expect(lines.nth(0)).toHaveAttribute("data-test-motion-clip", /100%/);
  await expect(page.locator("[data-hero-part='actions']")).toHaveAttribute("data-test-motion-delay", "480");
  await expect(page.locator("[data-preview-shell]")).toHaveAttribute("data-test-motion-id", "landing-preview-arrival");
  await expect(page.locator("[data-preview-shell]")).toHaveAttribute("data-test-motion-transform", /0\.96/);
  await page.keyboard.press("Tab");
  await page.getByRole("link", { name: "Get started" }).focus();
  await expect.poll(() => page.locator("[data-hero-part='actions']").evaluate(
    (element) => getComputedStyle(element).opacity,
  )).toBe("1");
  expect(await page.locator("[data-hero-part='actions']").evaluate(
    (element) => element.getAnimations().filter((animation) => animation.id === "landing-hero-actions").length,
  )).toBe(0);
});

test("the selection pill slides to the active tab and settles after quick switches", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const indicator = page.locator(".landing-tab-indicator");
  for (const name of ["Movie night", "My list", "Family list", "Movie night"]) {
    await page.getByRole("tab", { name, exact: true }).click();
  }
  const selected = page.getByRole("tab", { name: "Movie night", exact: true });
  await expect(selected).toHaveAttribute("aria-selected", "true");
  expect(await indicator.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe("transform");
  expect(await indicator.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0.54s");
  await expect.poll(async () => {
    const [pill, tab] = await Promise.all([indicator.boundingBox(), selected.boundingBox()]);
    return Math.abs(pill!.x + pill!.width / 2 - tab!.x - tab!.width / 2);
  }).toBeLessThan(1);
  await expect(page.getByRole("list", { name: "Example movie-night leaderboard" }).getByRole("listitem")).toHaveCount(4);
});

test("feature illustrations animate the watch flow and fill the season progress on expansion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const flow = page.locator(".landing-watch-flow");
  await flow.scrollIntoViewIfNeeded();
  await expect(flow.locator("..")).toHaveAttribute("data-revealed", "");
  expect(await flow.locator(".landing-flow-step").first().evaluate(
    (element) => getComputedStyle(element).animationName,
  )).toBe("landing-pop-in");
  expect(await flow.locator(".landing-watched-check path").evaluate(
    (element) => getComputedStyle(element).animationName,
  )).toBe("landing-check-in");
  await page.locator("#more-features > summary").click();
  const progress = page.getByRole("progressbar", { name: "Example season progress" });
  const fill = progress.locator(".landing-progress-fill");
  expect(await fill.evaluate((element) => getComputedStyle(element).animationName)).toBe("landing-fill-in");
  await expect.poll(async () => {
    const [bar, value] = await Promise.all([progress.boundingBox(), fill.boundingBox()]);
    return value!.width / bar!.width;
  }).toBeCloseTo(0.75, 2);
  await expect(progress).toHaveAttribute("aria-valuenow", "6");
});

test("switching to reduced motion reveals pending content and disables landing animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("tab", { name: "Family list", exact: true }).click();
  await expect(page.locator("[data-reveal-pending]").first()).toHaveAttribute("data-reveal-pending", "");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-reveal-pending]")).toHaveCount(0);
  await expect.poll(() => page.locator("[data-landing-motion]").evaluate(
    (element) => element.getAnimations({ subtree: true }).filter(
      (animation) => animation.playState === "running" && (animation.id.startsWith("landing-") || animation instanceof CSSAnimation),
    ).length,
  )).toBe(0);
  await page.getByRole("tab", { name: "Movie night", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Movie night", exact: true });
  expect(await panel.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await panel.locator(".landing-result").first().evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await page.locator(".landing-tab-indicator").evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  await page.locator("#more-features > summary").click();
  expect(await page.locator("#extra-features > article").first().evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await page.locator("#extra-features .landing-progress-fill").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("feature disclosure and content remain available", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.locator("#features > [data-reveal]").first().evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    const control = page.locator("#more-features > summary");
    await control.click();
    await expect(page.getByRole("heading", { name: "Pick up where you left off." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The good nights, remembered." })).toBeVisible();
    await control.click();
    await expect(page.getByRole("heading", { name: "Pick up where you left off." })).toBeHidden();
  });
});

test("the hero stays readable in two lines from small phones to desktop", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const heading = await page.getByRole("heading", { level: 1 }).evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    }));
    expect(heading.height, `headline at ${width}px`).toBeLessThanOrEqual(heading.fontSize * 2.15);
    await page.getByRole("tab", { name: "My list", exact: true }).click();
    const height = await page.getByRole("tabpanel", { name: "My list", exact: true }).evaluate((element) => element.clientHeight);
    await page.getByRole("tab", { name: "Movie night", exact: true }).click();
    expect(await page.getByRole("tabpanel", { name: "Movie night", exact: true }).evaluate((element) => element.clientHeight)).toBe(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test("the design preview is off by default even with a saved V2 preference", async ({ page }) => {
  test.skip(process.env.FAMFLIX_UI_PREVIEW === "1", "Run without the preview flag");
  await page.addInitScript(() => sessionStorage.setItem("famflix:ui-version", "v2"));
  await page.goto("/");
  await expect(page.getByRole("group", { name: "Compare designs" })).toHaveCount(0);
  await expect(page.locator("html[data-ui-version]")).toHaveCount(0);
});

test("the design preview switches in place, persists per tab, and leaves the theme alone", async ({ page, context }) => {
  test.skip(process.env.FAMFLIX_UI_PREVIEW !== "1", "Run with FAMFLIX_UI_PREVIEW=1");
  await page.addInitScript(() => localStorage.setItem("famflix:theme", "light"));
  await page.goto("/");
  const mode = page.getByRole("group", { name: "Compare designs" });
  const original = mode.getByRole("button", { name: "Original" });
  const v2 = mode.getByRole("button", { name: "V2" });
  await expect(original).toHaveAttribute("aria-pressed", "true");
  const movieNight = page.getByRole("tab", { name: "Movie night", exact: true });
  await movieNight.click();
  const panel = page.getByRole("tabpanel", { name: "Movie night" });
  const initialUrl = page.url();
  const initialState = await panel.textContent();
  const pageSurface = () => page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
  const originalSurface = await pageSurface();
  await v2.focus();
  await v2.press("Enter");
  await expect(v2).toBeFocused();
  await expect(v2).toHaveAttribute("aria-pressed", "true");
  await expect.poll(pageSurface).not.toBe(originalSurface);
  await expect(page).toHaveURL(initialUrl);
  await expect(panel).toBeVisible();
  expect(await panel.textContent()).toBe(initialState);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload();
  await expect(v2).toHaveAttribute("aria-pressed", "true");
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(otherTab.getByRole("button", { name: "Original", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(v2).toHaveAttribute("aria-pressed", "true");
  await original.click();
  await expect(page.locator("html")).toHaveAttribute("data-ui-version", "original");
});
