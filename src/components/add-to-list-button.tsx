"use client";

import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { addToList, removeListItem } from "@/app/app/actions";
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
  variant = "default",
  label = "Add",
  addOnly = false,
  className,
}: {
  tmdbId: number;
  mediaType: MediaType;
  /** Shown in the phone sheet: "Add Dune to…". */
  title?: string;
  targets: AddTarget[];
  /** Lists that already have this title (listId null = My list), with the list item to remove. */
  alreadyOn?: { listId: string | null; itemId: string }[];
  size?: "sm" | "default";
  /** How loud the button is: the main action of a card, or one of several. */
  variant?: "default" | "outline";
  /** What the button says ("Add", or "Add to…" when there is a list to pick). */
  label?: string;
  /** Only adds: a list that has the title already says so, and doesn't offer to take it off again. */
  addOnly?: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);

  const key = (listId: string | null) => listId ?? "personal";
  // No local copy: each action's response re-renders the page with fresh lists.
  const itemIds = new Map(
    (alreadyOn ?? []).map((l) => [key(l.listId), l.itemId]),
  );

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

  /** Adds the title to the list, or removes it if it's already there. */
  function toggle(target: AddTarget) {
    setError(null);
    const menu = menuRef.current;
    // Older iPhones have no Popover API (and no :popover-open selector).
    if (menu && "hidePopover" in menu && menu.matches(":popover-open")) {
      menu.hidePopover();
    }
    sheetRef.current?.close();
    const itemId = itemIds.get(key(target.id));
    start(async () => {
      const res = itemId
        ? await removeListItem(itemId)
        : await addToList({ tmdbId, mediaType, groupId: target.id });
      if (res?.error) setError(res.error);
    });
  }

  const errorText = error && (
    <p className="mt-1 text-xs text-destructive">{error}</p>
  );

  if (targets.length === 1) {
    const t = targets[0];
    return (
      <div>
        {itemIds.has(key(t.id)) ? (
          <div className={cn("flex gap-1", className)}>
            <Button
              size={size}
              variant="secondary"
              disabled
              className="min-w-0 flex-1"
            >
              <Check className="size-4" />
              Added
            </Button>
            {!addOnly && (
              <Button
                size={size}
                variant="ghost"
                disabled={pending}
                onClick={() => toggle(t)}
                aria-label={`Remove from ${t.label}`}
                className="px-2.5 text-muted-foreground hover:text-destructive"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            )}
          </div>
        ) : (
          <Button
            size={size}
            variant={variant}
            className={className}
            disabled={pending}
            onClick={() => toggle(t)}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {label}
          </Button>
        )}
        {errorText}
      </div>
    );
  }

  const icon = pending ? (
    <Loader2 className="size-4 animate-spin" />
  ) : (
    <Plus className="size-4" />
  );
  // With a list to pick, the button says where it leads: "Add to…", or what it was given ("Add to family…").
  const pickLabel = label === "Add" ? "Add to…" : `${label}…`;
  const options = (large: boolean) =>
    targets.map((t) => {
      const on = itemIds.has(key(t.id));
      // A list that has the title is only a note, when this button only adds.
      const settled = on && addOnly;
      return (
        <button
          key={key(t.id)}
          type="button"
          onClick={() => toggle(t)}
          disabled={settled}
          aria-label={on && !addOnly ? `Remove from ${t.label}` : undefined}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md px-2.5 text-left hover:bg-muted disabled:pointer-events-none",
            large ? "py-3.5 text-base" : "py-2 text-sm",
          )}
        >
          <span className="truncate">{t.label}</span>
          {on && (
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 text-muted-foreground",
                large ? "text-sm" : "text-xs",
              )}
            >
              <Check className="size-4 text-like" />
              {addOnly ? "Added" : "Remove"}
            </span>
          )}
        </button>
      );
    });

  return (
    <div>
      {/* Phones get a bottom sheet (a <dialog>, so it also works on iPhones without the Popover API). */}
      <Button
        size={size}
        variant={variant}
        className={cn(className, "sm:hidden")}
        disabled={pending}
        onClick={() => sheetRef.current?.showModal()}
      >
        {icon}
        {pickLabel}
      </Button>
      <Button
        ref={buttonRef}
        size={size}
        variant={variant}
        className={cn(className, "max-sm:hidden")}
        disabled={pending}
        popoverTarget={menuId}
      >
        {icon}
        {pickLabel}
      </Button>
      {/* A native popover renders above everything, so scrolling rows and rounded cards can't clip it. */}
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        onBeforeToggle={(e) => placePopover(e, () => buttonRef.current)}
        onToggle={(e) => setMenuOpen(e.newState === "open")}
        className="inset-auto w-56 overflow-hidden rounded-lg border border-border bg-card p-1 text-card-foreground shadow-lg"
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
      {errorText}
    </div>
  );
}
