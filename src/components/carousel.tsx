"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { pageTarget, scrollReach } from "@/lib/carousel";
import { cn } from "@/lib/utils";

/**
 * A row of cards that scrolls sideways. A touch screen swipes it. With a mouse there is nothing to grab: the scrollbar
 * is hidden and a wheel only scrolls the page up and down. So previous/next arrows sit on its edges there, each shown
 * only while there is something to scroll to that way. Give it the cards as `<li>`s.
 */
export function Carousel({
  label,
  arrowClassName,
  children,
}: {
  /** What the row is, for the arrows' names: "Next in {label}". */
  label: string;
  /** Where the arrows sit down the row (a `top-*` class): level with the middle of the pictures. */
  arrowClassName: string;
  children: ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [reach, setReach] = useState({ back: false, forward: false });

  useEffect(() => {
    const row = list.current;
    if (!row) return;
    const measure = () => {
      const next = scrollReach(row);
      setReach((now) => (now.back === next.back && now.forward === next.forward ? now : next));
    };
    row.addEventListener("scroll", measure, { passive: true });
    // Watching a row measures it once, then again whenever its size or its cards change (a resize, new filters).
    const resized = new ResizeObserver(measure);
    resized.observe(row);
    const changed = new MutationObserver(measure);
    changed.observe(row, { childList: true });
    return () => {
      row.removeEventListener("scroll", measure);
      resized.disconnect();
      changed.disconnect();
    };
  }, []);

  function go(direction: -1 | 1) {
    const row = list.current;
    if (!row) return;
    const first = row.children[0] as HTMLElement | undefined;
    const second = row.children[1] as HTMLElement | undefined;
    const pitch = first && second ? second.offsetLeft - first.offsetLeft : 0;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollTo({ left: pageTarget(row, direction, pitch), behavior: calm ? "auto" : "smooth" });
  }

  return (
    <div className="relative">
      <Arrow direction={-1} label={label} shown={reach.back} className={arrowClassName} onClick={() => go(-1)} />
      <ul ref={list} className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {children}
      </ul>
      <Arrow direction={1} label={label} shown={reach.forward} className={arrowClassName} onClick={() => go(1)} />
    </div>
  );
}

/** Only there for a mouse or trackpad (`any-pointer: fine`), and out of sight, reach and tab order while it would do nothing. */
function Arrow({
  direction,
  label,
  shown,
  className,
  onClick,
}: {
  direction: -1 | 1;
  label: string;
  shown: boolean;
  className: string;
  onClick: () => void;
}) {
  const Icon = direction === -1 ? ChevronLeft : ChevronRight;
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={`${direction === -1 ? "Previous" : "Next"} in ${label}`}
      onClick={onClick}
      className={cn(
        "absolute z-10 hidden size-9 -translate-y-1/2 rounded-full bg-card/95 shadow-md transition-[opacity,visibility,background-color] any-pointer-fine:inline-flex",
        direction === -1 ? "-left-3" : "-right-3",
        shown ? "visible opacity-100" : "invisible opacity-0",
        className,
      )}
    >
      <Icon className="size-5" aria-hidden />
    </Button>
  );
}
