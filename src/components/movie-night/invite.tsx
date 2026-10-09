"use client";

import { Popcorn } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useNightStatus } from "@/components/movie-night/night-status";
import { buttonVariants } from "@/components/ui/button";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import { findGenre } from "@/lib/genres";
import { whenNoModalOpen } from "@/lib/popup";

const SEEN_KEY = "famflix:night-invites";

// Each night's invite pops up once per browser session; sessionStorage can throw (blocked storage).
function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function remember(nightId: string) {
  try {
    const seen = readSeen();
    seen.add(nightId);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {}
}

/**
 * "Ana started a movie night": opens by itself when a family's night starts and I haven't joined it (right away, or
 * within half a minute if the app is already open). Take me there, or tap outside to close; closing means "not now",
 * and the menu dot, the Home banner and the family page keep the way back. It waits for any dialog that is open.
 */
export function NightInvite() {
  const nights = useNightStatus();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const night = shownId ? nights.find((n) => n.night_id === shownId) : undefined;
  // Someone already in Movie night is where the invite would take them.
  const onNightPages = pathname.startsWith("/app/movie-night");

  useEffect(() => {
    if (shownId || onNightPages) return;
    const seen = readSeen();
    const next = nights.find((n) => !n.joined && !seen.has(n.night_id));
    if (!next) return;
    return whenNoModalOpen(() => {
      setShownId(next.night_id);
      // Opened in the same breath, so anything else waiting for a turn sees this one has taken it.
      openModal(dialogRef.current);
    });
  }, [nights, shownId, onNightPages]);

  // The night ended, or I joined it, while the invite was up.
  useEffect(() => {
    if (shownId && !night) dialogRef.current?.close();
  }, [shownId, night]);

  // "Take me there" leaves the invite up until the room is on screen, so nothing else waiting for a turn (a rating
  // request) opens in between; once I'm in Movie night it closes, and what was waiting stays away from the room.
  useEffect(() => {
    if (onNightPages) dialogRef.current?.close();
  }, [onNightPages]);

  const genres = night?.genres.map((slug) => findGenre(slug)?.label ?? slug) ?? [];
  const who = night?.started_by_name ?? "Someone";

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      {...closeOnBackdrop}
      onClose={() => {
        if (shownId) remember(shownId);
        setShownId(null);
      }}
      aria-labelledby="night-invite-title"
      className="m-auto w-[min(24rem,calc(100%-2rem))] overflow-hidden rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl outline-none backdrop:bg-black/70"
    >
      {night && (
        <div className="bg-[radial-gradient(80%_100%_at_50%_0%,rgba(124,92,255,0.35),transparent)] px-6 pt-8 pb-6">
          <div className="fade-in flex flex-col items-center gap-4 text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/20 text-primary">
              <Popcorn className="size-8" />
            </span>
            <div className="flex flex-col gap-1">
              <h2 id="night-invite-title" className="text-xl font-bold">
                {who} started a movie night
              </h2>
              <p className="text-sm text-muted-foreground">
                {night.group_name} · {genres.length > 0 ? genres.join(", ") : "a bit of everything"}
              </p>
            </div>
            <Link
              href={`/app/movie-night/${night.night_id}`}
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
