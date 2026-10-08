"use client";

import { Check, Loader2, Users } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { logWatchTogether } from "@/app/app/actions";
import { Avatar } from "@/components/avatar";
import { ScoreInput } from "@/components/score-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import { formatScore } from "@/lib/format";
import type { MemberSummary, RatingWithProfile, Watch } from "@/lib/types";

function localToday(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** "Watched together": pick which family members watched it, and optionally fill in their scores. */
export function WatchedTogetherDialog({
  itemId,
  title,
  members,
  viewers,
  ratings,
  currentUserId,
  done,
}: {
  itemId: string;
  title: string;
  members: MemberSummary[];
  viewers: Watch[];
  ratings: RatingWithProfile[];
  currentUserId: string;
  /** Already logged as watched together: the button shows a tick, like Watched. */
  done: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [watchedOn, setWatchedOn] = useState("");
  const [today, setToday] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const existingScore = (userId: string) =>
    ratings.find((r) => r.user_id === userId)?.score ?? null;
  const selected = members.filter((m) => checked.has(m.id));

  function open() {
    const now = localToday();
    setChecked(new Set([currentUserId, ...viewers.map((v) => v.user_id)]));
    setScores({});
    setToday(now);
    setWatchedOn(now);
    setError(null);
    openModal(dialogRef.current);
  }

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
      const res = await logWatchTogether({
        itemId,
        watchedOn,
        viewers: selected.map((m) => ({
          userId: m.id,
          score: existingScore(m.id) === null ? (scores[m.id] ?? null) : null,
        })),
      });
      if (res.error) setError(res.error);
      else dialogRef.current?.close();
    });
  }

  return (
    <>
      <Button variant={done ? "secondary" : "outline"} size="sm" onClick={open}>
        {done ? (
          <Check className="size-4 text-like" />
        ) : (
          <Users className="size-4" />
        )}
        Watched together
      </Button>

      <dialog
        ref={dialogRef}
        tabIndex={-1}
        {...closeOnBackdrop}
        aria-labelledby={`wt-title-${itemId}`}
        className="m-auto max-h-[85vh] w-[min(28rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl outline-none backdrop:bg-black/60"
      >
        <h2 id={`wt-title-${itemId}`} className="text-lg font-semibold">
          Who watched {title}?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tick everyone who was there. You can fill in a score for anyone who
          hasn&apos;t rated it yet. They can change it later.
        </p>

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
              <li
                key={m.id}
                className="rounded-lg border border-border px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(m.id)}
                      className="size-4 accent-primary"
                    />
                    <Avatar
                      name={m.display_name}
                      url={m.avatar_url}
                      className="size-6"
                    />
                    <span className="truncate">
                      {m.display_name}
                      {m.id === currentUserId ? " (you)" : ""}
                    </span>
                  </label>
                  {isChecked && existing !== null && (
                    <span className="text-xs text-muted-foreground">
                      Rated {formatScore(existing)}/10
                    </span>
                  )}
                </div>
                {isChecked && existing === null && (
                  <div className="mt-2">
                    <ScoreInput
                      compact
                      value={scores[m.id] ?? null}
                      onChange={(v) =>
                        setScores((prev) => ({ ...prev, [m.id]: v }))
                      }
                      label={`Score for ${m.display_name}`}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={pending || selected.length === 0 || !watchedOn}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
      </dialog>
    </>
  );
}
