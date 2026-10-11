import { cn } from "@/lib/utils";
import type { SeriesStatus } from "@/lib/series";

/** A thin bar for how far someone is; `max` 0 shows an empty bar. */
export function ProgressBar({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}

const STATUS_STYLE: Record<SeriesStatus, string> = {
  "not-started": "border-border bg-muted text-muted-foreground",
  watching: "border-primary/40 bg-primary/15 text-foreground",
  "caught-up": "border-primary/40 bg-primary/15 text-foreground",
  completed: "border-like/40 bg-like/15 text-like",
};

/** What to call where someone is with a series ("Caught up" is for a show that may get more episodes). */
export function statusLabel(status: SeriesStatus, finished: boolean): string {
  switch (status) {
    case "not-started":
      return "Not started";
    case "watching":
      return "Watching";
    case "caught-up":
      return finished ? "All episodes watched" : "Caught up";
    case "completed":
      return "Completed";
  }
}

export function StatusChip({ status, finished, className }: { status: SeriesStatus; finished: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_STYLE[status],
        className,
      )}
    >
      {statusLabel(status, finished)}
    </span>
  );
}
