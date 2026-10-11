"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Today in the person's own time, as YYYY-MM-DD. */
const localDay = () => new Date().toLocaleDateString("en-CA");

/**
 * The day an episode was watched again, as a small form under its row (today to start with). `onSave` says what went
 * wrong, or nothing when it was saved (the panel then closes).
 */
export function EpisodeAgainPanel({
  label,
  onSave,
  onClose,
}: {
  /** The episode, like "S1E2". */
  label: string;
  onSave: (on: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [today] = useState(localDay);
  const [on, setOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const problem = await onSave(on);
      if (problem) setError(problem);
      else onClose();
    });
  }

  return (
    <div
      role="group"
      aria-label={`Watched ${label} again`}
      className="mb-2 ml-9 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
    >
      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">Watched {label} again on</span>
        <Input
          type="date"
          value={on}
          max={today}
          onChange={(e) => setOn(e.target.value)}
          className="h-9 w-auto"
          aria-label={`The day you watched ${label} again`}
        />
      </label>
      <p className="text-xs text-muted-foreground">The day it has now stays in its history.</p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={pending || !on} onClick={save}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}
