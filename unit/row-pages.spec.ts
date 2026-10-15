import { expect, test } from "@playwright/test";

import {
  ATTEMPTS,
  fetchRowPage,
  OFFLINE,
  RowLoadError,
  SIGNED_OUT,
  TOO_SLOW,
  UNAVAILABLE,
  type FetchOptions,
} from "../src/lib/row-pages";

const PAGE = { items: [{ tmdbId: 1, mediaType: "movie", title: "Dune", year: 2021, posterPath: null, voteAverage: 8 }], hasMore: true };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A `fetch` that answers with what `answer` makes of each ask (the first is call 1), and keeps what it was asked. */
function server(answer: (call: number, signal: AbortSignal) => Promise<Response> | Response) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push(String(url));
    return answer(asked.length, init!.signal!);
  }) as typeof fetch;
  return { asked, fetchImpl };
}

/** Quick enough for a test: the waits are tens of milliseconds, not seconds. */
const quick = (fetchImpl: typeof fetch, over: FetchOptions = {}): FetchOptions => ({
  fetchImpl,
  timeoutMs: 40,
  retryDelayMs: 5,
  ...over,
});

const ask = (options: FetchOptions, signal = new AbortController().signal) =>
  fetchRowPage("kind=popular&type=movie", 3, signal, options);

/** What asking ends with: the page, or the error it was refused with. */
async function outcome(options: FetchOptions, signal?: AbortSignal) {
  try {
    return { page: await ask(options, signal) };
  } catch (error) {
    return { error };
  }
}

test("a page is asked for by the row's address and its number, and comes back as the server sent it", async () => {
  const tmdb = server(() => json(PAGE));
  expect(await ask(quick(tmdb.fetchImpl))).toEqual(PAGE);
  expect(tmdb.asked).toEqual(["/api/browse/rows?kind=popular&type=movie&page=3"]);
});

test("a server that turns the ask down is not asked again, and what it said is what the person is told", async () => {
  for (const [status, body, told] of [
    [429, { error: "You're doing that too often. Try again in a minute." }, "You're doing that too often. Try again in a minute."],
    [400, { error: "That isn't a row of titles." }, "That isn't a row of titles."],
    [403, "<html>no</html>", UNAVAILABLE],
    [404, {}, UNAVAILABLE],
  ] as const) {
    const tmdb = server(() => json(body, status));
    const { error } = await outcome(quick(tmdb.fetchImpl));
    expect(error, String(status)).toBeInstanceOf(RowLoadError);
    expect((error as RowLoadError).message, String(status)).toBe(told);
    expect((error as RowLoadError).retryable, String(status)).toBe(false);
    expect(tmdb.asked, `${status} is asked once`).toHaveLength(1);
  }
});

test("someone whose session has ended is told so, in words of ours, and not asked again", async () => {
  const tmdb = server(() => json({ error: "Unauthorized" }, 401));
  const { error } = await outcome(quick(tmdb.fetchImpl));
  expect((error as RowLoadError).message).toBe(SIGNED_OUT);
  expect((error as RowLoadError).retryable).toBe(false);
  expect(tmdb.asked).toHaveLength(1);
});

test("a server that had trouble is asked once more, and the person never hears of it if the second try works", async () => {
  for (const status of [500, 502, 503, 504]) {
    const tmdb = server((call) => (call === 1 ? json({ error: "Couldn't load more titles right now." }, status) : json(PAGE)));
    expect(await ask(quick(tmdb.fetchImpl)), String(status)).toEqual(PAGE);
    expect(tmdb.asked, String(status)).toHaveLength(2);
  }
});

test("a server that has trouble twice is given up on, with what it said", async () => {
  const tmdb = server(() => json({ error: "TMDB is down." }, 502));
  const { error } = await outcome(quick(tmdb.fetchImpl));
  expect((error as RowLoadError).message).toBe("TMDB is down.");
  expect((error as RowLoadError).retryable).toBe(true);
  expect(tmdb.asked).toHaveLength(ATTEMPTS);
  expect(ATTEMPTS).toBe(2);
});

test("a connection that fails is tried again, and then said to be offline", async () => {
  const flaky = server((call) => {
    if (call === 1) throw new TypeError("Failed to fetch");
    return json(PAGE);
  });
  expect(await ask(quick(flaky.fetchImpl))).toEqual(PAGE);
  expect(flaky.asked).toHaveLength(2);

  const down = server(() => {
    throw new TypeError("Failed to fetch");
  });
  const { error } = await outcome(quick(down.fetchImpl));
  expect((error as RowLoadError).message).toBe(OFFLINE);
  expect(down.asked).toHaveLength(2);
});

test("an ask that is never answered is given up on after a while, and tried once more", async () => {
  // Never answered: it only ends when it is told to stop, as the browser's fetch does.
  const silent = (_call: number, signal: AbortSignal) =>
    new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  const stuck = server(silent);
  const started = Date.now();
  const { error } = await outcome(quick(stuck.fetchImpl));
  expect((error as RowLoadError).message).toBe(TOO_SLOW);
  expect((error as RowLoadError).retryable).toBe(true);
  expect(stuck.asked).toHaveLength(2);
  // Two waits of 40ms and a pause of 5ms between them, not a hang.
  expect(Date.now() - started).toBeLessThan(2_000);

  // A second try that is answered is all it takes.
  const slowOnce = server((call, signal) => (call === 1 ? silent(call, signal) : Promise.resolve(json(PAGE))));
  expect(await ask(quick(slowOnce.fetchImpl))).toEqual(PAGE);
  expect(slowOnce.asked).toHaveLength(2);
});

test("an answer that starts but is never finished is given up on as well", async () => {
  const halfway = (_call: number, signal: AbortSignal) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
    } as unknown as Response);
  const tmdb = server(halfway);
  const { error } = await outcome(quick(tmdb.fetchImpl));
  expect((error as RowLoadError).message).toBe(TOO_SLOW);
  expect(tmdb.asked).toHaveLength(2);
});

test("what is not a page is refused, and not asked about again", async () => {
  for (const body of [{}, { items: "none", hasMore: true }, { items: [] }, { items: [], hasMore: "yes" }, null, [], "page"]) {
    const tmdb = server(() => json(body));
    const { error } = await outcome(quick(tmdb.fetchImpl));
    expect((error as RowLoadError).message, JSON.stringify(body)).toBe(UNAVAILABLE);
    expect(tmdb.asked, JSON.stringify(body)).toHaveLength(1);
  }
  // Not JSON at all.
  const html = server(() => new Response("<html>oops</html>", { status: 200 }));
  expect(((await outcome(quick(html.fetchImpl))).error as RowLoadError).message).toBe(UNAVAILABLE);
  expect(html.asked).toHaveLength(1);
  // An empty last page is a page.
  const last = server(() => json({ items: [], hasMore: false }));
  expect(await ask(quick(last.fetchImpl))).toEqual({ items: [], hasMore: false });
});

test("leaving the page ends an ask with the browser's own abort, which is no failure to tell anyone about", async () => {
  const silent = (_call: number, signal: AbortSignal) =>
    new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));

  const leaving = new AbortController();
  const tmdb = server(silent);
  const pending = outcome(quick(tmdb.fetchImpl, { timeoutMs: 5_000 }), leaving.signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  leaving.abort();
  const { error } = await pending;
  expect(error).not.toBeInstanceOf(RowLoadError);
  expect((error as Error).name).toBe("AbortError");
  expect(tmdb.asked).toHaveLength(1);

  // Already left before it began: nothing is asked, or it is stopped at once.
  const gone = new AbortController();
  gone.abort();
  const never = server(() => json(PAGE));
  const early = await outcome(quick(never.fetchImpl), gone.signal);
  expect(early.page).toBeUndefined();
  expect(early.error).toBeDefined();
});

test("leaving the page while waiting to try again stops it there, with no second ask", async () => {
  const leaving = new AbortController();
  const tmdb = server(() => json({ error: "TMDB is down." }, 502));
  const pending = outcome(quick(tmdb.fetchImpl, { retryDelayMs: 5_000 }), leaving.signal);
  await new Promise((resolve) => setTimeout(resolve, 30));
  leaving.abort();
  const started = Date.now();
  const { error } = await pending;
  expect((error as Error).name).toBe("AbortError");
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(tmdb.asked).toHaveLength(1);
});

test("a row can be asked more times than the default, or only once", async () => {
  const always = server(() => json({ error: "down" }, 503));
  await outcome(quick(always.fetchImpl, { attempts: 4 }));
  expect(always.asked).toHaveLength(4);
  const once = server(() => json({ error: "down" }, 503));
  await outcome(quick(once.fetchImpl, { attempts: 1 }));
  expect(once.asked).toHaveLength(1);
});
