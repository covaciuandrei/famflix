/**
 * Asking the server for a page of a row (`/api/browse/rows`), from the browser. Every ask gives up after a while instead of
 * waiting for ever, and one that failed for a reason that may pass (the connection, the server, TMDB) is tried once more
 * before the person is told. Client-safe, so the unit tests run it with a `fetch` of their own.
 */
import type { CardItem } from "@/lib/browse-rows";

export const UNAVAILABLE = "Couldn't load more titles right now.";
export const OFFLINE = "You seem to be offline. Check your connection.";
export const TOO_SLOW = "Loading more titles is taking too long.";
export const SIGNED_OUT = "Your session has ended. Reload the page to sign in again.";

/** How long one ask may take before it is given up on. */
export const TIMEOUT_MS = 12_000;
/** The wait before the second try. */
export const RETRY_DELAY_MS = 1_000;
/** How many times a page is asked for before the person is told it can't be loaded. */
export const ATTEMPTS = 2;

/** A page that could not be loaded: what to tell the person, and whether asking again at once may well work. */
export class RowLoadError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "RowLoadError";
    this.retryable = retryable;
  }
}

export interface RowPage {
  items: CardItem[];
  hasMore: boolean;
}

export interface FetchOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
  attempts?: number;
  /** For the tests; the browser's own `fetch` otherwise. */
  fetchImpl?: typeof fetch;
}

const isPage = (data: unknown): data is RowPage =>
  typeof data === "object" &&
  data !== null &&
  Array.isArray((data as RowPage).items) &&
  typeof (data as RowPage).hasMore === "boolean";

const cancelled = () => new DOMException("The request was cancelled.", "AbortError");

/** Waits, unless `signal` says to stop. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelled());
    const done = () => {
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

/** One ask. Rejects with a RowLoadError, or (when `signal` is what ended it) with whatever the browser reports. */
async function askOnce(url: string, signal: AbortSignal, timeoutMs: number, fetchImpl: typeof fetch): Promise<RowPage> {
  const own = new AbortController();
  const stop = () => own.abort();
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    own.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: own.signal });
    const data: unknown = await response.json().catch(() => null);
    // Reading the answer is part of the wait: it can be cut off too.
    if (own.signal.aborted) throw cancelled();
    if (response.status === 401) throw new RowLoadError(SIGNED_OUT, false);
    if (!response.ok) {
      const said = (data as { error?: unknown } | null)?.error;
      // A server that had trouble (or TMDB) may be fine a second later; one that refuses (too often, not a row) won't be.
      throw new RowLoadError(typeof said === "string" ? said : UNAVAILABLE, response.status >= 500);
    }
    if (!isPage(data)) throw new RowLoadError(UNAVAILABLE, false);
    return data;
  } catch (error) {
    if (error instanceof RowLoadError) throw error;
    if (signal.aborted) throw error;
    if (slow) throw new RowLoadError(TOO_SLOW, true);
    // `fetch` rejects when it can't reach the server at all.
    throw new RowLoadError(OFFLINE, true);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

/**
 * One page of a row, from the server. `query` is the row's source as address parameters (rowSourceToParams). Resolves
 * with the page, or rejects with a RowLoadError (or the browser's abort error when `signal` ended it).
 */
export async function fetchRowPage(
  query: string,
  page: number,
  signal: AbortSignal,
  { timeoutMs = TIMEOUT_MS, retryDelayMs = RETRY_DELAY_MS, attempts = ATTEMPTS, fetchImpl = fetch }: FetchOptions = {},
): Promise<RowPage> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await askOnce(`/api/browse/rows?${query}&page=${page}`, signal, timeoutMs, fetchImpl);
    } catch (error) {
      if (signal.aborted || attempt >= attempts || !(error instanceof RowLoadError && error.retryable)) throw error;
      await pause(retryDelayMs, signal);
    }
  }
}
