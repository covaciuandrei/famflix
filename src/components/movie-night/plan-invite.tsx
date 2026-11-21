"use client";

import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { LocalTime } from "@/components/movie-night/local-time";
import { useDuePlans } from "@/components/movie-night/night-status";
import { buttonVariants } from "@/components/ui/button";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import { isSwipingPath } from "@/lib/movie-night";
import { planToInvite, readShownPlans, rememberShownPlan, whenWords } from "@/lib/movie-night-plans";
import { whenNoModalOpen } from "@/lib/popup";
import { useNow } from "@/lib/use-now";

// Each plan's invite opens once for a person, for good: the browser keeps which ones it has shown (localStorage can
// throw: blocked storage).
const SHOWN_KEY = "famflix:plan-invites";

function shownPlans(): Set<string> {
  try {
    return readShownPlans(localStorage.getItem(SHOWN_KEY));
  } catch {
    return new Set();
  }
}

function remember(planId: string) {
  try {
    localStorage.setItem(SHOWN_KEY, rememberShownPlan(localStorage.getItem(SHOWN_KEY), planId));
  } catch {}
}

/**
 * "Movie night starts in 10 minutes": opens by itself, once for each plan, from 15 minutes before its time until
 * three hours after, for a plan of a family of mine that I haven't said I can't come to. Take me there, or tap outside
 * to close; the dot on the menu and the banner on the Movie night page keep the way back. It waits for any dialog that is
 * open, and is never put in front of someone swiping or already in Movie night, where the plan is right there.
 */
export function PlanInvite() {
  const plans = useDuePlans();
  const now = useNow();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const plan = shownId ? plans.find((p) => p.id === shownId) : undefined;
  const inMovieNight = pathname.startsWith("/app/movie-night");
  const swiping = isSwipingPath(pathname);

  useEffect(() => {
    if (shownId || swiping || inMovieNight || now === null) return;
    const next = planToInvite(plans, now, shownPlans());
    if (!next) return;
    return whenNoModalOpen(() => {
      // Remembered as it opens: it comes once, even if the page is reloaded with it up.
      remember(next.id);
      setShownId(next.id);
      openModal(dialogRef.current);
    });
  }, [plans, now, shownId, swiping, inMovieNight]);

  // The plan was started, cancelled or answered with Can't while the invite was up.
  useEffect(() => {
    if (shownId && !plan) dialogRef.current?.close();
  }, [shownId, plan]);

  // "Take me there" leaves the invite up until Movie night is on screen, so nothing else waiting for a turn opens in
  // between; once I'm there it closes.
  useEffect(() => {
    if (inMovieNight) dialogRef.current?.close();
  }, [inMovieNight]);

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      {...closeOnBackdrop}
      onClose={() => setShownId(null)}
      aria-labelledby="plan-invite-title"
      className="m-auto w-[min(24rem,calc(100%-2rem))] overflow-hidden rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl outline-none backdrop:bg-black/70"
    >
      {plan && (
        <div className="feature-dialog-header bg-[radial-gradient(80%_100%_at_50%_0%,rgba(124,92,255,0.35),transparent)] px-6 pt-8 pb-6">
          <div className="fade-in flex flex-col items-center gap-4 text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/20 text-primary">
              <CalendarClock className="size-8" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <h2 id="plan-invite-title" className="text-xl font-bold">
                Movie night {now === null ? "is planned" : whenWords(plan.starts_at, now).toLowerCase()}
              </h2>
              <p className="text-sm text-muted-foreground">
                {plan.group_name} · <LocalTime iso={plan.starts_at} />
                {plan.going > 0 ? ` · ${plan.going} going` : ""}
              </p>
              {plan.note && <p className="mt-1 text-sm text-pretty">“{plan.note}”</p>}
            </div>
            <Link
              href={`/app/movie-night?who=${plan.group_id}`}
              className={buttonVariants({ size: "lg", className: "w-full" })}
            >
              Take me there
            </Link>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
