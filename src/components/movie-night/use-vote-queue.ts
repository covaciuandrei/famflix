"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import { castVotes } from "@/app/app/movie-night/actions";
import type { Vote } from "@/lib/movie-night";

/** Votes go out this long after the last swipe (or at 5 at once), and always when someone finishes or leaves. */
const SEND_DELAY_MS = 1500;
const SEND_AT = 5;
const BATCH = 50;
const RETRY_MS = [2000, 4000, 8000, 15000];

// What the server says when a night, or this stack, is no longer taking votes: retrying can't help.
const OVER = /already (finished|picked|out)|was cancelled|ended after|not available/i;

/**
 * A person's votes in a night: shown at once, sent to the server in small batches in the background (so a swipe is
 * never a wait), and kept if the connection drops. `problem` says when the server stopped taking them.
 */
export function useVoteQueue(stackId: string | null, initial: Record<string, Vote>) {
  const [votes, setVotes] = useState<Record<string, Vote>>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useRef(new Map<string, Vote | null>());
  const timer = useRef<number | null>(null);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const retries = useRef(0);

  const send = useCallback((): Promise<boolean> => {
    if (!stackId) return Promise.resolve(true);
    chain.current = chain.current.then(async () => {
      while (pending.current.size > 0) {
        const batch = [...pending.current].slice(0, BATCH);
        let error: string | undefined;
        try {
          error = (await castVotes(stackId, batch.map(([candidateId, vote]) => ({ candidateId, vote })))).error;
        } catch {
          error = "You seem to be offline.";
        }
        if (error) {
          if (OVER.test(error)) pending.current.clear();
          setProblem(error);
          return false;
        }
        for (const [id, vote] of batch) {
          if (pending.current.get(id) === vote) pending.current.delete(id);
        }
        setProblem(null);
      }
      return true;
    });
    return chain.current;
  }, [stackId]);

  const schedule = useCallback(
    (delay: number) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      const run = async () => {
        timer.current = null;
        if (await send()) {
          retries.current = 0;
        } else if (pending.current.size > 0) {
          // Still something to send: try again a little later.
          timer.current = window.setTimeout(run, RETRY_MS[Math.min(retries.current++, RETRY_MS.length - 1)]);
        }
      };
      timer.current = window.setTimeout(run, delay);
    },
    [send],
  );

  /** A vote, or null to take it back. */
  const setVote = useCallback(
    (candidateId: string, vote: Vote | null) => {
      setVotes((current) => {
        const next = { ...current };
        if (vote === null) delete next[candidateId];
        else next[candidateId] = vote;
        return next;
      });
      pending.current.set(candidateId, vote);
      schedule(pending.current.size >= SEND_AT ? 0 : SEND_DELAY_MS);
    },
    [schedule],
  );

  /** Sends whatever is waiting now; true when nothing is left. */
  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    return send();
  }, [send]);

  // Don't lose votes when the tab is hidden or the room is left.
  const sendNow = useEffectEvent(() => {
    void flush();
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

  return { votes, setVote, flush, problem };
}
