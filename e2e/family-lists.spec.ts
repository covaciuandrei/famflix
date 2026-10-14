import { test } from "@playwright/test";

import { addTo, admin, createUser, expect, listCard, openAs, startFamily, type TestUser } from "./helpers";

const THE_MATRIX = 603;
const DUNE = 438631;

/** Puts a title on someone's My list the way the app would have left it, with a score and a note when given. */
async function seed(
  user: TestUser,
  tmdbId: number,
  title: string,
  opts: { watchedAt?: string; score?: number; note?: string } = {},
) {
  const { data: media, error } = await admin
    .from("media")
    .upsert({ tmdb_id: tmdbId, media_type: "movie", title, release_year: 1999 }, { onConflict: "tmdb_id,media_type" })
    .select("id")
    .single();
  if (error) throw error;
  const { data: item, error: itemError } = await admin
    .from("list_items")
    .insert({ added_by: user.id, media_id: media!.id, status: opts.watchedAt ? "watched" : "want", watched_at: opts.watchedAt ?? null })
    .select("id")
    .single();
  if (itemError) throw itemError;
  if (opts.score !== undefined || opts.note) {
    const { error: ratingError } = await admin
      .from("ratings")
      .insert({ list_item_id: item!.id, user_id: user.id, score: opts.score ?? null, comment: opts.note ?? null });
    if (ratingError) throw ratingError;
  }
}

/** The id of the family whose page the person is on. */
const familyId = (url: string) => new URL(url).pathname.split("/")[3];

test("the people in a family see each other's list, with no notes, and can take titles from it", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const bogdan = await createUser("Bogdan");
  const cleo = await createUser("Cleo");
  await seed(ana, THE_MATRIX, "The Matrix", { watchedAt: "2024-03-01T12:00:00Z", score: 9, note: "ANA-SECRET-NOTE" });
  await seed(ana, DUNE, "Dune");
  const [anaPage, bogdanPage, cleoPage] = await Promise.all([ana, bogdan, cleo].map((u) => openAs(browser, testInfo.project, u)));
  await startFamily(anaPage, [bogdanPage], "Cinema");
  const group = familyId(bogdanPage.url());

  // A family has a Members tab: everyone, with a way to their list (and to your own).
  await bogdanPage.getByRole("link", { name: "Members" }).click();
  const members = bogdanPage.getByRole("region", { name: "Members" });
  await expect(members.getByRole("link", { name: "Ana's list" })).toBeVisible();
  await expect(members.getByRole("link", { name: "My list" })).toBeVisible();
  await expect(members.getByText("Owner")).toBeVisible();

  // Her list: what she still wants to watch, and what she has watched with the day and her score, never her note.
  await members.getByRole("link", { name: "Ana's list" }).click();
  await expect(bogdanPage.getByRole("heading", { name: "Ana's list" })).toBeVisible();
  const tabs = bogdanPage.getByRole("navigation", { name: "Their list" });
  await expect(tabs.getByRole("link", { name: /To watch/ })).toContainText("1");
  await expect(tabs.getByRole("link", { name: /Watched/ })).toContainText("1");
  const dune = bogdanPage.getByRole("listitem").filter({ hasText: "Dune" });
  await expect(dune).toBeVisible();
  await expect(bogdanPage.getByRole("listitem").filter({ hasText: "The Matrix" })).toHaveCount(0);
  await tabs.getByRole("link", { name: /Watched/ }).click();
  await expect(bogdanPage).toHaveURL(/\?tab=watched$/);
  const matrix = bogdanPage.getByRole("listitem").filter({ hasText: "The Matrix" });
  await expect(matrix).toContainText("Watched Mar 1, 2024");
  await expect(matrix).toContainText("9");
  await expect(matrix).toContainText("their score");
  expect(await bogdanPage.content()).not.toContain("ANA-SECRET-NOTE");

  // He can take a title from it onto his own lists, and then it shows that he has it.
  await tabs.getByRole("link", { name: /To watch/ }).click();
  await addTo(bogdanPage, dune, "My list");
  await expect(dune.getByRole("img", { name: /On My list/ })).toBeVisible();
  await bogdanPage.goto("/app/mine");
  await expect(listCard(bogdanPage, "Dune")).toBeVisible();

  // Her own list is on My list, and someone outside the family finds nothing.
  await bogdanPage.goto(`/app/family/${group}/members/${ana.id}`);
  await expect(bogdanPage.getByRole("heading", { name: "Ana's list" })).toBeVisible();
  await cleoPage.goto(`/app/family/${group}/members/${ana.id}`);
  await expect(cleoPage.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
  await expect(cleoPage.getByText("Dune")).toHaveCount(0);
  await anaPage.goto(`/app/family/${group}/members/${ana.id}`);
  await expect(anaPage).toHaveURL(/\/app\/mine$/);

  await Promise.all([anaPage, bogdanPage, cleoPage].map((page) => page.context().close()));
});

test("a person can switch their list off for their family, and on again, and My list says who can see it", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const bogdan = await createUser("Bogdan");
  await seed(ana, DUNE, "Dune");
  const [anaPage, bogdanPage] = await Promise.all([ana, bogdan].map((u) => openAs(browser, testInfo.project, u)));
  await startFamily(anaPage, [bogdanPage], "Cinema");
  const group = familyId(bogdanPage.url());
  const seeing = () => bogdanPage.getByRole("region", { name: "Members" });

  // On by default, and My list says so.
  await anaPage.goto("/app/mine");
  await expect(anaPage.getByText("The people in your families can see it")).toBeVisible();
  await anaPage.goto("/app/settings");
  const share = anaPage.getByRole("switch", { name: "Let my families see my list" });
  await expect(share).toHaveAttribute("aria-checked", "true");

  // Off: saved, My list says it is only hers, and her family finds the list closed.
  await share.click();
  await expect(share).toHaveAttribute("aria-checked", "false");
  await anaPage.reload();
  await expect(anaPage.getByRole("switch", { name: "Let my families see my list" })).toHaveAttribute("aria-checked", "false");
  await anaPage.goto("/app/mine");
  await expect(anaPage.getByText("only you can see this")).toBeVisible();
  await expect(listCard(anaPage, "Dune")).toBeVisible();
  await bogdanPage.goto(`/app/family/${group}?view=members`);
  await expect(seeing().getByText("Not sharing their list")).toBeVisible();
  await expect(seeing().getByRole("link", { name: "Ana's list" })).toHaveCount(0);
  await bogdanPage.goto(`/app/family/${group}/members/${ana.id}`);
  await expect(bogdanPage.getByText("Ana isn't sharing their list")).toBeVisible();
  await expect(bogdanPage.getByText("Dune")).toHaveCount(0);

  // On again.
  await anaPage.goto("/app/settings");
  await anaPage.getByRole("switch", { name: "Let my families see my list" }).click();
  await expect(anaPage.getByRole("switch", { name: "Let my families see my list" })).toHaveAttribute("aria-checked", "true");
  await anaPage.reload();
  await expect(anaPage.getByRole("switch", { name: "Let my families see my list" })).toHaveAttribute("aria-checked", "true");
  await bogdanPage.goto(`/app/family/${group}?view=members`);
  await expect(seeing().getByRole("link", { name: "Ana's list" })).toBeVisible();
  await bogdanPage.goto(`/app/family/${group}/members/${ana.id}`);
  await expect(bogdanPage.getByRole("listitem").filter({ hasText: "Dune" })).toBeVisible();

  await Promise.all([anaPage, bogdanPage].map((page) => page.context().close()));
});

test("from My list a title goes onto a family's list, for people who are in a family", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const bogdan = await createUser("Bogdan");
  const cleo = await createUser("Cleo");
  await seed(ana, DUNE, "Dune");
  await seed(ana, THE_MATRIX, "The Matrix");
  await seed(cleo, DUNE, "Dune");
  const [anaPage, bogdanPage, cleoPage] = await Promise.all([ana, bogdan, cleo].map((u) => openAs(browser, testInfo.project, u)));

  // Nobody has a family yet, so there is nowhere to add it to.
  await anaPage.goto("/app/mine");
  await expect(listCard(anaPage, "Dune")).toBeVisible();
  await expect(anaPage.getByRole("button", { name: /Add to family/ })).toHaveCount(0);

  // One family: the button adds it straight away, and says so.
  await startFamily(anaPage, [bogdanPage], "Cinema");
  const cinema = familyId(bogdanPage.url());
  await anaPage.goto("/app/mine");
  const dune = listCard(anaPage, "Dune");
  await dune.getByRole("button", { name: "Add to family" }).click();
  await expect(dune.getByRole("button", { name: "Added" })).toBeDisabled();
  await expect(dune.getByRole("button", { name: "Remove from Cinema" })).toHaveCount(0);
  await bogdanPage.goto(`/app/family/${cinema}`);
  await expect(listCard(bogdanPage, "Dune")).toBeVisible();
  // It is on My list still, and a title on a family list is not added there twice.
  await anaPage.reload();
  await expect(listCard(anaPage, "Dune").getByRole("button", { name: "Added" })).toBeVisible();

  // Someone who is in no family has no such button.
  await cleoPage.goto("/app/mine");
  await expect(listCard(cleoPage, "Dune")).toBeVisible();
  await expect(cleoPage.getByRole("button", { name: /Add to family/ })).toHaveCount(0);

  // Two families: a list to pick from, with the one that has it already marked.
  await anaPage.goto("/app/groups");
  await anaPage.getByPlaceholder("Family name").fill("Weekend");
  await anaPage.getByRole("button", { name: "Create family" }).click();
  await expect(anaPage.getByRole("heading", { name: "Weekend" })).toBeVisible();
  const weekend = familyId(anaPage.url());
  await anaPage.goto("/app/mine");
  const matrix = listCard(anaPage, "The Matrix");
  await matrix.getByRole("button", { name: "Add to family…" }).click();
  const menu = anaPage.locator("[popover]:popover-open, dialog[open]");
  await expect(menu.getByRole("button", { name: "Cinema" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Weekend" })).toBeVisible();
  await menu.getByRole("button", { name: "Weekend" }).click();
  // (Saved on the server first: leaving the page now would cancel it.)
  await expect
    .poll(async () => (await admin.from("list_items").select("id").eq("group_id", weekend)).data?.length)
    .toBe(1);
  await anaPage.goto(`/app/family/${weekend}`);
  await expect(listCard(anaPage, "The Matrix")).toBeVisible();
  await anaPage.goto("/app/mine");
  await listCard(anaPage, "The Matrix").getByRole("button", { name: "Add to family…" }).click();
  await expect(menu.getByRole("button", { name: "Weekend" })).toContainText("Added");
  await expect(menu.getByRole("button", { name: "Weekend" })).toBeDisabled();
  await expect(menu.getByRole("button", { name: "Cinema" })).not.toContainText("Added");

  await Promise.all([anaPage, bogdanPage, cleoPage].map((page) => page.context().close()));
});
