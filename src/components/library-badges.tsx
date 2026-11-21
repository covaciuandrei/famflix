import { Eye } from "lucide-react";

import type { LibraryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

const badge =
  "library-badge pointer-events-auto max-w-full truncate rounded bg-primary px-1.5 py-0.5 text-[10px] leading-3 font-medium text-primary-foreground";

/** Badges for the lists that have a title, in the top-right corner of a `relative` poster wrapper. */
export function ListBadges({ lists }: { lists?: LibraryEntry["lists"] }) {
  if (!lists?.length) return null;
  // At most 3 badges: past 3 lists, the third one becomes "+N others".
  const shown = lists.length > 3 ? lists.slice(0, 2) : lists;
  const label = `On ${lists.map((l) => l.label).join(", ")}`;
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      // Click-through, so taps beside the badges still open the title underneath.
      className="pointer-events-none absolute inset-x-1.5 top-1.5 flex flex-col items-end gap-1.5"
    >
      {shown.map((l, i) => (
        <span
          key={l.listId ?? "personal"}
          // The first badge shares its line with the rating in the top-left corner; the ones below can use the full width.
          className={cn(badge, i === 0 && "max-w-[calc(100%-3rem)]")}
        >
          {l.label}
        </span>
      ))}
      {shown.length < lists.length && (
        <span className={badge}>+{lists.length - shown.length} others</span>
      )}
    </div>
  );
}

/** "Seen by Bogdan, You". */
export function SeenBy({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  return (
    <p className="flex items-start gap-1 text-xs text-muted-foreground">
      <Eye className="mt-0.5 size-3 shrink-0" />
      <span>Seen by {names.join(", ")}</span>
    </p>
  );
}
