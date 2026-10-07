"use client";

import { Check, Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";

import { addToList } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import type { MediaType } from "@/lib/types";

export interface AddTarget {
  id: string | null;
  label: string;
}

export function AddToListButton({
  tmdbId,
  mediaType,
  targets,
  alreadyOn,
  size = "sm",
  className,
}: {
  tmdbId: number;
  mediaType: MediaType;
  targets: AddTarget[];
  /** List ids that already have this title (null = My list). */
  alreadyOn?: (string | null)[];
  size?: "sm" | "default";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const key = (t: AddTarget) => t.id ?? "personal";
  const already = new Set((alreadyOn ?? []).map((id) => id ?? "personal"));
  const isDone = (t: AddTarget) => addedTo.has(key(t)) || already.has(key(t));

  function add(target: AddTarget) {
    setError(null);
    start(async () => {
      const res = await addToList({
        tmdbId,
        mediaType,
        groupId: target.id,
      });
      if (res?.error) setError(res.error);
      else setAddedTo((prev) => new Set(prev).add(key(target)));
      setOpen(false);
    });
  }

  if (targets.length === 1) {
    const t = targets[0];
    const done = isDone(t);
    return (
      <Button
        size={size}
        variant={done ? "secondary" : "default"}
        className={className}
        disabled={pending || done}
        onClick={() => add(t)}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : done ? (
          <Check className="size-4" />
        ) : (
          <Plus className="size-4" />
        )}
        {done ? "Added" : "Add"}
      </Button>
    );
  }

  return (
    <div className="relative">
      <Button
        size={size}
        className={className}
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        Add to…
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-lg">
            {targets.map((t) => {
              const done = isDone(t);
              return (
                <button
                  key={key(t)}
                  type="button"
                  onClick={() => add(t)}
                  disabled={done}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
                >
                  <span className="truncate">{t.label}</span>
                  {done && <Check className="size-4 shrink-0 text-like" />}
                </button>
              );
            })}
          </div>
        </>
      )}
      {error && (
        <p className="absolute left-0 top-full mt-1 whitespace-nowrap text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
