"use client";

import { Loader2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { setRating } from "@/app/app/actions";
import { ScoreInput, SCORE_REACTION_HINT } from "@/components/score-input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { closeOnBackdrop, openModal } from "@/lib/dialog";

export interface WatchedPromptTarget {
  itemId: string;
  title: string;
  /** Your current score and note on the item, if any. */
  score: number | null;
  comment: string | null;
}

const OpenWatchedPrompt = createContext<(target: WatchedPromptTarget) => void>(
  () => {},
);

/** Asks for a score and a note right after you mark a title watched on your own. */
export function useWatchedPrompt() {
  return useContext(OpenWatchedPrompt);
}

/**
 * Holds the "How was it?" popup above the lists: marking a title watched moves it to another tab,
 * which would close a popup that lived inside the title's card.
 */
export function WatchedPromptProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<WatchedPromptTarget | null>(null);
  const [round, setRound] = useState(0);

  const open = useCallback((next: WatchedPromptTarget) => {
    setTarget(next);
    setRound((r) => r + 1);
  }, []);

  useEffect(() => {
    if (target) openModal(dialogRef.current);
  }, [target, round]);

  return (
    <OpenWatchedPrompt.Provider value={open}>
      {children}
      <dialog
        ref={dialogRef}
        tabIndex={-1}
        {...closeOnBackdrop}
        onClose={() => setTarget(null)}
        aria-labelledby="watched-prompt-title"
        className="m-auto max-h-[85vh] w-[min(28rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl outline-none backdrop:bg-black/60"
      >
        {target && (
          <PromptForm
            key={round}
            target={target}
            onDone={() => dialogRef.current?.close()}
          />
        )}
      </dialog>
    </OpenWatchedPrompt.Provider>
  );
}

function PromptForm({
  target,
  onDone,
}: {
  target: WatchedPromptTarget;
  onDone: () => void;
}) {
  const [score, setScore] = useState<number | null>(target.score);
  const [note, setNote] = useState(target.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const unchanged =
    score === target.score && note.trim() === (target.comment ?? "").trim();

  function save() {
    if (unchanged) return onDone();
    setError(null);
    start(async () => {
      const res = await setRating(target.itemId, score, note);
      if (res.error) setError(res.error);
      else onDone();
    });
  }

  return (
    <>
      <h2 id="watched-prompt-title" className="text-lg font-semibold">
        How was {target.title}?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Marked as watched. Give it a score and a note if you like. You can
        change them later.
      </p>

      <div className="mt-4">
        <ScoreInput value={score} onChange={setScore} label="Your score" />
        <p className="mt-1 text-xs text-muted-foreground">
          {SCORE_REACTION_HINT}
        </p>
      </div>

      <Textarea
        maxLength={250}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)"
        aria-label="Your note"
        rows={2}
        className="mt-3"
      />

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Later
        </Button>
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </>
  );
}
