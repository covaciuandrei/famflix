"use client";

import { Loader2, Star } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  removeMeFromWatch,
  setRating,
  skipRatingRequest,
  type ActionResult,
} from "@/app/app/actions";
import { MediaPoster } from "@/components/media-poster";
import { ScoreInput, SCORE_REACTION_HINT } from "@/components/score-input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import { formatDay, formatScore } from "@/lib/format";
import { whenNoModalOpen } from "@/lib/popup";
import type { PendingRating } from "@/lib/types";

const DISMISSED_KEY = "famflix:dismissed-rating-requests";

// sessionStorage throws when the browser blocks site storage.
function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {}
}

/** Menu button + popup listing the titles you still need to rate. */
export function RatingRequests({
  pending,
  currentUserId,
}: {
  pending: PendingRating[];
  currentUserId: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  // Not in the middle of a movie night: it opens once they are somewhere else.
  const inMovieNight = pathname.startsWith("/app/movie-night");

  // Opens by itself once per browser session for requests someone else logged.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending.length === 0) {
      if (dialog.open) dialog.close();
      return;
    }
    const dismissed = readDismissed();
    const hasNew = pending.some(
      (p) => p.logged_by !== currentUserId && !dismissed.has(p.list_item_id),
    );
    if (!hasNew || dialog.open || inMovieNight) return;
    // One popup at a time: a movie night invite that opens with the page goes first (the check waits a moment for
    // it), and anything else that is open finishes before this one.
    let stopWaiting = () => {};
    const timer = window.setTimeout(() => {
      stopWaiting = whenNoModalOpen(() => openModal(dialog));
    }, 0);
    return () => {
      window.clearTimeout(timer);
      stopWaiting();
    };
  }, [pending, currentUserId, inMovieNight]);

  function rememberDismissed() {
    const dismissed = readDismissed();
    pending.forEach((p) => dismissed.add(p.list_item_id));
    writeDismissed(dismissed);
  }

  return (
    <>
      {pending.length > 0 && (
        <button
          type="button"
          onClick={() => openModal(dialogRef.current)}
          title="Ratings waiting for you"
          aria-label={`${pending.length} ${pending.length === 1 ? "title" : "titles"} waiting for your rating`}
          className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/25"
        >
          <Star className="size-4 fill-current" />
          {pending.length}
        </button>
      )}

      <dialog
        ref={dialogRef}
        tabIndex={-1}
        {...closeOnBackdrop}
        onClose={rememberDismissed}
        aria-labelledby="rating-requests-title"
        className="m-auto max-h-[85vh] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl outline-none backdrop:bg-black/60"
      >
        <h2 id="rating-requests-title" className="text-lg font-semibold">
          How did you like it?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You were marked as having watched these with your family, so they are on your My list as watched. If you
          weren&apos;t there, say so and they come off it.
        </p>

        <ul className="mt-4 flex flex-col gap-3">
          {pending.map((p) => (
            <RequestRow
              key={p.list_item_id}
              request={p}
              loggedBy={
                p.logged_by === currentUserId
                  ? "You"
                  : (p.logged_by_name ?? "Someone")
              }
            />
          ))}
        </ul>

        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
            Later
          </Button>
        </div>
      </dialog>
    </>
  );
}

function RequestRow({
  request,
  loggedBy,
}: {
  request: PendingRating;
  loggedBy: string;
}) {
  // A score someone filled in starts in the slider; saving it (changed or not) makes it yours.
  const [score, setScore] = useState<number | null>(request.filled_in_score);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(action: () => Promise<ActionResult>) {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.error) setError(res.error);
    });
  }

  const itemId = request.list_item_id;

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex gap-3">
        <MediaPoster
          path={request.poster_path}
          alt={request.title}
          size="w92"
          sizes="56px"
          className="w-14 shrink-0 self-start"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {request.title}
            {request.release_year ? ` (${request.release_year})` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {loggedBy} logged it on {formatDay(request.watched_on)} ·{" "}
            {request.group_name}
          </p>
        </div>
      </div>

      {request.filled_in_score !== null && (
        <p className="mt-3 text-xs text-muted-foreground">
          {request.filled_in_by_name ?? "Someone"} filled in{" "}
          {formatScore(request.filled_in_score)}/10 for you. Keep it or change
          it, and add your note.
        </p>
      )}

      <div className="mt-3">
        <ScoreInput value={score} onChange={setScore} />
        <p className="mt-1 text-xs text-muted-foreground">{SCORE_REACTION_HINT}</p>
      </div>

      <Textarea
        maxLength={250}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)"
        rows={1}
        className="mt-2 min-h-9"
      />

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending || (score === null && !note.trim())}
          onClick={() => run(() => setRating(itemId, score, note))}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => skipRatingRequest(itemId))}
        >
          Skip
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => removeMeFromWatch(itemId))}
        >
          I wasn&apos;t there
        </Button>
      </div>
    </li>
  );
}
