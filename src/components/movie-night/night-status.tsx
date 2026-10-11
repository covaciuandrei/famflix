"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import type { ActiveNight } from "@/lib/movie-night";
import { parseDuePlans, type DuePlan } from "@/lib/movie-night-plans";

/** How often the open nights are checked while the tab is visible. */
const POLL_MS = 30_000;

const NightStatus = createContext<ActiveNight[]>([]);
const DuePlans = createContext<DuePlan[]>([]);

/** The open movie nights in my families, as far as the app knows (see NightStatusProvider). */
export function useNightStatus(): ActiveNight[] {
  return useContext(NightStatus);
}

/**
 * The planned movie nights that were about to start (or just had) at the last check, in my families. They are only
 * what the server listed: see plansInWindow() for the ones that are still within the reminders' window now.
 */
export function useDuePlans(): DuePlan[] {
  return useContext(DuePlans);
}

/** A night that is waiting on me: I haven't joined it, or there is a stack I haven't finished. */
export function waitingOnMe(night: ActiveNight): boolean {
  return !night.joined || night.waiting_stacks > 0;
}

/**
 * Keeps the app's picture of the open movie nights, and of the planned ones that are due, fresh: the page brings a first
 * one, and after that it is checked every 30 seconds while the tab is visible (only when `poll` says someone in my
 * families could start a night), when the tab comes back, and after moving to another page. The invite, the dot on the
 * menu and the banners all read it.
 */
export function NightStatusProvider({
  initial,
  initialPlans,
  poll,
  children,
}: {
  initial: ActiveNight[];
  initialPlans: DuePlan[];
  poll: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [source, setSource] = useState(initial);
  const [nights, setNights] = useState(initial);
  const [planSource, setPlanSource] = useState(initialPlans);
  const [plans, setPlans] = useState(initialPlans);
  // A new page render brings newer data than what was fetched since.
  if (initial !== source) {
    setSource(initial);
    setNights(initial);
  }
  if (initialPlans !== planSource) {
    setPlanSource(initialPlans);
    setPlans(initialPlans);
  }

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/movie-night/active", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { nights?: ActiveNight[]; plans?: unknown };
      if (Array.isArray(body.nights)) setNights(body.nights);
      if (Array.isArray(body.plans)) setPlans(parseDuePlans(body.plans));
    } catch {
      // Offline: the next check tries again.
    }
  }, []);

  useEffect(() => {
    if (!poll) return;
    let timer: number | undefined;
    const tick = async () => {
      if (!document.hidden) await refresh();
      timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) {
        window.clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll, refresh]);

  // Joining or finishing in the room changes what is waiting for me, so catch up when the page changes.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (!poll) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [pathname, poll, refresh]);

  return (
    <NightStatus.Provider value={nights}>
      <DuePlans.Provider value={plans}>{children}</DuePlans.Provider>
    </NightStatus.Provider>
  );
}
