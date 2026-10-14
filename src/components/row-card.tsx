import type { ReactNode } from "react";

import type { AddTarget } from "@/components/add-to-list-button";
import { MediaCard } from "@/components/media-card";
import type { CardItem } from "@/lib/browse-rows";
import type { LibraryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

/** What a card in a row takes of it. The row scrolls, so cards keep their width instead of shrinking to fit. */
const SLOT = "w-32 shrink-0 sm:w-36";

/** One title in a row of them (a row is a list). Works on the server, for a row's first page, and in the browser, for the ones it loads. */
export function RowCard({
  item,
  targets,
  library,
}: {
  item: CardItem;
  targets: AddTarget[];
  library?: LibraryEntry;
}) {
  return (
    <li className={SLOT}>
      <MediaCard item={item} targets={targets} library={library} />
    </li>
  );
}

/** Stands in for a card while the next ones load, the same size as one so the row doesn't jump when they arrive. */
export function RowCardSkeleton() {
  const block = "rounded bg-muted motion-safe:animate-pulse";
  return (
    <li aria-hidden className={cn(SLOT, "flex flex-col gap-2")}>
      <div className={cn(block, "aspect-[2/3] rounded-lg")} />
      <div className="flex h-9 flex-col justify-center gap-1.5">
        <div className={cn(block, "h-3.5 w-3/4")} />
        <div className={cn(block, "h-3 w-1/2")} />
      </div>
      <div className={cn(block, "h-8 rounded-md")} />
    </li>
  );
}

/** A message at the end of a row, as tall as a poster. */
export function RowNotice({ children }: { children: ReactNode }) {
  return (
    <li className={cn(SLOT, "self-start")}>
      <div className="flex aspect-[2/3] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
        {children}
      </div>
    </li>
  );
}
