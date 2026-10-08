"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef } from "react";

import type { Category } from "@/lib/categories";
import { cn } from "@/lib/utils";

// One swipeable line on phones (edge to edge, or from the label on), wrapping on wider screens.
function rowClassName(label: string | undefined) {
  return cn(
    "no-scrollbar flex gap-1.5 overflow-x-auto sm:flex-wrap",
    label ? "-mr-4 pr-4 sm:mr-0 sm:pr-0" : "-mx-4 px-4 sm:mx-0 sm:px-0",
  );
}

function chipClassName(active: boolean) {
  return cn(
    "shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
    active && "border-primary bg-primary/15 text-foreground",
  );
}

interface RowLabels {
  /** Short caption shown before the chips. */
  label?: string;
  "aria-label"?: string;
}

/** Filter chips for a list (categories by default), with how many titles each has. */
export function CategoryChips({
  categories,
  value,
  onChange,
  label,
  "aria-label": ariaLabel = "Categories",
}: RowLabels & {
  categories: Category[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Labelled label={label}>
      <div className={rowClassName(label)} role="group" aria-label={ariaLabel}>
        {categories.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            aria-pressed={value === c.value}
            className={chipClassName(value === c.value)}
          >
            {c.label} <span className="text-xs opacity-70">{c.count}</span>
          </button>
        ))}
      </div>
    </Labelled>
  );
}

/** The same chips as links, for filters that load a new page (Browse). */
export function CategoryLinks({
  links,
  label,
  "aria-label": ariaLabel = "Categories",
}: RowLabels & {
  links: { label: string; href: string; active: boolean }[];
}) {
  const navRef = useRef<HTMLElement>(null);
  const activeHref = links.find((l) => l.active)?.href;

  // On phones the row scrolls sideways: bring the selected chip into view, without moving the page.
  useEffect(() => {
    const nav = navRef.current;
    const chip = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !chip) return;
    nav.scrollLeft = chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2;
  }, [activeHref]);

  return (
    <Labelled label={label}>
      <nav
        ref={navRef}
        className={cn(rowClassName(label), "relative")}
        aria-label={ariaLabel}
      >
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            // Each filter is a fresh TMDB page; prefetching all of them on every visit is waste.
            prefetch={false}
            scroll={false}
            aria-current={l.active ? "page" : undefined}
            className={chipClassName(l.active)}
          >
            <PendingLabel>{l.label}</PendingLabel>
          </Link>
        ))}
      </nav>
    </Labelled>
  );
}

/** Puts the label before the row, outside the part that scrolls, so it stays in view on phones. */
function Labelled({
  label,
  children,
}: {
  label: string | undefined;
  children: React.ReactNode;
}) {
  if (!label) return children;
  // Screen readers get the row's aria-label instead.
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="shrink-0 text-xs font-medium text-muted-foreground"
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function PendingLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={cn(pending && "animate-pulse")}>{children}</span>;
}
