import { test, request as playwrightRequest } from "@playwright/test";

import { admin, createUser, expect, openAs } from "./helpers";

test("the route behind a row's next pages is for people signed in, only knows rows we have, sends only what a card shows, and is not for hammering", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "No screen is involved, so once is enough.");
  const ana = await createUser("Ana");
  const page = await openAs(browser, testInfo.project, ana);
  const baseURL = testInfo.project.use.baseURL!;
  const mine = page.context().request;
  const ask = (query: string) => mine.get(`${baseURL}/api/browse/rows?${query}`);

  // A stranger is turned away, and told so rather than sent to the login page.
  const stranger = await playwrightRequest.newContext({ baseURL });
  const turnedAway = await stranger.get("/api/browse/rows?kind=trending&page=2");
  expect(turnedAway.status()).toBe(401);
  expect(await turnedAway.json()).toEqual({ error: "Unauthorized" });
  await stranger.dispose();

  // What is not a row of ours, or not a page, is refused before TMDB is asked anything.
  for (const query of [
    "",
    "page=2",
    "kind=trending",
    "kind=trending&page=0",
    "kind=trending&page=501",
    "kind=trending&page=2.5",
    "kind=trending&page=-1",
    "kind=trending&page=2%0d%0aSet-Cookie:x=y",
    "kind=search&type=movie&page=2",
    "kind=trending&type=person&page=2",
    "kind=popular&page=2",
    "kind=popular&type=anime&page=2",
    "kind=discover&type=tv&sort=popular&genre=horror&page=2",
    "kind=discover&type=movie&sort=popular&genre=drama%26with_keywords%3D1&page=2",
    "kind=discover&type=movie&sort=popular&decade=1850s&page=2",
    // A vote minimum is one of the steps of that row, and nothing else.
    "kind=discover&type=movie&sort=popular&votes=7&page=2",
    "kind=discover&type=movie&sort=popular&votes=1000&page=2",
    "kind=discover&type=movie&sort=top&votes=30&page=2",
    "kind=discover&type=tv&sort=top&votes=50&page=2",
    "kind=discover&type=movie&sort=top&votes=100%26with_keywords%3D1&page=2",
    "kind=discover&type=movie&sort=top&votes=1e3&page=2",
    "kind=discover&type=movie&sort=top&votes=&page=2",
    "kind=like&type=movie&id=603%2F..%2F..%2Fperson%2F1&page=2",
    "kind=like&type=movie&id=0&page=2",
  ]) {
    const refused = await ask(query);
    expect(refused.status(), query).toBe(400);
    expect(await refused.json(), query).toEqual({ error: "That isn't a row of titles." });
  }
  expect((await mine.post(`${baseURL}/api/browse/rows?kind=trending&page=2`)).status()).toBe(405);

  // A row's page is only what a card shows, and the browser may keep it for a while.
  const answered = await ask("kind=popular&type=movie&page=2");
  expect(answered.status()).toBe(200);
  expect(answered.headers()["cache-control"]).toBe("private, max-age=600");
  const body = await answered.json();
  expect(body.hasMore).toBe(true);
  expect(body.items.length).toBeGreaterThan(10);
  for (const item of body.items) {
    expect(Object.keys(item).sort()).toEqual(["mediaType", "posterPath", "title", "tmdbId", "voteAverage", "year"]);
    expect(item.mediaType).toBe("movie");
  }

  // Recommendations leave out titles without a poster, and a filtered row is asked for with its category and decade.
  const like = await (await ask("kind=like&type=movie&id=603&page=2")).json();
  expect(like.items.length).toBeGreaterThan(10);
  for (const item of like.items) expect(item.posterPath).toBeTruthy();
  const filtered = await ask("kind=discover&type=tv&sort=top&genre=kids&decade=2010s&page=1");
  expect(filtered.status()).toBe(200);
  expect((await filtered.json()).items.length).toBeGreaterThan(0);

  // A row asks for the votes its address says: fewer votes leave more titles (best rated documentaries of the nineties had
  // none with a thousand), and without any it is the strictest, which is what every row asked for before.
  const loose = await (await ask("kind=discover&type=movie&sort=top&genre=documentary&decade=1990s&votes=50&page=1")).json();
  const strict = await (await ask("kind=discover&type=movie&sort=top&genre=documentary&decade=1990s&page=1")).json();
  expect(loose.items.length).toBeGreaterThan(10);
  expect(strict.items.length).toBeLessThan(loose.items.length);
  expect(loose.hasMore).toBe(true);

  // TMDB answers no page after the 500th, so the row is told that is the end.
  expect((await (await ask("kind=trending&type=movie&page=500")).json()).hasMore).toBe(false);

  // 120 a minute: with that many already counted (each attempt fills the minute we are in), the next is told to wait.
  let limited = await ask("kind=trending&page=2");
  for (let attempt = 0; attempt < 3 && limited.status() !== 429; attempt++) {
    await Promise.all(
      Array.from({ length: 120 }, () =>
        admin.rpc("hit_rate_limit", { p_user: ana.id, p_action: "row_more", p_max: 1_000_000, p_seconds: 60 }),
      ),
    );
    limited = await ask("kind=trending&page=2");
  }
  expect(limited.status()).toBe(429);
  expect(await limited.json()).toEqual({ error: expect.stringMatching(/too often/i) });
  // Someone else is not held back by it.
  const bogdan = await openAs(browser, testInfo.project, await createUser("Bogdan"));
  expect((await bogdan.context().request.get(`${baseURL}/api/browse/rows?kind=trending&page=2`)).status()).toBe(200);
  await Promise.all([page, bogdan].map((p) => p.context().close()));
});
