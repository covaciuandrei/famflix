"use client";

import { CalendarDays } from "lucide-react";
import { useState } from "react";

import { setWatchedOn } from "@/app/app/actions";
import { WatchedOnDialog } from "@/components/watched-on-dialog";
import { formatDayNumeric } from "@/lib/format";

/**
 * When a title on My list was watched, as a line ("Watched 09.10.2026", or "Date unknown" when nobody remembers it), with
 * a button to change it. For a title the person marked watched themselves. `label` is what comes before the day.
 */
export function WatchedOnLine({
  itemId,
  title,
  day,
  label = "Watched",
}: {
  itemId: string;
  title: string;
  day: string | null;
  label?: string;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
        <span>{day ? `${label} ${formatDayNumeric(day)}` : "Date unknown"}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Change date for ${title}`}
          className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Change date
        </button>
      </p>
      {editing && (
        <WatchedOnDialog
          heading={`When did you watch ${title}?`}
          description="Titles with no day stay on your Watched list, but aren't counted in Your year."
          initial={day}
          onSave={async (next) => (await setWatchedOn(itemId, next)).error ?? null}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
