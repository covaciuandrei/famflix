"use client";

import {
  ChevronLeft,
  Popcorn,
  Sparkles,
  Star,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type TouchEvent } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SEEN_KEY = "famflix:welcome-seen";
const SHOW_EVENT = "famflix:show-welcome";

interface Step {
  icon: LucideIcon;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  {
    icon: Users,
    title: "Family lists",
    text: "Create a family or join one with an invite code. Everyone adds what they want to watch, and you still get a private list just for you.",
  },
  {
    icon: Star,
    title: "Rate it your way",
    text: "Score titles from 1 to 10 (7.5 works too), leave a note, and like or dislike. Each title shows the family's average.",
  },
  {
    icon: UsersRound,
    title: "Watched together",
    text: "Log who watched a title with you. FamFlix then asks everyone else for their score, so nobody forgets.",
  },
  {
    icon: Popcorn,
    title: "Movie night",
    text: "Can't decide? Shuffle your To watch list, filter by genre, or let FamFlix pick for you. The Activity tab shows what the family added and rated.",
  },
];

// localStorage can throw (blocked storage, some private modes).
function hasSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {}
}

/** First-visit tour of the app's main features; can be reopened from Settings. */
export function WelcomeTour({
  name,
  hasFamily,
}: {
  name: string;
  hasFamily: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  // 0 is the greeting; 1..STEPS.length are the feature steps.
  const [step, setStep] = useState(0);
  const last = STEPS.length;

  useEffect(() => {
    const show = () => {
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
      // Otherwise the dialog focuses its first button, the close ×.
      primaryRef.current?.focus();
    };
    if (!hasSeen()) show();
    const reopen = () => {
      setStep(0);
      show();
    };
    window.addEventListener(SHOW_EVENT, reopen);
    return () => window.removeEventListener(SHOW_EVENT, reopen);
  }, []);

  const close = () => dialogRef.current?.close();
  const next = () => setStep((s) => Math.min(last, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  function onTouchEnd(e: TouchEvent) {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    const dx = e.changedTouches[0].clientX - start;
    if (dx < -50) next();
    else if (dx > 50) back();
  }

  const current = step === 0 ? null : STEPS[step - 1];
  const Icon = current?.icon ?? Sparkles;
  const firstName = name.trim().split(/\s+/)[0];

  return (
    <dialog
      ref={dialogRef}
      onClose={markSeen}
      aria-labelledby="welcome-title"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") next();
        if (e.key === "ArrowLeft") back();
      }}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={onTouchEnd}
      // A tap on the dimmed backdrop lands on the <dialog> itself.
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="m-auto w-[min(26rem,calc(100%-2rem))] overflow-hidden rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/70"
    >
      <div className="relative bg-[radial-gradient(80%_100%_at_50%_0%,rgba(124,92,255,0.35),transparent)] px-6 pb-2 pt-8">
        <button
          type="button"
          onClick={close}
          aria-label="Close the tour"
          className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <div key={step} className="fade-in flex flex-col items-center gap-4 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/20 text-primary">
            <Icon className="size-8" />
          </span>
          <div className="flex min-h-36 flex-col gap-2">
            <h2 id="welcome-title" className="text-xl font-bold">
              {current ? current.title : `Welcome to FamFlix, ${firstName}!`}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {current
                ? current.text
                : "Your shared watchlist for movies and series. Here's a quick look at what you can do."}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-6 pb-6">
        <div className="flex justify-center gap-1.5" aria-hidden>
          {Array.from({ length: last + 1 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === step ? "w-5 bg-primary" : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>

        {step < last ? (
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <Button variant="ghost" onClick={back}>
                <ChevronLeft className="size-4" />
                Back
              </Button>
            ) : (
              <Button variant="ghost" onClick={close}>
                Skip
              </Button>
            )}
            <Button ref={primaryRef} className="ml-auto" onClick={next}>
              {step === 0 ? "Show me" : "Next"}
            </Button>
          </div>
        ) : hasFamily ? (
          <Button onClick={close} className="w-full">
            Let&apos;s go
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Link
              href="/app/groups"
              onClick={close}
              className={buttonVariants({ className: "w-full" })}
            >
              Create or join a family
            </Link>
            <Button variant="ghost" onClick={close} className="w-full">
              Explore first
            </Button>
          </div>
        )}
      </div>
    </dialog>
  );
}

/** Reopens the welcome tour (used on the Settings page). */
export function ShowTourButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(SHOW_EVENT))}
      className="w-fit text-left underline hover:text-foreground"
    >
      Show the welcome tour again
    </button>
  );
}
