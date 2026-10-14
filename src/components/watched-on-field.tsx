"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { isDay, localDay } from "@/lib/day";
import { cn } from "@/lib/utils";

/** What a WatchedOnField shows: the day in its box, and whether "I don't remember" is ticked. */
export interface WatchedOn {
  day: string;
  unknown: boolean;
}

/**
 * The state of a WatchedOnField. `initial` is the day it starts on, or null when nobody remembers it (the box then starts
 * on today, which is what unticking offers); left out it starts on today. Only for a form that is opened by the person
 * (it reads today from the browser).
 */
export function useWatchedOn(initial?: string | null) {
  const [today] = useState(localDay);
  const [value, setValue] = useState<WatchedOn>({ day: initial ?? today, unknown: initial === null });
  return {
    today,
    value,
    setValue,
    /** What to save: the day, or null for "I don't remember". */
    day: value.unknown ? null : value.day,
    /** Whether it can be saved: a real day that is not in the future, or no day at all. */
    valid: value.unknown || (isDay(value.day) && value.day <= today),
  };
}

/**
 * The day something was watched on: a date (not after today), or "I don't remember", which keeps it marked as watched but
 * out of Your year.
 */
export function WatchedOnField({
  state,
  label = "Watched on",
  className,
}: {
  state: ReturnType<typeof useWatchedOn>;
  label?: string;
  className?: string;
}) {
  const { today, value, setValue } = state;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <Input
          type="date"
          value={value.day}
          max={today}
          disabled={value.unknown}
          onChange={(e) => setValue({ ...value, day: e.target.value })}
          className="h-9 w-auto"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.unknown}
          onChange={(e) => setValue({ ...value, unknown: e.target.checked })}
          className="size-4 accent-primary"
        />
        I don&apos;t remember
      </label>
      {value.unknown && (
        <p className="text-xs text-muted-foreground">It stays marked as watched, but isn&apos;t counted in Your year.</p>
      )}
    </div>
  );
}
