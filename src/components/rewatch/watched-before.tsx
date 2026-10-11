"use client";

import { ChevronDown, Repeat } from "lucide-react";
import { useId, useState } from "react";

import { formatDayNumeric } from "@/lib/format";
import type { ViewingLine } from "@/lib/rewatch";
import { cn } from "@/lib/utils";

/**
 * "Watched 3×" or "Watch again · seen 2×": tapping it lists the days, and on a family list who was there. A chip with
 * no days to list (a series started again, whose days are by episode) is only a label.
 */
export function WatchedBefore({ chip, lines }: { chip: string; lines: ViewingLine[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (lines.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground">
        <Repeat className="size-3 text-muted-foreground" aria-hidden />
        {chip}
      </span>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listId}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Repeat className="size-3 text-muted-foreground" aria-hidden />
        {chip}
        <ChevronDown
          className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <ul id={listId} hidden={!open} className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
        {lines.map((line) => (
          <li key={line.on}>
            <span className="font-medium text-foreground">{formatDayNumeric(line.on)}</span>
            {line.who.length > 0 && <> · {line.who.join(", ")}</>}
          </li>
        ))}
      </ul>
    </div>
  );
}
