"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { addSwipedToMyList, removeSwipedFromMyList } from "@/app/app/movie-night/actions";
import { SwipeDeck } from "@/components/movie-night/swipe-deck";
import type { DeckCard, Vote } from "@/lib/movie-night";

/** A stack of your own: ✓ and ♥ put the title on My list, the rest add nothing. */

/** Swipes are sent in small batches this long after the last one, so a quick undo costs nothing. */
const SEND_DELAY_MS = 2500;
const RETRY_DELAY_MS = 6000;
const MAX_RETRIES = 3;
/** At the end, a rate limit (30 adds a minute) is waited out this long between tries, a few times. */
const FINISH_RETRY_MS = 15_000;
const FINISH_ATTEMPTS = 4;
const BATCH = 10;
const STORAGE_PREFIX = "famflix:movie-night:solo:";

interface Saved {
  votes: Record<string, Vote>;
  /** Cards whose title is on My list because of this stack, with the list item (to take it back after an undo). */
  sent: Record<string, string>;
}

function load(key: string): Saved {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + key) ?? "null");
    if (parsed && typeof parsed === "object") {
      return { votes: parsed.votes ?? {}, sent: parsed.sent ?? {} };
    }
  } catch {}
  return { votes: {}, sent: {} };
}

function store(key: string, saved: Saved | null) {
  try {
    if (saved) sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(saved));
    else sessionStorage.removeItem(STORAGE_PREFIX + key);
  } catch {}
}

const wants = (vote: Vote | undefined) => vote === "yes" || vote === "love";

export function SoloDeck({ cards, storageKey }: { cards: DeckCard[]; storageKey: string }) {
  const router = useRouter();
  // Read once, when the stack opens (it only renders in the browser, see solo-deck-loader).
  const [initial] = useState(() => load(storageKey));
  const votes = useRef<Record<string, Vote>>(initial.votes);
  const sent = useRef<Record<string, string>>(initial.sent);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<number | null>(null);
  const failures = useRef(0);
  const finishing = useRef(false);
  const [picked, setPicked] = useState(() => Object.values(initial.votes).filter(wants).length);
  const [problem, setProblem] = useState<string | null>(null);

  // The first card that hasn't been swiped, for picking up after a refresh.
  const firstUnvoted = cards.findIndex((card) => !(card.id in initial.votes));
  const resumeAt = firstUnvoted === -1 ? cards.length : firstUnvoted;

  function persist() {
    store(storageKey, { votes: votes.current, sent: sent.current });
  }

  /** Brings My list in line with the swipes: adds what was swiped right, takes back what was undone. */
  async function sync(): Promise<boolean> {
    for (;;) {
      const undone = Object.entries(sent.current).filter(([key]) => !wants(votes.current[key])).slice(0, BATCH);
      if (undone.length > 0) {
        const res = await removeSwipedFromMyList(undone.map(([, itemId]) => itemId));
        if (res.error) {
          setProblem(res.error);
          return false;
        }
        for (const [key] of undone) delete sent.current[key];
        persist();
        continue;
      }
      const todo = cards.filter((card) => wants(votes.current[card.id]) && !(card.id in sent.current)).slice(0, BATCH);
      if (todo.length === 0) {
        setProblem(null);
        return true;
      }
      const res = await addSwipedToMyList(
        todo.map((card) => ({ tmdbId: card.tmdbId, mediaType: card.mediaType, love: votes.current[card.id] === "love" })),
      );
      for (const added of res.added) sent.current[added.key] = added.itemId;
      persist();
      if (res.error) {
        setProblem(res.error);
        return false;
      }
    }
  }

  /** Runs one sync at a time. */
  function run(): Promise<boolean> {
    chain.current = chain.current.then(sync, sync);
    return chain.current;
  }

  function schedule(delay = SEND_DELAY_MS) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      timer.current = null;
      if (await run()) {
        failures.current = 0;
      } else if (++failures.current < MAX_RETRIES) {
        schedule(RETRY_DELAY_MS);
      }
    }, delay);
  }

  // Whatever is still waiting is sent when the tab is hidden or the stack is left.
  const sendNow = useEffectEvent(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    void run();
  });
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") sendNow();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      sendNow();
    };
  }, []);

  async function finish() {
    if (finishing.current) return;
    finishing.current = true;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    for (let attempt = 1; !(await run()); attempt++) {
      if (attempt >= FINISH_ATTEMPTS) {
        // The problem stays on screen; the done note's button tries again.
        finishing.current = false;
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, FINISH_RETRY_MS));
    }
    // Everything picked on this stack, including what went in before a refresh.
    const added = Object.keys(sent.current).filter((key) => wants(votes.current[key])).length;
    store(storageKey, null);
    router.push(`/app/movie-night/list?list=mine&added=${added}`);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <SwipeDeck
        cards={cards}
        startAt={resumeAt}
        lovesLeft={null}
        note={`${picked} picked`}
        onVote={(card, vote) => {
          votes.current[card.id] = vote;
          persist();
          setPicked(Object.values(votes.current).filter(wants).length);
          schedule();
        }}
        onUndo={(card) => {
          delete votes.current[card.id];
          persist();
          setPicked(Object.values(votes.current).filter(wants).length);
          schedule();
        }}
        onFinish={finish}
        finishText="That was the last one. Putting your picks on My list…"
        finishButton="Show my list"
      />
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem} Your picks are kept, and we&apos;ll try again.
        </p>
      )}
    </div>
  );
}
