"use client";

import { Layers } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { addSwipedToMyList, removeSwipedFromMyList } from "@/app/app/browse/discover/actions";
import { SwipeDeck } from "@/components/movie-night/swipe-deck";
import { buttonVariants } from "@/components/ui/button";
import type { DiscoverCard, Vote } from "@/lib/movie-night";

/**
 * A stack of your own (Discover): ✓ and ♥ put the title on My list the moment you swipe, the rest add nothing. Every
 * swipe is saved right away, so by the last card there is nothing left to wait for.
 */

/** A swipe that couldn't be saved is tried again this long after, a few times. */
const RETRY_DELAY_MS = 4000;
const MAX_RETRIES = 3;
/** Most titles sent in one go (more than one only when saving falls behind the swiping). */
const BATCH = 10;
const STORAGE_PREFIX = "famflix:discover:";

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

export function DiscoverDeck({ cards, storageKey }: { cards: DiscoverCard[]; storageKey: string }) {
  const router = useRouter();
  // Read once, when the stack opens (it only renders in the browser, see discover-deck-loader).
  const [initial] = useState(() => load(storageKey));
  const votes = useRef<Record<string, Vote>>(initial.votes);
  const sent = useRef<Record<string, string>>(initial.sent);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const retry = useRef<number | null>(null);
  const failures = useRef(0);
  const finishing = useRef(false);
  const [picked, setPicked] = useState(() => Object.values(initial.votes).filter(wants).length);
  const [problem, setProblem] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

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
        todo.map((card) => ({ key: card.id, mediaId: card.mediaId, love: votes.current[card.id] === "love" })),
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

  function stopRetrying() {
    if (retry.current !== null) {
      window.clearTimeout(retry.current);
      retry.current = null;
    }
  }

  /** Saves what is new right away. If that fails, it is tried again a few times. */
  function save() {
    stopRetrying();
    void run().then((ok) => {
      if (ok) {
        failures.current = 0;
      } else if (++failures.current < MAX_RETRIES) {
        retry.current = window.setTimeout(save, RETRY_DELAY_MS);
      }
    });
  }

  // Whatever didn't get through is sent when the tab is hidden or the stack is left.
  const sendNow = useEffectEvent(() => {
    stopRetrying();
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

  // So that "Show my list" opens right away.
  useEffect(() => {
    router.prefetch("/app/mine");
  }, [router]);

  async function finish() {
    if (finishing.current) return;
    finishing.current = true;
    setLeaving(true);
    stopRetrying();
    if (!(await run())) {
      // The problem stays on screen; the done note's button tries again.
      finishing.current = false;
      setLeaving(false);
      return;
    }
    // Everything picked on this stack, including what went in before a refresh.
    const added = Object.keys(sent.current).filter((key) => wants(votes.current[key])).length;
    store(storageKey, null);
    // My list, with a note on what went in; with nothing picked there is nothing to show, so back to Browse.
    router.push(added > 0 ? `/app/mine?added=${added}` : "/app/browse");
  }

  const changePicked = () => setPicked(Object.values(votes.current).filter(wants).length);

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
          changePicked();
          save();
        }}
        onUndo={(card) => {
          delete votes.current[card.id];
          persist();
          changePicked();
          save();
        }}
        onFinish={finish}
        autoFinish={false}
        finishText={
          leaving
            ? "Saving your last picks…"
            : picked === 0
              ? "That was the last one. Nothing picked this time."
              : `That was the last one. ${picked} ${picked === 1 ? "title is" : "titles are"} on My list.`
        }
        finishButton={picked > 0 ? "Show my list" : "Back to Browse"}
        finishExtra={
          <Link href="/app/browse/discover" className={buttonVariants({ variant: "ghost" })}>
            <Layers className="size-4" />
            Discover more
          </Link>
        }
      />
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem} Your picks are kept, and we&apos;ll try again.
        </p>
      )}
    </div>
  );
}
