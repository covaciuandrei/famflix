import { test, type Page } from "@playwright/test";

import { admin, createUser, expect, openAs, startFamily } from "./helpers";
import { acceptConfirms, TMDB } from "./night-helpers";
import { noSideways } from "./stats-page";

const ANA_ZONE = "Europe/Bucharest";
const BOGDAN_ZONE = "America/New_York";

/** A moment as someone in a time zone sees it, the way the page writes it ("Wed, Oct 28, 8:00 PM"). */
const seen = (instant: Date, timeZone: string, kind: "full" | "day" = "full") =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(kind === "full" ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone,
  }).format(instant);

/** A matcher for text that may have a narrow no-break space in it where a plain space is written here. */
const text = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s/g, "\\s"));

/** A plan's card, found by the moment it is for. */
const planCard = (page: Page, when: string) => page.getByRole("article", { name: text(when) });

/** What to type in a date and time field for a given day (as the person's own clock) and time. */
const typed = (daysAhead: number, time: string) =>
  `${new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10)}T${time}`;

async function openPlanDialog(page: Page) {
  await page.goto("/app/movie-night");
  await page.getByRole("button", { name: "Plan a movie night" }).click();
  const dialog = page.getByRole("dialog", { name: "Plan a movie night" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("plan a movie night: everyone sees it in their own time and answers, and any member can start it or cancel it", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const [ana, bogdan] = await Promise.all([createUser("Ana"), createUser("Bogdan")]);
  const anaPage = await openAs(browser, testInfo.project, ana, { timezoneId: ANA_ZONE });
  const bogdanPage = await openAs(browser, testInfo.project, bogdan, { timezoneId: BOGDAN_ZONE });
  acceptConfirms(anaPage, bogdanPage);
  await startFamily(anaPage, [bogdanPage], "Plan Crew");
  const group = (await admin.from("groups").select("id").eq("created_by", ana.id).single()).data!.id as string;
  const plans = async () =>
    (await admin.from("movie_night_plans").select("id, starts_at, note, genres, status, night_id, created_by").eq("group_id", group).order("starts_at")).data!;

  // ---- Ana plans a night: a time on her clock, a note and a mood ---------------------------------------------------------------------------------
  const dialog = await openPlanDialog(anaPage);
  await dialog.getByLabel(/^When/).fill(typed(10, "20:00"));
  await dialog.getByLabel(/^Note/).fill("Pizza and popcorn");
  await dialog.getByRole("button", { name: "Laugh" }).click();
  await dialog.getByRole("button", { name: "Plan the movie night" }).click();
  await expect(dialog).toBeHidden();

  const [first] = await plans();
  expect(first).toMatchObject({ note: "Pizza and popcorn", genres: ["comedy"], status: "planned", created_by: ana.id });
  const instant = new Date(first.starts_at);
  // It is 20:00 in Ana's zone, and the same moment in Bogdan's.
  expect(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ANA_ZONE }).format(instant)).toBe("20:00");
  const anaSees = seen(instant, ANA_ZONE);
  const bogdanSees = seen(instant, BOGDAN_ZONE);
  expect(bogdanSees).not.toBe(anaSees);

  const anaCard = planCard(anaPage, anaSees);
  await expect(anaCard).toBeVisible();
  await expect(anaCard.locator("time")).toHaveText(text(anaSees));
  await expect(anaCard).toContainText("Planned");
  await expect(anaCard).toContainText("Pizza and popcorn");
  await expect(anaCard).toContainText("Comedy · planned by Ana");
  await expect(anaCard).toContainText("1 going");
  await expect(anaCard.getByRole("button", { name: "Going", exact: true })).toHaveAttribute("aria-pressed", "true");
  await noSideways(anaPage);

  // ---- Bogdan sees it on his own clock, and answers ------------------------------------------------------------------------------------------
  await bogdanPage.goto("/app/movie-night");
  const bogdanCard = planCard(bogdanPage, bogdanSees);
  await expect(bogdanCard).toBeVisible();
  await expect(bogdanCard.locator("time")).toHaveText(text(bogdanSees));
  await expect(bogdanCard).toContainText("1 going");
  await expect(bogdanCard.getByRole("button", { name: "Maybe", exact: true })).toHaveAttribute("aria-pressed", "false");
  await bogdanCard.getByRole("button", { name: "Maybe", exact: true }).click();
  await expect(bogdanCard).toContainText("1 going · 1 maybe");
  await expect(bogdanCard.getByRole("button", { name: "Maybe", exact: true })).toHaveAttribute("aria-pressed", "true");
  // The same answer again takes it back; another changes it.
  await bogdanCard.getByRole("button", { name: "Maybe", exact: true }).click();
  await expect(bogdanCard).toContainText("1 going");
  await expect(bogdanCard).not.toContainText("maybe");
  await bogdanCard.getByRole("button", { name: "Can't", exact: true }).click();
  await expect(bogdanCard).toContainText("1 going · 1 can't");

  // Ana sees how it stands, and who answered what.
  await anaPage.reload();
  await expect(anaCard).toContainText("1 going · 1 can't");
  await anaCard.getByText("Who is coming").click();
  await expect(anaCard.getByRole("definition").filter({ hasText: "Bogdan" })).toBeVisible();
  await expect(anaCard.getByRole("definition").filter({ hasText: "You" })).toBeVisible();

  // The feed says so, on each one's own calendar.
  await bogdanPage.goto(`/app/family/${group}?view=activity`);
  await expect(bogdanPage.getByText(/Ana planned a movie night for/)).toContainText(text(seen(instant, BOGDAN_ZONE, "day")));

  // ---- Anyone can cancel a plan: Bogdan plans one and Ana cancels it -------------------------------------------------------------------------------
  const second = await openPlanDialog(bogdanPage);
  await second.getByLabel(/^When/).fill(typed(12, "19:00"));
  await second.getByRole("button", { name: "Plan the movie night" }).click();
  await expect(second).toBeHidden();
  const [, secondPlan] = await plans();
  expect(secondPlan).toMatchObject({ note: null, genres: [], status: "planned", created_by: bogdan.id });
  const secondAt = new Date(secondPlan.starts_at);
  expect(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: BOGDAN_ZONE }).format(secondAt)).toBe("19:00");

  await anaPage.goto("/app/movie-night");
  const anaSecond = planCard(anaPage, seen(secondAt, ANA_ZONE));
  await expect(anaSecond).toContainText("planned by Bogdan");
  await expect(anaSecond).toContainText("1 going");
  await anaSecond.getByRole("button", { name: "Cancel plan" }).click();
  await expect(anaSecond).toContainText("Cancelled");
  await expect(anaSecond.getByRole("button")).toHaveCount(0);
  expect((await plans())[1].status).toBe("cancelled");
  // The cancelled plan is last in the list, after the one still planned.
  const order = await anaPage.getByRole("article").allInnerTexts();
  expect(order[0]).toContain("Pizza and popcorn");
  expect(order[1]).toContain("Cancelled");
  await bogdanPage.goto(`/app/family/${group}?view=activity`);
  await expect(bogdanPage.getByText(/Ana cancelled the movie night planned for/)).toContainText(text(seen(secondAt, BOGDAN_ZONE, "day")));
  await bogdanPage.goto("/app/movie-night");
  await expect(planCard(bogdanPage, seen(secondAt, BOGDAN_ZONE))).toContainText("Cancelled");

  // ---- A plan whose time has come says so ------------------------------------------------------------------------------------------------------
  const late = new Date(Date.now() - 5 * 60_000);
  await admin.from("movie_night_plans").insert({ group_id: group, created_by: ana.id, starts_at: late.toISOString(), note: "Running late" });
  await anaPage.reload();
  const lateCard = anaPage.getByRole("article").filter({ hasText: "Running late" });
  await expect(lateCard).toContainText("It's time");
  await expect(lateCard.getByRole("button", { name: "Start now" })).toBeVisible();
  await admin.from("movie_night_plans").delete().eq("note", "Running late").eq("group_id", group);

  // ---- The dialog says what is wrong with a time ------------------------------------------------------------------------------------------------------
  await anaPage.reload();
  const problems = await openPlanDialog(anaPage);
  const when = problems.getByLabel(/^When/);
  const plan = problems.getByRole("button", { name: "Plan the movie night" });
  await when.fill(typed(-1, "20:00"));
  await plan.click();
  await expect(problems.getByRole("alert")).toHaveText("Pick a time in the future.");
  await when.fill(typed(800, "20:00"));
  await plan.click();
  await expect(problems.getByRole("alert")).toHaveText("Plan a movie night within the next year.");
  await when.fill("");
  await plan.click();
  await expect(problems.getByRole("alert")).toHaveText("Pick a day and a time.");
  expect(await plans()).toHaveLength(2);
  await problems.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(problems).toBeHidden();

  // ---- Start the night from the plan: it has the plan's mood and the plan is its own ------------------------------------------------------------------
  await anaPage.reload();
  await anaCard.getByRole("button", { name: "Start now" }).click();
  await expect(anaPage).toHaveURL(/\/app\/movie-night\/[0-9a-f-]{36}$/, { timeout: TMDB });
  const nightId = anaPage.url().split("/").pop()!;
  const { data: night } = await admin.from("movie_nights").select("genres, started_by, status").eq("id", nightId).single();
  expect(night).toMatchObject({ genres: ["comedy"], started_by: ana.id, status: "open" });
  expect((await plans())[0]).toMatchObject({ status: "started", night_id: nightId });
  // It leaves the list of plans: the night is in its place. A plan that was started can't be answered.
  await bogdanPage.goto("/app/movie-night");
  await expect(planCard(bogdanPage, bogdanSees)).toHaveCount(0);
  await expect(bogdanPage.getByRole("region", { name: "Movie night in progress" })).toBeVisible();
  await admin.from("movie_nights").update({ status: "cancelled", ended_at: new Date().toISOString() }).eq("id", nightId);

  // ---- A family has at most 5 planned -----------------------------------------------------------------------------------------------------------------
  const base = Date.now() + 20 * 86_400_000;
  await admin.from("movie_night_plans").insert(
    Array.from({ length: 5 }, (_, i) => ({ group_id: group, created_by: bogdan.id, starts_at: new Date(base + i * 86_400_000).toISOString(), note: `Filler ${i + 1}` })),
  );
  await anaPage.goto("/app/movie-night");
  await expect(anaPage.getByRole("button", { name: "Plan a movie night" })).toBeDisabled();
  await expect(anaPage.getByText(/has 5 planned, the most there can be/)).toBeVisible();
  // Cancelling one makes room.
  await anaPage.getByRole("article").filter({ hasText: "Filler 5" }).getByRole("button", { name: "Cancel plan" }).click();
  await expect(anaPage.getByRole("button", { name: "Plan a movie night" })).toBeEnabled();
  await noSideways(anaPage);

  await Promise.all([anaPage, bogdanPage].map((page) => page.context().close()));
});
