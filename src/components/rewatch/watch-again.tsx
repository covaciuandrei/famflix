"use client";

import { Loader2, Repeat } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";

import { watchAgain, watchedAgain } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWatchedPrompt } from "@/components/watched-prompt";
import { WatchedTogetherModal } from "@/components/watched-together-modal";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import { localDay } from "@/lib/day";
import type { MemberSummary, RatingWithProfile, Watch } from "@/lib/types";

const DIALOG =
  "m-auto max-h-[85vh] w-[min(28rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl outline-none backdrop:bg-black/60";

/**
 * "Watch again" on a title that is watched: put it back on To watch (for a movie night or next time), or log a new
 * viewing now. Either way the viewing it has now is kept in its history. On a family list the new viewing is the same
 * window as Watched together; on My list it is just the day.
 */
export function WatchAgain({
  itemId,
  title,
  family,
  mine,
  size = "sm",
}: {
  itemId: string;
  title: string;
  /** On a family list. */
  family?: {
    members: MemberSummary[];
    viewers: Watch[];
    ratings: RatingWithProfile[];
    currentUserId: string;
  };
  /** On My list: your score and note, for the "How was it?" prompt after a new viewing. */
  mine?: { score: number | null; comment: string | null };
  size?: "sm" | "default";
}) {
  const [step, setStep] = useState<"choose" | "log" | null>(null);
  const askHowItWas = useWatchedPrompt();

  return (
    <>
      <Button variant="outline" size={size} onClick={() => setStep("choose")}>
        <Repeat className="size-4" aria-hidden />
        Watch again
      </Button>

      {step === "choose" && (
        <ChooseDialog
          itemId={itemId}
          title={title}
          forFamily={Boolean(family)}
          onLog={() => setStep("log")}
          onClose={() => setStep(null)}
        />
      )}

      {step === "log" && family && (
        <WatchedTogetherModal
          title={title}
          intro="This is a new viewing: the one it has now stays in its history."
          submitLabel="Log it"
          members={family.members}
          initialChecked={[family.currentUserId, ...family.viewers.map((v) => v.user_id)]}
          ratings={family.ratings}
          currentUserId={family.currentUserId}
          onSubmit={(input) => watchedAgain({ itemId, ...input })}
          onClose={() => setStep(null)}
        />
      )}

      {step === "log" && mine && (
        <WatchedOnDialog
          itemId={itemId}
          title={title}
          onSaved={() => askHowItWas({ itemId, title, score: mine.score, comment: mine.comment })}
          onClose={() => setStep(null)}
        />
      )}
    </>
  );
}

function Choice({
  label,
  text,
  pending,
  onClick,
}: {
  label: string;
  text: ReactNode;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="flex w-full items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{text}</span>
      </span>
      {pending && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />}
    </button>
  );
}

function ChooseDialog({
  itemId,
  title,
  forFamily,
  onLog,
  onClose,
}: {
  itemId: string;
  title: string;
  forFamily: boolean;
  onLog: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openModal(dialogRef.current);
  }, []);

  function putBack() {
    setError(null);
    start(async () => {
      const res = await watchAgain(itemId);
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
      className={DIALOG}
    >
      <h2 id={titleId} className="text-lg font-semibold">
        Watch {title} again
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The viewing it has now stays in its history, so nothing is lost.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <Choice
          label="Put back on To watch"
          text={
            forFamily
              ? "It goes back on the list, first in line for the next movie night."
              : "It goes back on your To watch list."
          }
          pending={pending}
          onClick={putBack}
        />
        <Choice
          label={forFamily ? "We watched it again…" : "I watched it again…"}
          text="Log a new viewing now."
          onClick={onLog}
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}

/** My list: the day of the new viewing. */
function WatchedOnDialog({
  itemId,
  title,
  onSaved,
  onClose,
}: {
  itemId: string;
  title: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [today] = useState(localDay);
  const [watchedOn, setWatchedOn] = useState(today);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openModal(dialogRef.current);
  }, []);

  function save() {
    setError(null);
    start(async () => {
      const res = await watchedAgain({ itemId, watchedOn });
      if (res.error) {
        setError(res.error);
        return;
      }
      dialogRef.current?.close();
      onSaved();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      {...closeOnBackdrop}
      onClose={onClose}
      aria-labelledby={titleId}
      className={DIALOG}
    >
      <h2 id={titleId} className="text-lg font-semibold">
        When did you watch {title} again?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">The viewing it has now stays in its history.</p>

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

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || !watchedOn}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Log it
        </Button>
      </div>
    </dialog>
  );
}
