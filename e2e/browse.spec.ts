import { test, type Locator, type Page } from "@playwright/test";

import { admin, createUser, expect, signIn } from "./helpers";

const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });
const top = async (nav: Locator) => (await nav.boundingBox())!.y;

test("Browse is filtered by type, first among the filters, and the type goes along with the others", async ({ page, context }) => {
  await signIn(context, await createUser("Tess"));
  await page.goto("/app/browse");

  const type = page.getByRole("navigation", { name: "Type" });
  const released = page.getByRole("navigation", { name: "Release date" });
  const categories = page.getByRole("navigation", { name: "Categories" });

  // The type is chosen before the release date and the category, and starts on both kinds of title.
  await expect(type.getByRole("link")).toHaveText(["All", "Movies", "Series"]);
  expect(await top(type)).toBeLessThan(await top(released));
  expect(await top(released)).toBeLessThan(await top(categories));
  await expect(type.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  await expect(heading(page, "Popular movies")).toBeVisible();
  await expect(heading(page, "Popular series")).toBeVisible();
  await expect(categories.getByRole("link", { name: "Horror" })).toBeVisible();

  // Series: only rows of series, and the categories series have (Kids, but no Horror).
  await type.getByRole("link", { name: "Series" }).click();
  await expect(page).toHaveURL(/\/app\/browse\?type=tv$/);
  await expect(type.getByRole("link", { name: "Series" })).toHaveAttribute("aria-current", "page");
  await expect(heading(page, "Trending series this week")).toBeVisible();
  await expect(heading(page, "Popular series")).toBeVisible();
  await expect(heading(page, "Top rated series")).toBeVisible();
  await expect(page.getByRole("heading", { name: /movies/i })).toHaveCount(0);
  await expect(categories.getByRole("link", { name: "Kids" })).toBeVisible();
  await expect(categories.getByRole("link", { name: "Horror" })).toHaveCount(0);

  // The release date keeps the type, and so does a category after that.
  await released.getByRole("link", { name: "2010s" }).click();
  await expect(page).toHaveURL(/\/app\/browse\?type=tv&decade=2010s$/);
  await expect(heading(page, "Popular series from the 2010s")).toBeVisible();
  await expect(heading(page, "Top rated series from the 2010s")).toBeVisible();
  await expect(page.getByRole("heading", { name: /movies/i })).toHaveCount(0);
  await categories.getByRole("link", { name: "Drama", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/browse\?type=tv&genre=drama&decade=2010s$/);
  await expect(heading(page, "Popular drama series from the 2010s")).toBeVisible();

  // Movies: the release date and the category stay, since movies have both, and there is no Kids.
  await type.getByRole("link", { name: "Movies" }).click();
  await expect(page).toHaveURL(/\/app\/browse\?type=movie&genre=drama&decade=2010s$/);
  await expect(heading(page, "Popular drama movies from the 2010s")).toBeVisible();
  await expect(page.getByRole("heading", { name: /series/i })).toHaveCount(0);
  await expect(categories.getByRole("link", { name: "Kids" })).toHaveCount(0);

  // A category only one type has is left behind when the type changes, instead of leading to an empty page.
  await page.goto("/app/browse?type=movie&genre=horror");
  await expect(heading(page, "Popular horror movies")).toBeVisible();
  await expect(categories.getByRole("link", { name: "Horror" })).toHaveAttribute("aria-current", "page");
  await type.getByRole("link", { name: "Series" }).click();
  await expect(page).toHaveURL(/\/app\/browse\?type=tv$/);
  await expect(heading(page, "Popular series")).toBeVisible();

  // So is one in an address made by hand, and All takes the type off again.
  await page.goto("/app/browse?type=tv&genre=horror");
  await expect(categories.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  await expect(heading(page, "Popular series")).toBeVisible();
  await type.getByRole("link", { name: "All" }).click();
  await expect(page).toHaveURL(/\/app\/browse$/);
  await expect(heading(page, "Trending this week")).toBeVisible();
});

test("the rows of what you liked follow the type", async ({ page, context }) => {
  const tess = await createUser("Tess");
  await signIn(context, tess);

  // A movie and a series she gave a 9, which is what a "Because you liked" row is made from.
  for (const [tmdbId, mediaType, title] of [
    [603, "movie", "The Matrix"],
    [87108, "tv", "Chernobyl"],
  ] as const) {
    const { data: media } = await admin
      .from("media")
      .upsert({ tmdb_id: tmdbId, media_type: mediaType, title }, { onConflict: "tmdb_id,media_type" })
      .select("id")
      .single();
    const { data: item } = await admin.from("list_items").insert({ added_by: tess.id, media_id: media!.id }).select("id").single();
    await admin.from("ratings").insert({ list_item_id: item!.id, user_id: tess.id, score: 9 });
  }

  const type = page.getByRole("navigation", { name: "Type" });
  await page.goto("/app/browse");
  await expect(heading(page, "Because you liked The Matrix")).toBeVisible();
  await expect(heading(page, "Because you liked Chernobyl")).toBeVisible();

  await type.getByRole("link", { name: "Movies" }).click();
  await expect(heading(page, "Because you liked The Matrix")).toBeVisible();
  await expect(heading(page, "Because you liked Chernobyl")).toHaveCount(0);

  await type.getByRole("link", { name: "Series" }).click();
  await expect(heading(page, "Because you liked Chernobyl")).toBeVisible();
  await expect(heading(page, "Because you liked The Matrix")).toHaveCount(0);
});
