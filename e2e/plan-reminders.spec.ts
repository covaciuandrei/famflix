import { test, type Page } from "@playwright/test";

import { admin, createUser, expect, openAs, startFamily } from "./helpers";

const MINUTE = 60_000;
const inMinutes = (n: number) => new Date(Date.now() + n * MINUTE).toISOString();
const DOT = /a planned movie night is about to start/;

/** Asks the app to look for what is new now rather than in half a minute (what coming back to the tab does). */
const checkNow = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

test("planned movie nights remind the family from an hour before to three hours after: a dot, a banner and an invite once", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const [ana, bogdan, cara] = await Promise.all(["Ana", "Bogdan", "Cara"].map((name) => createUser(name)));
  const [anaPage, bogdanPage, caraPage] = await Promise.all(
    [ana, bogdan, cara].map((user) => openAs(browser, testInfo.project, user)),
  );
  await startFamily(anaPage, [bogdanPage, caraPage], "Reminder Crew");
  const group = (await admin.from("groups").select("id").eq("created_by", ana.id).single()).data!.id as string;
  const plan = async (note: string, startsAt: string, status = "planned") =>
    (await admin.from("movie_night_plans").insert({ group_id: group, created_by: ana.id, starts_at: startsAt, note, status }).select("id").single()).data!.id as string;
  const move = (id: string, startsAt: string) => admin.from("movie_night_plans").update({ starts_at: startsAt }).eq("id", id);

  // ---- Far off, long gone, or not planned any more: nothing ---------------------------------------------------------------------------------------
  await plan("Next week", inMinutes(7 * 24 * 60));
  await plan("Ninety minutes off", inMinutes(90));
  await plan("Long ago", inMinutes(-4 * 60));
  await plan("Cancelled one", inMinutes(20), "cancelled");
  await bogdanPage.goto("/app/browse");
  await expect(bogdanPage.getByRole("link", { name: "Movie night" }).first()).toBeVisible();
  await expect(bogdanPage.getByRole("link", { name: DOT })).toHaveCount(0);
  await bogdanPage.goto("/app/movie-night");
  await expect(bogdanPage.getByRole("heading", { name: "Planned movie nights" })).toBeVisible();
  await expect(bogdanPage.getByRole("region", { name: "Planned movie nights about to start" })).toHaveCount(0);

  // ---- Half an hour before: the dot and the banner, not yet the invite -------------------------------------------------------------------------------
  const soon = await plan("Soon", inMinutes(30));
  await bogdanPage.goto("/app/browse");
  await expect(bogdanPage.getByRole("link", { name: DOT })).toBeVisible();
  await expect(bogdanPage.getByRole("dialog")).toHaveCount(0);
  await bogdanPage.goto("/app/movie-night");
  const banner = bogdanPage.getByRole("region", { name: "Planned movie nights about to start" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("status")).toHaveCount(1);
  await expect(banner).toContainText(/Reminder Crew: starts in (29|30) minutes/);
  await expect(banner).toContainText("“Soon”");
  // Where the plan is, the dot isn't needed.
  await expect(bogdanPage.getByRole("link", { name: DOT })).toHaveCount(0);
  await banner.getByRole("link", { name: "See the plan" }).click();
  await expect(bogdanPage).toHaveURL(new RegExp(`/app/movie-night\\?who=${group}$`));

  // ---- Someone who can't come is told nothing ---------------------------------------------------------------------------------------------------------
  await admin.from("movie_night_plan_rsvps").insert({ plan_id: soon, user_id: cara.id, answer: "no" });
  await caraPage.goto("/app/browse");
  await expect(caraPage.getByRole("link", { name: "Movie night" }).first()).toBeVisible();
  await expect(caraPage.getByRole("link", { name: DOT })).toHaveCount(0);
  await caraPage.goto("/app/movie-night");
  await expect(caraPage.getByRole("heading", { name: "Planned movie nights" })).toBeVisible();
  await expect(caraPage.getByRole("region", { name: "Planned movie nights about to start" })).toHaveCount(0);

  // ---- Ten minutes before the invite opens by itself, once --------------------------------------------------------------------------------------------
  await bogdanPage.goto("/app/browse");
  await expect(bogdanPage.getByRole("link", { name: DOT })).toBeVisible();
  await move(soon, inMinutes(10));
  await checkNow(bogdanPage);
  const invite = bogdanPage.getByRole("dialog", { name: /Movie night starts in (9|10) minutes/ });
  await expect(invite).toBeVisible();
  await expect(invite).toContainText("Reminder Crew");
  await expect(invite).toContainText("“Soon”");
  await invite.getByRole("link", { name: "Take me there" }).click();
  await expect(bogdanPage).toHaveURL(new RegExp(`/app/movie-night\\?who=${group}$`));
  await expect(invite).toBeHidden();
  // It was shown, so it doesn't come again, not even after a reload or at the next check.
  expect(await bogdanPage.evaluate(() => localStorage.getItem("famflix:plan-invites"))).toContain(soon);
  await bogdanPage.goto("/app/browse");
  await checkNow(bogdanPage);
  await expect(bogdanPage.getByRole("link", { name: DOT })).toBeVisible();
  await bogdanPage.waitForTimeout(2000);
  await expect(bogdanPage.getByRole("dialog")).toHaveCount(0);
  // Cara can't come: no invite for her either.
  await caraPage.goto("/app/browse");
  await checkNow(caraPage);
  await caraPage.waitForTimeout(1500);
  await expect(caraPage.getByRole("dialog")).toHaveCount(0);

  // ---- Once the time has come: it says so, and the answer takes the reminders away ----------------------------------------------------------------------
  await move(soon, inMinutes(-20));
  await bogdanPage.goto("/app/movie-night");
  await expect(banner).toContainText(/Reminder Crew: started (19|20) minutes ago/);
  const card = bogdanPage.getByRole("article").filter({ hasText: "Soon" });
  await expect(card).toContainText("It's time");
  await card.getByRole("button", { name: "Can't", exact: true }).click();
  await expect(card).toContainText("1 can't");
  await expect(banner).toHaveCount(0);
  await bogdanPage.goto("/app/browse");
  await expect(bogdanPage.getByRole("link", { name: "Movie night" }).first()).toBeVisible();
  await expect(bogdanPage.getByRole("link", { name: DOT })).toHaveCount(0);
  // Taking the answer back brings them back.
  await bogdanPage.goto("/app/movie-night");
  await card.getByRole("button", { name: "Can't", exact: true }).click();
  await expect(banner).toBeVisible();

  // ---- Past the three hours, and once the plan is started or cancelled, the reminders stop ---------------------------------------------------------------------
  await move(soon, inMinutes(-181));
  await bogdanPage.reload();
  await expect(bogdanPage.getByRole("heading", { name: "Planned movie nights" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await move(soon, inMinutes(-100));
  await bogdanPage.reload();
  await expect(banner).toBeVisible();
  await admin.from("movie_night_plans").update({ status: "cancelled", ended_at: new Date().toISOString() }).eq("id", soon);
  await checkNow(bogdanPage);
  await expect(banner).toHaveCount(0);

  await Promise.all([anaPage, bogdanPage, caraPage].map((page) => page.context().close()));
});
