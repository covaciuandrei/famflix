"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { ScoreInput } from "@/components/score-input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * A person's own score and note for one episode, as a small form under its row. `onSave` says what went wrong, or
 * nothing when it was saved (the panel then closes); saving neither a score nor a note takes the old ones off.
 */
export function EpisodeRatingPanel({
  label,
  score: initialScore,
  comment: initialComment,
  onSave,
  onClose,
}: {
  /** The episode, like "S1E2". */
  label: string;
  score: number | null;
  comment: string | null;
  onSave: (score: number | null, comment: string | null) => Promise<string | null>;
  onClose: () => void;
}) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [note, setNote] = useState(initialComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hasOld = initialScore !== null || !!initialComment;

  function save(nextScore: number | null, nextNote: string) {
    setError(null);
    startTransition(async () => {
      const problem = await onSave(nextScore, nextNote.trim() || null);
      if (problem) setError(problem);
      else onClose();
    });
  }

  return (
    <div role="group" aria-label={`Your rating for ${label}`} className="mb-2 ml-9 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <ScoreInput value={score} onChange={setScore} label={`Your score for ${label}`} />
      <Textarea
        maxLength={250}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)"
        aria-label="Your note"
        rows={2}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {hasOld && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => save(null, "")}>
            Remove
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={pending} onClick={() => save(score, note)}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}
