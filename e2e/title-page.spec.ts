import { test } from "@playwright/test";

import { addTo, createUser, expect, firstCard, signIn } from "./helpers";

test("a film's page shows its age rating, director, cast, collection and similar titles", async ({ page, context }) => {
  await signIn(context, await createUser("Ana"));
  await page.goto("/app/media/movie/438631");
  await expect(page.getByRole("heading", { name: "Dune", level: 1 })).toBeVisible();

  // Next to the facts: the American age rating, and who directed it.
  await expect(page.getByText("Age rating PG-13")).toBeVisible();
  await expect(page.getByText("Directed by Denis Villeneuve")).toBeVisible();

  // The top-billed cast, with photos from TMDB and the part each plays: at most twelve.
  const cast = page.getByRole("region", { name: "Cast" });
  await expect(cast.getByText("Timothée Chalamet")).toBeVisible();
  await expect(cast.getByText("Paul Atreides")).toBeVisible();
  const people = await cast.getByRole("listitem").count();
  expect(people).toBeGreaterThan(3);
  expect(people).toBeLessThanOrEqual(12);
  await expect(cast.locator("img").first()).toHaveAttribute("src", /image\.tmdb\.org\/t\/p\/w185\//);

  // The other films of its collection (not Dune itself), and similar titles that can be added from here.
  const collection = page.locator("section", { has: page.getByRole("heading", { name: "Other films in the Dune Collection" }) });
  await expect(collection.getByRole("link", { name: "Dune: Part Two", exact: true }).first()).toBeVisible();
  await expect(collection.getByRole("link", { name: "Dune", exact: true })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "More like this", exact: true })).toBeVisible();
  const similar = firstCard(page, "More like this");
  await addTo(page, similar, "My list");
  await expect(similar.getByRole("img", { name: /On My list/ })).toBeVisible();
});

test("a series' page names its creator, rating and cast, and has no collection", async ({ page, context }) => {
  await signIn(context, await createUser("Ana"));
  await page.goto("/app/media/tv/87108");
  await expect(page.getByRole("heading", { name: "Chernobyl", level: 1 })).toBeVisible();
  await expect(page.getByText("Created by Craig Mazin")).toBeVisible();
  await expect(page.getByText("Age rating TV-MA")).toBeVisible();
  await expect(page.getByRole("region", { name: "Cast" }).getByText("Jared Harris")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Other films in/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "More like this", exact: true })).toBeVisible();
});
