"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef } from "react";

import type { Category } from "@/lib/categories";
import { cn } from "@/lib/utils";

// One swipeable line on phones (edge to edge), wrapping on wider screens.
const ROW =
  "no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0";

function chipClassName(active: boolean) {
  return cn(
    "shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
    active && "border-primary bg-primary/15 text-foreground",
  );
}

/** Genre and movie/series filters for a list, with how many titles each has. */
export function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={ROW} role="group" aria-label="Categories">
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
  );
}

/** The same chips as links, for categories that load a new page (Browse). */
export function CategoryLinks({
  links,
}: {
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
    <nav ref={navRef} className={cn(ROW, "relative")} aria-label="Categories">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          // Each category is a fresh TMDB page; prefetching all of them on every visit is waste.
          prefetch={false}
          scroll={false}
          aria-current={l.active ? "page" : undefined}
          className={chipClassName(l.active)}
        >
          <PendingLabel>{l.label}</PendingLabel>
        </Link>
      ))}
    </nav>
  );
}

function PendingLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={cn(pending && "animate-pulse")}>{children}</span>;
}
