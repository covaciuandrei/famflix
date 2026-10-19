"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import type { ActionResult } from "@/app/app/movie-night/actions";
import { Button } from "@/components/ui/button";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import { formatDay } from "@/lib/format";

/**
 * "Delete this movie night?": says what goes (the night, with its votes and guests, for everyone in the family) and what
 * stays (the title on the Watched together list and on everyone's My list), with a box to take the title off Watched
 * together too and put it back on To watch, when that can be done. It opens as soon as it is shown, so show it only while
 * it is wanted (and drop it from `onClose`). `onDelete` returns an error to show, or nothing when it worked.
 */
export function DeleteNightDialog({
  title,
  day,
  groupName,
  canUndo,
  onDelete,
  onClose,
}: {
  /** The title the night picked, if it picked one. */
  title: string | null;
  day: string | null;
  groupName: string;
  /** Offer to take the title off Watched together as well. */
  canUndo: boolean;
  onDelete: (undoWatch: boolean) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [undo, setUndo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    openModal(dialogRef.current);
  }, []);

  function confirm() {
    setError(null);
    start(async () => {
      const res = await onDelete(canUndo && undo);
      if (res.error) setError(res.error);
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
        Delete this movie night?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {title ? `${title}, ` : ""}
        {formatDay(day)}
      </p>
      <p className="mt-3 text-sm">
        It is removed from {groupName}&apos;s history for everyone, with its votes and guests. This can&apos;t be undone.
      </p>
      {title && (
        <p className="mt-2 text-sm text-muted-foreground">
          {undo && canUndo
            ? `${title} goes back to To watch, and comes off the My list of everyone who watched it.`
            : `${title} stays on ${groupName}'s Watched together list, and on the My list of everyone who watched it.`}
        </p>
      )}
      {title && canUndo && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={undo}
            onChange={(e) => setUndo(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Also put {title} back on To watch
            <span className="block text-xs text-muted-foreground">
              Anyone who rated it, left a note on it or reacted to it has to take themselves off it first (&quot;I wasn&apos;t
              there&quot;).
            </span>
          </span>
        </label>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={confirm} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Delete movie night
        </Button>
      </div>
    </dialog>
  );
}
