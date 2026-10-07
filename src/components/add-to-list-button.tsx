"use client";

import { Check, Loader2, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { addToList } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { placePopover } from "@/lib/popover";
import type { MediaType } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface AddTarget {
  id: string | null;
  label: string;
}

export function AddToListButton({
  tmdbId,
  mediaType,
  title,
  targets,
  alreadyOn,
  size = "sm",
  className,
}: {
  tmdbId: number;
  mediaType: MediaType;
  /** Shown in the phone sheet: "Add Dune to…". */
  title?: string;
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
  const sheetRef = useRef<HTMLDialogElement>(null);

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
    const menu = menuRef.current;
    // Older iPhones have no Popover API (and no :popover-open selector).
    if (menu && "hidePopover" in menu && menu.matches(":popover-open")) {
      menu.hidePopover();
    }
    sheetRef.current?.close();
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

  const icon = pending ? (
    <Loader2 className="size-4 animate-spin" />
  ) : (
    <Plus className="size-4" />
  );
  const options = (large: boolean) =>
    targets.map((t) => {
      const done = isDone(t);
      return (
        <button
          key={key(t)}
          type="button"
          onClick={() => add(t)}
          disabled={done}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md px-2.5 text-left hover:bg-muted disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent",
            large ? "py-3.5 text-base" : "py-2 text-sm",
          )}
        >
          <span className="truncate">{t.label}</span>
          {done && <Check className="size-4 shrink-0 text-like" />}
        </button>
      );
    });

  return (
    <div>
      {/* Phones get a bottom sheet (a <dialog>, so it also works on iPhones without the Popover API). */}
      <Button
        size={size}
        className={cn(className, "sm:hidden")}
        disabled={pending}
        onClick={() => sheetRef.current?.showModal()}
      >
        {icon}
        Add to…
      </Button>
      <Button
        ref={buttonRef}
        size={size}
        className={cn(className, "max-sm:hidden")}
        disabled={pending}
        popoverTarget={menuId}
      >
        {icon}
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
        {options(false)}
      </div>
      <dialog
        ref={sheetRef}
        aria-label={title ? `Add ${title} to a list` : "Add to a list"}
        // A tap on the dimmed backdrop lands on the <dialog> itself.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="sheet mt-auto max-h-[85dvh] w-full max-w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/60"
      >
        <div className="flex flex-col gap-1 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
          <p className="truncate px-2.5 pb-1 text-sm text-muted-foreground">
            {title ? (
              <>
                Add <span className="font-medium text-foreground">{title}</span>{" "}
                to…
              </>
            ) : (
              "Add to…"
            )}
          </p>
          {options(true)}
          <Button
            variant="ghost"
            className="mt-1 h-12 w-full text-base"
            onClick={() => sheetRef.current?.close()}
          >
            Cancel
          </Button>
        </div>
      </dialog>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
