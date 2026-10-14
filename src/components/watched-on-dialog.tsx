"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useWatchedOn, WatchedOnField } from "@/components/watched-on-field";
import { closeOnBackdrop, openModal } from "@/lib/dialog";

/**
 * A small window for the day something was watched on (or "I don't remember"). It opens when it is shown, and `onClose`
 * is what to do once it has closed (hide it). `onSave` gets the day (null: nobody remembers it) and says what went wrong,
 * or nothing when it was saved, which closes the window.
 */
export function WatchedOnDialog({
  heading,
  description,
  initial,
  label,
  submitLabel = "Save",
  onSave,
  onClose,
}: {
  heading: string;
  description?: string;
  /** The day it has now; null when it has none; left out it starts on today. */
  initial?: string | null;
  label?: string;
  submitLabel?: string;
  onSave: (day: string | null) => Promise<string | null>;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const state = useWatchedOn(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openModal(dialogRef.current);
  }, []);

  function save() {
    setError(null);
    start(async () => {
      const problem = await onSave(state.day);
      if (problem) setError(problem);
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
        {heading}
      </h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}

      <WatchedOnField state={state} label={label} className="mt-4" />

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || !state.valid}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </dialog>
  );
}
