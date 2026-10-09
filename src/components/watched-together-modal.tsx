"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";

import { Avatar } from "@/components/avatar";
import { ScoreInput } from "@/components/score-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import { formatScore } from "@/lib/format";
import type { MemberSummary, RatingWithProfile } from "@/lib/types";

function localToday(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** What the form hands over: when, who was there (with a score for anyone who had none), and the user's own note. */
export interface WatchedTogetherInput {
  watchedOn: string;
  viewers: { userId: string; score: number | null }[];
  /** Only your own note, and only when it changed: everyone else adds theirs when asked to rate it. */
  note?: string;
}

/**
 * The "Who watched it?" window: a date, the people who were there, a score for anyone who hasn't rated it yet and
 * the user's own note. It opens as soon as it is shown and starts from the props, so show it only while it is wanted
 * (and drop it from `onClose`). `onSubmit` returns an error to show, or nothing when it worked, and the window closes.
 */
export function WatchedTogetherModal({
  title,
  intro,
  submitLabel = "Save",
  members,
  initialChecked,
  ratings,
  currentUserId,
  onSubmit,
  onClose,
}: {
  title: string;
  intro?: ReactNode;
  submitLabel?: string;
  members: MemberSummary[];
  /** Who starts ticked. */
  initialChecked: readonly string[];
  /** What the family already rated this title: those scores show as they are, and your note starts from yours. */
  ratings: RatingWithProfile[];
  currentUserId: string;
  onSubmit: (input: WatchedTogetherInput) => Promise<{ error?: string } | void>;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const existingScore = (userId: string) => ratings.find((r) => r.user_id === userId)?.score ?? null;
  const myComment = ratings.find((r) => r.user_id === currentUserId)?.comment ?? "";

  const [checked, setChecked] = useState<Set<string>>(() => new Set(initialChecked));
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [note, setNote] = useState(myComment);
  const [today] = useState(localToday);
  const [watchedOn, setWatchedOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const selected = members.filter((m) => checked.has(m.id));

  useEffect(() => {
    openModal(dialogRef.current);
  }, []);

  function toggle(userId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await onSubmit({
        watchedOn,
        viewers: selected.map((m) => ({
          userId: m.id,
          score: existingScore(m.id) === null ? (scores[m.id] ?? null) : null,
        })),
        note: checked.has(currentUserId) && note.trim() !== myComment.trim() ? note : undefined,
      });
      if (res?.error) setError(res.error);
      else dialogRef.current?.close();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      {...closeOnBackdrop}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto max-h-[85vh] w-[min(28rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl outline-none backdrop:bg-black/60"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        Who watched {title}?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Tick everyone who was there: it goes on each of their My lists as watched. You can fill in a score for anyone
        who hasn&apos;t rated it yet, and add your own note. The others are asked to confirm their score and add their
        note.
      </p>
      {intro && <div className="mt-2 text-sm text-muted-foreground">{intro}</div>}

      <label className="mt-4 flex items-center gap-3 text-sm">
        <span className="font-medium">Date</span>
        <Input
          type="date"
          value={watchedOn}
          max={today || undefined}
          onChange={(e) => setWatchedOn(e.target.value)}
          className="h-9 w-auto"
        />
      </label>

      <ul className="mt-4 flex flex-col gap-2">
        {members.map((m) => {
          const isChecked = checked.has(m.id);
          const existing = existingScore(m.id);
          return (
            <li key={m.id} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(m.id)}
                    className="size-4 accent-primary"
                  />
                  <Avatar name={m.display_name} url={m.avatar_url} className="size-6" />
                  <span className="truncate">
                    {m.display_name}
                    {m.id === currentUserId ? " (you)" : ""}
                  </span>
                </label>
                {isChecked && existing !== null && (
                  <span className="text-xs text-muted-foreground">Rated {formatScore(existing)}/10</span>
                )}
              </div>
              {isChecked && existing === null && (
                <div className="mt-2">
                  <ScoreInput
                    compact
                    value={scores[m.id] ?? null}
                    onChange={(v) => setScores((prev) => ({ ...prev, [m.id]: v }))}
                    label={`Score for ${m.display_name}`}
                  />
                </div>
              )}
              {isChecked && m.id === currentUserId && (
                <Textarea
                  maxLength={250}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Your note (optional)"
                  aria-label="Your note"
                  rows={1}
                  className="mt-2 min-h-9"
                />
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || selected.length === 0 || !watchedOn}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </dialog>
  );
}
