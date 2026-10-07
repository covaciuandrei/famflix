"use client";

import { Check, Loader2, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { addToList } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { placePopover } from "@/lib/popover";
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
  const [pending, start] = useTransition();
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const key = (t: AddTarget) => t.id ?? "personal";
  const already = new Set((alreadyOn ?? []).map((id) => id ?? "personal"));
  const isDone = (t: AddTarget) => addedTo.has(key(t)) || already.has(key(t));

  useEffect(() => {
    if (!menuOpen) return;
    // The menu is pinned to the viewport, so close it instead of letting it drift off the button.
    const close = () => {
      if (menuRef.current?.matches(":popover-open"))
        menuRef.current.hidePopover();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menuOpen]);

  function add(target: AddTarget) {
    setError(null);
    menuRef.current?.hidePopover();
    start(async () => {
      const res = await addToList({
        tmdbId,
        mediaType,
        groupId: target.id,
      });
      if (res?.error) setError(res.error);
      else setAddedTo((prev) => new Set(prev).add(key(target)));
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
    <div>
      <Button
        ref={buttonRef}
        size={size}
        className={className}
        disabled={pending}
        popoverTarget={menuId}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        Add to…
      </Button>
      {/* A native popover renders above everything, so scrolling rows and rounded cards can't clip it. */}
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        onBeforeToggle={(e) => placePopover(e, () => buttonRef.current)}
        onToggle={(e) => setMenuOpen(e.newState === "open")}
        className="inset-auto w-48 overflow-hidden rounded-lg border border-border bg-card p-1 text-card-foreground shadow-lg"
      >
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
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
