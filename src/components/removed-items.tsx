"use client";

import { History, Loader2, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";

import { restoreListItem } from "@/app/app/actions";
import { MediaPoster } from "@/components/media-poster";
import { Button } from "@/components/ui/button";
import type { RemovedItem } from "@/lib/types";

/** Collapsible "Recently removed" list with a Restore button per title. */
export function RemovedItems({ items }: { items: RemovedItem[] }) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground">
        <History className="size-4" />
        Recently removed ({items.length})
      </summary>
      <ul className="flex flex-col gap-3 px-4 pb-4">
        {items.map((item) => (
          <RemovedRow key={item.id} item={item} />
        ))}
      </ul>
    </details>
  );
}

function RemovedRow({ item }: { item: RemovedItem }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function restore() {
    setError(null);
    start(async () => {
      const res = await restoreListItem(item.id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <li className="flex items-center gap-3">
      <MediaPoster
        path={item.posterPath}
        alt={item.title}
        size="w92"
        sizes="40px"
        className="w-10 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="text-xs text-muted-foreground">{item.label}</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <Button size="sm" variant="outline" onClick={restore} disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RotateCcw className="size-4" />
        )}
        Restore
      </Button>
    </li>
  );
}
