"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { NightState } from "@/lib/movie-night";

/**
 * The room's copy of a night. It starts from what the server rendered and then keeps itself up to date: poll every
 * `pollMs` while the tab is visible (null stops polling), and `refresh()` after something changes. The light
 * answer has no cards, so when a stack has been added the cards are fetched too.
 */
export function useNightState(initial: NightState, pollMs: number | null) {
  const nightId = initial.night.id;
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [gone, setGone] = useState(false);
  const stackCount = useRef(initial.stacks.length);
  // Answers can arrive out of order: only one to a newer request than the last one used is applied.
  const issued = useRef(0);
  const applied = useRef(0);
  const current = useRef(state);
  useEffect(() => {
    current.current = state;
  }, [state]);

  const refresh = useCallback(
    async (wantFull = false): Promise<NightState | null> => {
      let full = wantFull;
      for (let attempt = 0; attempt < 2; attempt++) {
        const request = ++issued.current;
        let res: Response;
        try {
          res = await fetch(`/api/movie-night/${nightId}/state${full ? "?full=1" : ""}`, { cache: "no-store" });
        } catch {
          return null; // offline: the next poll tries again
        }
        if (res.status === 401) {
          router.push("/login");
          return null;
        }
        if (res.status === 404) {
          setGone(true);
          return null;
        }
        if (!res.ok) return null;
        const next = (await res.json()) as NightState;
        if (request < applied.current) return next; // a newer answer is already in
        if (!full && next.stacks.length !== stackCount.current) {
          full = true; // a stack was added: this time with its cards
          continue;
        }
        applied.current = request;
        stackCount.current = next.stacks.length;
        setState((prev) => (full ? next : { ...next, candidates: prev.candidates }));
        return next;
      }
      return null;
    },
    [nightId, router],
  );

  useEffect(() => {
    if (pollMs === null) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      if (!document.hidden) await refresh(false);
      // A night that is over doesn't change any more.
      if (!stopped && current.current.night.status === "open") timer = window.setTimeout(tick, pollMs);
    };
    timer = window.setTimeout(tick, pollMs);
    // Catch up straight away when the tab comes back.
    const onVisible = () => {
      if (!document.hidden) {
        window.clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollMs, refresh]);

  return { state, refresh, gone };
}
