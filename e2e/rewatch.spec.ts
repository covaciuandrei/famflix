import { test } from "@playwright/test";

import { addTo, admin, createUser, expect, listCard, openAs, openFamily, signIn, startFamily } from "./helpers";
import { closeAll, leaderboard, makeFamily, rows, startNight, topCard, vote } from "./night-helpers";

/** A day `n` days ago the way a date field takes it (YYYY-MM-DD), in this machine's time zone like the browser's. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-CA");
/** The same day the way the app writes it: dd.mm.yyyy. */
const numeric = (iso: string) => iso.split("-").reverse().join(".");

test("a family logs a title again, then puts it back on To watch", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const bogdan = await createUser("Bogdan");
  const anaPage = await openAs(browser, testInfo.project, ana);
  const bogdanPage = await openAs(browser, testInfo.project, bogdan);
  await startFamily(anaPage, [bogdanPage], "Test family");

  await anaPage.goto("/app/media/movie/438631");
  await addTo(anaPage, anaPage, "Test family");
  await expect(anaPage.getByRole("img", { name: /On Test family/ })).toBeVisible();

  // The first viewing: ten days ago, Ana and Bogdan.
  await openFamily(anaPage, "Test family");
  await anaPage.getByRole("button", { name: "Watched together", exact: true }).click();
  const first = anaPage.getByRole("dialog", { name: /Who watched Dune/ });
  await first.locator('input[type="date"]').fill(daysAgo(10));
  await first.getByRole("checkbox", { name: "Bogdan" }).check();
  await first.getByRole("button", { name: "Save" }).click();
  await expect(first).toBeHidden();

  // Watched once: the menu is there, and there is nothing to count yet.
  await anaPage.getByRole("button", { name: /^Watched together \d+$/ }).click();
  const card = listCard(anaPage, "Dune");
  await expect(card.getByRole("button", { name: "Watch again", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: /^Watched \d+×$/ })).toHaveCount(0);

  // "We watched it again" is the Watched together window, with the same people ticked, for today.
  await card.getByRole("button", { name: "Watch again", exact: true }).click();
  await anaPage
    .getByRole("dialog", { name: "Watch Dune again" })
    .getByRole("button", { name: /We watched it again/ })
    .click();
  const again = anaPage.getByRole("dialog", { name: /Who watched Dune/ });
  await expect(again.getByRole("checkbox", { name: /Ana/ })).toBeChecked();
  await expect(again.getByRole("checkbox", { name: "Bogdan" })).toBeChecked();
  await again.getByRole("button", { name: "Log it" }).click();
  await expect(again).toBeHidden();

  // It counts twice, and the chip lists both days with who was there.
  const chip = card.getByRole("button", { name: "Watched 2×" });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(card.getByText(`${numeric(daysAgo(0))} · You, Bogdan`)).toBeVisible();
  await expect(card.getByText(`${numeric(daysAgo(10))} · You, Bogdan`)).toBeVisible();

  // The first viewing is in the history, for both of them and for this family.
  const { data: history } = await admin
    .from("watch_history")
    .select("user_id, watched_on, group_id")
    .in("user_id", [ana.id, bogdan.id]);
  expect(history?.map((h) => h.watched_on)).toEqual([daysAgo(10), daysAgo(10)]);
  expect(new Set(history?.map((h) => h.user_id))).toEqual(new Set([ana.id, bogdan.id]));
  expect(history?.every((h) => h.group_id !== null)).toBe(true);

  // Put it back on To watch: it leaves Watched together, and waits on To watch with what it was.
  await card.getByRole("button", { name: "Watch again", exact: true }).click();
  await anaPage
    .getByRole("dialog", { name: "Watch Dune again" })
    .getByRole("button", { name: /Put back on To watch/ })
    .click();
  await expect(listCard(anaPage, "Dune")).toHaveCount(0);
  await anaPage.getByRole("button", { name: /^To watch \d+$/ }).click();
  const waiting = listCard(anaPage, "Dune");
  await expect(waiting.getByRole("button", { name: "Watch again · seen 2×" })).toBeVisible();
  await expect(waiting.getByRole("button", { name: "Watch again", exact: true })).toHaveCount(0);
  await expect(waiting.getByRole("button", { name: "Watched together", exact: true })).toBeVisible();

  // The family's feed says so.
  await anaPage.goto("/app/groups");
  await anaPage.getByRole("link", { name: "Test family", exact: true }).click();
  await anaPage.getByRole("link", { name: "Activity" }).click();
  await expect(anaPage.getByText(/You put Dune back on the list to watch again/)).toBeVisible();

  // On Bogdan's My list the title is still watched, and counts twice.
  await bogdanPage.goto("/app/mine");
  await bogdanPage.getByRole("button", { name: /^Watched \d+$/ }).click();
  await expect(listCard(bogdanPage, "Dune").getByRole("button", { name: "Watched 2×" })).toBeVisible();
  await Promise.all([anaPage, bogdanPage].map((page) => page.context().close()));
});

test("My list: log a title again from its page, then put it back on To watch", async ({ page, context }) => {
  const ana = await createUser("Ana");
  await signIn(context, ana);

  await page.goto("/app/media/movie/438631");
  await page.getByRole("button", { name: "Mark as watched" }).click();
  await page.getByRole("dialog", { name: /How was Dune/ }).getByRole("button", { name: "Later" }).click();
  // It was a month ago.
  const { data: item } = await admin.from("list_items").select("id").eq("added_by", ana.id).single();
  await admin.from("list_items").update({ watched_at: `${daysAgo(30)}T12:00:00Z` }).eq("id", item!.id);
  await page.reload();
  await expect(page.getByRole("button", { name: "Watched", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Watched \d+×$/ })).toHaveCount(0);

  // I watched it again yesterday: the day, then the usual "How was it?".
  await page.getByRole("button", { name: "Watch again", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Watch Dune again" })
    .getByRole("button", { name: /I watched it again/ })
    .click();
  const when = page.getByRole("dialog", { name: /When did you watch Dune again/ });
  await when.locator('input[type="date"]').fill(daysAgo(1));
  await when.getByRole("button", { name: "Log it" }).click();
  const ask = page.getByRole("dialog", { name: /How was Dune/ });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Later" }).click();

  // Twice: the chip on its page lists both days.
  await page.getByRole("button", { name: "Watched 2×" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: numeric(daysAgo(1)) })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: numeric(daysAgo(30)) })).toBeVisible();

  // Put it back on To watch: the page and My list both say it was seen twice.
  await page.getByRole("button", { name: "Watch again", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Watch Dune again" })
    .getByRole("button", { name: /Put back on To watch/ })
    .click();
  await expect(page.getByRole("button", { name: "Mark as watched" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch again · seen 2×" })).toBeVisible();

  await page.goto("/app/mine");
  await expect(listCard(page, "Dune").getByRole("button", { name: "Watch again · seen 2×" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Watched 0" })).toBeVisible();
});

test("titles put back on the list to watch again lead the next movie night, and say they were watched before", async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { users, pages } = await makeFamily(browser, testInfo.project, "Rewatch Crew", ["Ana", "Ben"]);
  const [ana] = users;
  const [anaPage] = pages;
  const keys = testInfo.project.name === "desktop";
  const { data: family } = await admin.from("groups").select("id").eq("created_by", ana.id).single();
  const group = family!.id as string;

  // A long To watch list (more than a stack takes from it) with three titles the family has watched before and put
  // back. Without leading the stack they would be in it one time in two or three.
  const base = 100_000_000 + (Date.now() % 10_000_000);
  const titles = [
    ...Array.from({ length: 45 }, (_, i) => `Plain ${i + 1}`),
    ...Array.from({ length: 3 }, (_, i) => `Queued ${i + 1}`),
  ];
  const { data: media } = await admin
    .from("media")
    .insert(titles.map((title, i) => ({ tmdb_id: base + i, media_type: "movie", title, runtime: 100 })))
    .select("id, title");
  await admin.from("list_items").insert(media!.map((m) => ({ group_id: group, added_by: ana.id, media_id: m.id })));
  await admin.from("watch_history").insert(
    media!
      .filter((m) => m.title.startsWith("Queued"))
      .map((m) => ({ user_id: ana.id, media_id: m.id, watched_on: daysAgo(40), group_id: group })),
  );

  await startNight(anaPage, "Rewatch Crew");
  const { data: night } = await admin.from("movie_nights").select("id").eq("started_by", ana.id).single();
  const { data: cards } = await admin
    .from("movie_night_candidates")
    .select("origin, media_id, list_item_id")
    .eq("night_id", night!.id);
  expect(cards).toHaveLength(25);
  expect(cards!.filter((c) => c.origin === "list")).toHaveLength(20);
  const queued = media!.filter((m) => m.title.startsWith("Queued")).map((m) => m.id);
  expect(cards!.filter((c) => queued.includes(c.media_id)).map((c) => c.origin)).toEqual(["list", "list", "list"]);

  // Their cards say so, and only theirs: yes to those, nope to the rest.
  for (let i = 0; i < 25; i++) {
    const label = (await topCard(anaPage).getAttribute("aria-label")) ?? "";
    if (label.startsWith("Queued")) {
      await expect(topCard(anaPage).getByText("Watched before")).toBeVisible();
      await vote(anaPage, "yes", keys);
    } else {
      await expect(topCard(anaPage).getByText("Watched before")).toHaveCount(0);
      await vote(anaPage, "nope", keys);
    }
  }
  await expect(leaderboard(anaPage)).toBeVisible();

  // The leaderboard rows say it too, on those three and no other.
  const queuedRows = rows(anaPage).filter({ hasText: /Queued \d/ });
  await expect(queuedRows).toHaveCount(3);
  await expect(queuedRows.filter({ hasText: "Watched before" })).toHaveCount(3);
  await expect(rows(anaPage).filter({ hasText: "Watched before" })).toHaveCount(3);
  // A card that was never watched before adds nothing to its row: no chip, and no loose "0" either.
  const loose = await rows(anaPage)
    .filter({ hasNotText: "Watched before" })
    .first()
    .locator("div.min-w-0.flex-1")
    .first()
    .evaluate((el) =>
      [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()).map((n) => n.textContent),
    );
  expect(loose).toEqual([]);
  await closeAll(pages);
});
