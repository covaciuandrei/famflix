import { test, type Locator, type Page } from "@playwright/test";

import { addTo, admin, createUser, expect, signIn } from "./helpers";

const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });
const top = async (nav: Locator) => (await nav.boundingBox())!.y;

const rowOf = (page: Page, title: string) => page.locator("section", { has: heading(page, title) });
/** What a row asks the server for when it is scrolled near its end. */
const MORE_TITLES = /\/api\/browse\/rows\?/;
/** The address of every title in a row, in order (a card's poster links to the title's page). */
async function addressesIn(list: Locator) {
  const hrefs = await list
    .getByRole("listitem")
    .evaluateAll((items) => items.map((item) => item.querySelector("a")?.getAttribute("href") ?? null));
  return hrefs.filter((href): href is string => href !== null);
}
/** Takes a row to its end, as a swipe or the wheel would. */
const scrollToEnd = (list: Locator) => list.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));

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

test("a row of titles scrolls with arrows for a mouse, which has no scrollbar to drag, and a phone swipes it", async ({ page, context }, testInfo) => {
  await signIn(context, await createUser("Tess"));
  // A real row has pages without end; this one has none after its first, so there is a last card to reach.
  await page.route(MORE_TITLES, (route) => route.fulfill({ json: { items: [], hasMore: false } }));
  await page.goto("/app/browse");

  const title = "Trending this week";
  const row = rowOf(page, title);
  const list = row.getByRole("list").first();
  const cards = list.getByRole("listitem");
  const next = row.getByRole("button", { name: `Next in ${title}` });
  const back = row.getByRole("button", { name: `Previous in ${title}` });
  const scrolled = () => list.evaluate((el) => el.scrollLeft);

  // More cards than fit, so there is something to scroll to.
  await expect(cards.first()).toBeVisible();
  expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  if (testInfo.project.name !== "desktop") {
    // Swiping moves a phone along a row; the arrows would only cover the cards.
    const arrows = row.getByRole("button", { name: /^(Next|Previous) in /, includeHidden: true });
    await expect(arrows).toHaveCount(2);
    await expect(arrows.first()).toHaveCSS("display", "none");
    await expect(arrows.last()).toHaveCSS("display", "none");
    return;
  }

  // A click scrolls smoothly: it is done once the row has moved and then stopped.
  const press = async (arrow: Locator) => {
    const from = await scrolled();
    await arrow.click();
    let before = from;
    await expect
      .poll(async () => {
        const now = await scrolled();
        const done = now !== from && now === before;
        before = now;
        return done;
      })
      .toBe(true);
  };
  const inView = async (card: Locator) => {
    const [at, view] = [(await card.boundingBox())!, (await list.boundingBox())!];
    return at.x >= view.x - 1 && at.x + at.width <= view.x + view.width + 1;
  };

  // At the start there is only a way forward.
  await expect(next).toBeVisible();
  await expect(back).toBeHidden();
  expect(await scrolled()).toBe(0);
  expect(await inView(cards.last())).toBe(false);

  // Next moves along, and then there is a way back too.
  await press(next);
  expect(await scrolled()).toBeGreaterThan(300);
  expect(await inView(cards.first())).toBe(false);
  await expect(back).toBeVisible();
  await expect(next).toBeVisible();

  // Going on reaches the last card, where Next is gone.
  for (let clicks = 0; clicks < 10 && !(await inView(cards.last())); clicks++) await press(next);
  expect(await inView(cards.last())).toBe(true);
  await expect(next).toBeHidden();
  await expect(back).toBeVisible();

  // And Previous goes all the way back to the first card, where it is gone.
  for (let clicks = 0; clicks < 10 && (await scrolled()) > 1; clicks++) await press(back);
  expect(await scrolled()).toBe(0);
  expect(await inView(cards.first())).toBe(true);
  await expect(back).toBeHidden();
  await expect(next).toBeVisible();
});

test("a row goes on loading titles as it is scrolled to its end, so it has no last card", async ({ page, context }, testInfo) => {
  await signIn(context, await createUser("Tess"));
  await page.goto("/app/browse");

  const title = "Popular movies";
  const row = rowOf(page, title);
  const list = row.getByRole("list").first();
  const next = row.getByRole("button", { name: `Next in ${title}` });
  await expect(list.getByRole("listitem").first()).toBeVisible();

  let known = (await addressesIn(list)).length;
  expect(known).toBeGreaterThanOrEqual(15);

  // Each time the row is taken to its end, with the arrow on a computer and by swiping on a phone, the next page arrives.
  for (let round = 1; round <= 3; round++) {
    await expect
      .poll(
        async () => {
          if (testInfo.project.name === "desktop") await next.click({ timeout: 5_000 });
          else await scrollToEnd(list);
          return (await addressesIn(list)).length;
        },
        { timeout: 40_000, message: `more titles after ${round} page(s) of scrolling` },
      )
      .toBeGreaterThan(known);
    const titles = await addressesIn(list);
    expect(new Set(titles).size, "no title is shown twice").toBe(titles.length);
    known = titles.length;
  }

  // A first page and three more, and the way on is still there.
  expect(known).toBeGreaterThanOrEqual(60);
  if (testInfo.project.name === "desktop") await expect(next).toBeVisible();
  // All those cards stay inside the row: the page itself doesn't scroll sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("while a page is on its way the row says so and holds the place with blank cards", async ({ page, context }) => {
  await signIn(context, await createUser("Tess"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(MORE_TITLES, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/app/browse");

  const row = rowOf(page, "Popular movies");
  const list = row.getByRole("list").first();
  const blanks = list.locator(":scope > li[aria-hidden='true']");
  await expect(list.getByRole("listitem").first()).toBeVisible();
  const known = (await addressesIn(list)).length;
  await expect(blanks).toHaveCount(0);

  await scrollToEnd(list);
  await expect(row.getByRole("status")).toHaveText("Loading more titles…");
  await expect(blanks).toHaveCount(4);

  release();
  await expect(blanks).toHaveCount(0);
  await expect(row.getByRole("status")).toHaveText("");
  await expect.poll(async () => (await addressesIn(list)).length).toBeGreaterThan(known);
});

test("a page that can't be loaded is said so, isn't asked for again by itself, and loads on a second try", async ({ page, context }) => {
  await signIn(context, await createUser("Tess"));
  let asked = 0;
  let broken = true;
  await page.route(MORE_TITLES, (route) => {
    asked++;
    return broken
      ? route.fulfill({ status: 429, json: { error: "You're doing that too often. Try again in a minute." } })
      : route.continue();
  });
  await page.goto("/app/browse");

  const row = rowOf(page, "Popular movies");
  const list = row.getByRole("list").first();
  const retry = row.getByRole("button", { name: "Try again" });
  await expect(list.getByRole("listitem").first()).toBeVisible();
  const known = (await addressesIn(list)).length;

  // What the server said, where the next cards would be, and to anyone who can't see the row.
  await scrollToEnd(list);
  await expect(retry).toBeVisible();
  await expect(list.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Try again" }) })).toContainText(
    "You're doing that too often. Try again in a minute.",
  );
  await expect(row.getByRole("status")).toHaveText("You're doing that too often. Try again in a minute.");
  expect(asked).toBe(1);

  // Scrolling about doesn't ask again: only the button does.
  await list.evaluate((el) => el.scrollBy({ left: -400 }));
  await scrollToEnd(list);
  await page.waitForTimeout(500);
  expect(asked).toBe(1);
  expect((await addressesIn(list)).length).toBe(known);

  broken = false;
  await retry.click();
  await expect(retry).toBeHidden();
  await expect.poll(async () => (await addressesIn(list)).length).toBeGreaterThan(known);
  await expect(row.getByRole("status")).toHaveText("");
  // The try again, and then the row goes on loading ahead of the person, as any row they have scrolled does.
  expect(asked).toBeGreaterThanOrEqual(2);
});

test("a row that is only looked at asks for nothing, and one that is scrolled loads ahead of where they are", async ({ page, context }, testInfo) => {
  await signIn(context, await createUser("Tess"));
  const asked: string[] = [];
  page.on("request", (request) => {
    if (MORE_TITLES.test(request.url())) asked.push(request.url());
  });
  await page.goto("/app/browse");

  const title = "Popular movies";
  const row = rowOf(page, title);
  const list = row.getByRole("list").first();
  await expect(list.getByRole("listitem").first()).toBeVisible();
  const own = (await addressesIn(list)).length;
  expect(own).toBeGreaterThanOrEqual(15);

  // Nobody has touched it: a row that is only looked at doesn't load more than it shows.
  await page.waitForTimeout(1_500);
  expect(asked).toEqual([]);

  // One step along the row, a swipe or a click, and it loads two pages: forty cards beyond what a person has in view, so a
  // quick run of clicks doesn't get to the end of what is there while the next page is on its way. TMDB's lists are live:
  // a title can move from the end of one page to the start of the next between two requests, and is shown once, so two
  // pages can bring a card or two fewer than forty. One page would only ever bring twenty.
  if (testInfo.project.name === "desktop") await row.getByRole("button", { name: `Next in ${title}` }).click();
  else await list.evaluate((el) => el.scrollBy({ left: 300 }));
  await expect.poll(async () => (await addressesIn(list)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(own + 30);
  expect(asked.length).toBeGreaterThanOrEqual(2);
  const titles = await addressesIn(list);
  expect(new Set(titles).size, "no title is shown twice").toBe(titles.length);

  // And it is not asking for more than it needs: with all of that ahead, it waits for the person to come closer.
  const settled = asked.length;
  await page.waitForTimeout(1_500);
  expect(asked.length).toBe(settled);
});

test("a page the server had trouble with is asked for again by itself, and only said so if the second try fails too", async ({ page, context }) => {
  await signIn(context, await createUser("Tess"));
  // Each row's pages are told apart by what they ask for, so one row's loading doesn't count for the other's.
  const MOVIE_PAGES = /\/api\/browse\/rows\?kind=popular&type=movie&/;
  const SERIES_PAGES = /\/api\/browse\/rows\?kind=popular&type=tv&/;
  let moviePages = 0;
  await page.route(MOVIE_PAGES, (route) => {
    moviePages++;
    return moviePages === 1
      ? route.fulfill({ status: 502, json: { error: "Couldn't load more titles right now." } })
      : route.continue();
  });
  let seriesPages = 0;
  await page.route(SERIES_PAGES, (route) => {
    seriesPages++;
    return route.fulfill({ status: 503, json: { error: "TMDB is busy." } });
  });
  await page.goto("/app/browse");

  const row = rowOf(page, "Popular movies");
  const list = row.getByRole("list").first();
  const retry = row.getByRole("button", { name: "Try again" });
  await expect(list.getByRole("listitem").first()).toBeVisible();
  const known = (await addressesIn(list)).length;

  // The first try fails and the second works: the person sees the cards arrive, and nothing about it.
  await scrollToEnd(list);
  await expect.poll(async () => (await addressesIn(list)).length, { timeout: 30_000 }).toBeGreaterThan(known);
  await expect(retry).toHaveCount(0);
  await expect(row.getByRole("status")).toHaveText("");
  expect(moviePages).toBeGreaterThanOrEqual(2);

  // A row whose pages fail twice says so, and then waits to be asked.
  const series = rowOf(page, "Popular series");
  const seriesList = series.getByRole("list").first();
  const seriesRetry = series.getByRole("button", { name: "Try again" });
  await expect(seriesList.getByRole("listitem").first()).toBeVisible();
  await scrollToEnd(seriesList);
  await expect(seriesRetry).toBeVisible({ timeout: 30_000 });
  await expect(seriesList.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Try again" }) })).toContainText(
    "TMDB is busy.",
  );
  expect(seriesPages).toBe(2);
  await scrollToEnd(seriesList);
  await page.waitForTimeout(500);
  expect(seriesPages).toBe(2);
});

test("a narrow filter doesn't end after a few titles: its rows ask for fewer votes until they have enough, and stay strict where there are plenty", async ({ page, context }) => {
  test.setTimeout(120_000);
  await signIn(context, await createUser("Tess"));
  const asked: URLSearchParams[] = [];
  page.on("request", (request) => {
    if (MORE_TITLES.test(request.url())) asked.push(new URL(request.url()).searchParams);
  });
  // What the rows of one filter asked for (a request from the page before it, still on its way, is not theirs).
  const votesOf = (sort: string, genre: string) =>
    asked.find((query) => query.get("sort") === sort && query.get("genre") === genre)?.get("votes");

  // Documentaries of the nineties: nothing has a thousand votes, so their best rated row used to be missing altogether, and
  // the popular one ended after a page. Now each asks for as few votes as it takes to have a good many titles.
  await page.goto("/app/browse?type=movie&genre=documentary&decade=1990s");
  const best = rowOf(page, "Top rated documentary movies from the 1990s");
  const popular = rowOf(page, "Popular documentary movies from the 1990s");
  await expect(best).toBeVisible();
  await expect(popular).toBeVisible();
  const bestList = best.getByRole("list").first();
  const popularList = popular.getByRole("list").first();
  await expect(bestList.getByRole("listitem").first()).toBeVisible();
  const bestFirst = (await addressesIn(bestList)).length;
  expect(bestFirst).toBeGreaterThanOrEqual(15);

  await scrollToEnd(bestList);
  await scrollToEnd(popularList);
  await expect.poll(async () => (await addressesIn(bestList)).length, { timeout: 30_000 }).toBeGreaterThan(bestFirst);
  await expect.poll(() => votesOf("popular", "documentary"), { timeout: 30_000 }).toBeDefined();
  expect(votesOf("top", "documentary")).toBe("50");
  expect(votesOf("popular", "documentary")).toBe("10");
  const sent = asked.find((query) => query.get("sort") === "top" && query.get("genre") === "documentary")!;
  expect([sent.get("kind"), sent.get("type"), sent.get("genre"), sent.get("decade")]).toEqual(["discover", "movie", "documentary", "1990s"]);

  // Action movies of the 2010s have plenty: the strictest minimums are kept, so the best rated row is still the well known ones.
  asked.length = 0;
  await page.goto("/app/browse?type=movie&genre=action&decade=2010s");
  const strictBest = rowOf(page, "Top rated action movies from the 2010s").getByRole("list").first();
  const strictPopular = rowOf(page, "Popular action movies from the 2010s").getByRole("list").first();
  await expect(strictBest.getByRole("listitem").first()).toBeVisible();
  await scrollToEnd(strictBest);
  await scrollToEnd(strictPopular);
  await expect
    .poll(() => votesOf("popular", "action") !== undefined && votesOf("top", "action") !== undefined, { timeout: 30_000 })
    .toBe(true);
  expect(votesOf("top", "action")).toBe("1000");
  expect(votesOf("popular", "action")).toBe("100");
});

test("the titles a page adds come after the row's own, none twice, and show your lists like the rest", async ({ page, context }) => {
  await signIn(context, await createUser("Tess"));
  await page.goto("/app/browse");

  const row = rowOf(page, "Popular movies");
  const list = row.getByRole("list").first();
  const cards = list.getByRole("listitem");
  await expect(cards.first()).toBeVisible();
  const own = await addressesIn(list);

  // A page that repeats the row's first title and has one it doesn't have yet (a classic, whatever is popular today).
  const repeated = Number(own[0].split("/").pop());
  const newId = [603, 680, 550, 13, 155].find((id) => !own.includes(`/app/media/movie/${id}`))!;
  await page.route(MORE_TITLES, (route) =>
    route.fulfill({
      json: {
        items: [
          { tmdbId: repeated, mediaType: "movie", title: "Seen already", year: 2001, posterPath: null, voteAverage: 7 },
          { tmdbId: newId, mediaType: "movie", title: "Just loaded", year: 1999, posterPath: null, voteAverage: 8.1 },
        ],
        hasMore: false,
      },
    }),
  );
  await scrollToEnd(list);
  const loaded = cards.filter({ hasText: "Just loaded" });
  await expect(loaded).toBeVisible();
  expect(await addressesIn(list)).toEqual([...own, `/app/media/movie/${newId}`]);
  await expect(cards.last()).toContainText("Just loaded");
  await expect(loaded).toContainText("Movie · 1999");
  await expect(loaded).toContainText("8.1");
  await expect(cards.filter({ hasText: "Seen already" })).toHaveCount(0);

  // It can be added like any card, and then shows it is on My list, as the cards the page itself rendered do.
  await addTo(page, loaded, "My list");
  await expect(loaded.getByRole("img", { name: /On My list/ })).toBeVisible();
  await expect(loaded.getByText("Added")).toBeVisible();
  // The row stays where it was, with what it had loaded.
  expect(await addressesIn(list)).toEqual([...own, `/app/media/movie/${newId}`]);
});
