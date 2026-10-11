"use client";

import { useSyncExternalStore } from "react";

const EVERY_MS = 30_000;

let current = 0;
let timer: number | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    current = Date.now();
    timer = window.setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, EVERY_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.clearInterval(timer);
  };
}

function snapshot(): number {
  if (current === 0) current = Date.now();
  return current;
}

/**
 * The time now, as of the last half minute: null while the page is still on the server (so that the server and the
 * browser agree on what they draw), then the browser's own clock. All the components that use it share one timer.
 */
export function useNow(): number | null {
  return useSyncExternalStore<number | null>(subscribe, snapshot, () => null);
}
