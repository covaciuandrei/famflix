"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { planNight } from "@/app/app/movie-night/actions";
import { MoodPicker, type StackOptions } from "@/components/movie-night/mood-picker";
import { Input } from "@/components/ui/input";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import {
  defaultPlanTime,
  localInputToIso,
  MAX_PLAN_NOTE,
  planBounds,
  planTimeProblem,
  toLocalInput,
} from "@/lib/movie-night-plans";

/**
 * "Plan a movie night": a window for a day and a time (in the person's own time zone), a note, and the mood the night
 * will start with, which is picked the way it is when a night starts. It opens as soon as it is shown, so show it only
 * while it is wanted (and drop it from `onClose`).
 */
export function PlanDialog({
  groupId,
  familyName,
  onClose,
}: {
  groupId: string;
  familyName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const whenId = useId();
  const noteId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Worked out when the window opens, which is in the browser, so it is the person's own evening.
  const [bounds] = useState(() => planBounds(new Date()));
  const [when, setWhen] = useState(() => toLocalInput(defaultPlanTime(new Date())));
  const [note, setNote] = useState("");

  useEffect(() => {
    openModal(dialogRef.current);
  }, []);

  async function plan({ genres, count, max }: StackOptions) {
    const startsAt = localInputToIso(when);
    const problem = planTimeProblem(startsAt, Date.now());
    if (startsAt === null || problem) return { error: problem ?? "Pick a day and a time." };
    const res = await planNight({ groupId, startsAt, note, genres, count, max });
    if (res.error) return res;
    dialogRef.current?.close();
    router.refresh();
    return {};
  }

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      {...closeOnBackdrop}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto max-h-[90vh] w-[min(40rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl outline-none backdrop:bg-black/60"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        Plan a movie night
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a day and a time for {familyName}. Everyone can answer Going, Maybe or Can&apos;t, and anyone can start the
        night when the time comes.
      </p>

      <div className="mt-4 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={whenId} className="text-sm font-medium">
            When <span className="font-normal text-muted-foreground">(in your own time)</span>
          </label>
          <Input
            id={whenId}
            type="datetime-local"
            required
            value={when}
            min={bounds.min}
            max={bounds.max}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="flex items-baseline justify-between gap-2 text-sm font-medium">
            <span>
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {note.length}/{MAX_PLAN_NOTE}
            </span>
          </label>
          <Input
            id={noteId}
            type="text"
            maxLength={MAX_PLAN_NOTE}
            placeholder="Pizza at Ana's"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <MoodPicker
          allowSeries={false}
          start={plan}
          startLabel="Plan the movie night"
          hint={`${familyName} sees it on the Movie night page, with the time in their own time zone.`}
        />
      </div>

      <button
        type="button"
        onClick={() => dialogRef.current?.close()}
        className="mt-5 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Cancel
      </button>
    </dialog>
  );
}
