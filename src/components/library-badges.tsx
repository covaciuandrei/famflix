import { Check, Eye } from "lucide-react";

import type { LibraryEntry } from "@/lib/types";

/** "On My list, Our Family (watched)" and "Seen by Bogdan, You". */
export function LibraryBadges({ entry }: { entry?: LibraryEntry }) {
  if (!entry || (entry.lists.length === 0 && entry.seenBy.length === 0)) {
    return null;
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {entry.lists.length > 0 && (
        <p className="flex items-start gap-1 text-like">
          <Check className="mt-0.5 size-3 shrink-0" />
          <span>
            On{" "}
            {entry.lists
              .map((l) => (l.watched ? `${l.label} (watched)` : l.label))
              .join(", ")}
          </span>
        </p>
      )}
      {entry.seenBy.length > 0 && (
        <p className="flex items-start gap-1 text-muted-foreground">
          <Eye className="mt-0.5 size-3 shrink-0" />
          <span>Seen by {entry.seenBy.join(", ")}</span>
        </p>
      )}
    </div>
  );
}
