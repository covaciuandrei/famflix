"use client";

import { ArrowUpDown, Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { SORT_OPTIONS } from "@/lib/constants";
import { placePopover } from "@/lib/popover";
import type { SortKey } from "@/lib/types";
import { cn } from "@/lib/utils";

// Same height and look as the To watch / Watched / All tabs it sits next to.
const TRIGGER =
  "inline-flex h-10.5 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** How a list is sorted: a small menu on wider screens and a bottom sheet on phones, like "Add to…". */
export function SortSelect({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (value: SortKey) => void;
}) {
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const current =
    SORT_OPTIONS.find((o) => o.value === value) ?? SORT_OPTIONS[0];

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

  function pick(next: SortKey) {
    const menu = menuRef.current;
    // Older iPhones have no Popover API (and no :popover-open selector).
    if (menu && "hidePopover" in menu && menu.matches(":popover-open")) {
      menu.hidePopover();
    }
    sheetRef.current?.close();
    onChange(next);
  }

  const options = (large: boolean) =>
    SORT_OPTIONS.map((o) => {
      const selected = o.value === value;
      return (
        <button
          key={o.value}
          type="button"
          onClick={() => pick(o.value)}
          aria-pressed={selected}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground",
            large ? "py-3.5 text-base" : "py-2 text-sm",
            selected && "font-medium text-foreground",
          )}
        >
          {o.label}
          {selected && <Check className="size-4 shrink-0 text-primary" />}
        </button>
      );
    });

  const label = (
    <>
      <ArrowUpDown className="size-4 text-muted-foreground" />
      <span className="sr-only">Sort: </span>
      {current.label}
      <ChevronDown className="size-4 text-muted-foreground" />
    </>
  );

  return (
    <div className="ml-auto">
      {/* Phones: an icon button that fits beside the tabs, opening a bottom sheet (a <dialog>, so it also
          works on iPhones without the Popover API). A dot shows when the list isn't in its usual order. */}
      <button
        type="button"
        className={cn(TRIGGER, "relative w-10.5 justify-center px-0 sm:hidden")}
        aria-haspopup="dialog"
        aria-label={`Sort: ${current.label}`}
        onClick={() => sheetRef.current?.showModal()}
      >
        <ArrowUpDown className="size-4" />
        {value !== SORT_OPTIONS[0].value && (
          <span className="absolute top-2 right-2 size-1.5 rounded-full bg-primary" />
        )}
      </button>
      <button
        ref={buttonRef}
        type="button"
        className={cn(TRIGGER, "max-sm:hidden")}
        aria-haspopup="true"
        popoverTarget={menuId}
      >
        {label}
      </button>
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        onBeforeToggle={(e) => placePopover(e, () => buttonRef.current)}
        onToggle={(e) => setMenuOpen(e.newState === "open")}
        className="inset-auto w-52 overflow-hidden rounded-lg border border-border bg-card p-1 text-card-foreground shadow-lg"
      >
        <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
          Sort by
        </p>
        {options(false)}
      </div>
      <dialog
        ref={sheetRef}
        aria-label="Sort by"
        // A tap on the dimmed backdrop lands on the <dialog> itself.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="sheet mt-auto max-h-[85dvh] w-full max-w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/60"
      >
        <div className="flex flex-col gap-1 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
          <p className="px-2.5 pb-1 text-sm text-muted-foreground">Sort by</p>
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
    </div>
  );
}
