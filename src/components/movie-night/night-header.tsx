"use client";

import { ArrowLeft, EyeIcon, ListOrdered, MoreVertical, Popcorn, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { findGenre } from "@/lib/genres";
import type { NightInfo } from "@/lib/movie-night";
import { cn } from "@/lib/utils";

/** The title of a night and, while it is open, a menu to show the results now or cancel it (any member can). */
export function NightHeader({
  night,
  canAct,
  onBoard,
  onReveal,
  onCancel,
}: {
  night: NightInfo;
  canAct: boolean;
  /** Offered while swiping, when there is a leaderboard to look at first. */
  onBoard?: () => void;
  onReveal: () => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const genres = night.genres.map((slug) => findGenre(slug)?.label ?? slug);
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted";

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Popcorn className="size-5 shrink-0 text-primary" />
          <span className="truncate">Movie night</span>
        </h1>
        <p className="truncate text-sm text-muted-foreground">
          {night.group_name} · {genres.length > 0 ? genres.join(", ") : "a bit of everything"}
        </p>
      </div>
      <div ref={menu} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Movie night menu"
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <MoreVertical className="size-5" />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute top-full right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-card p-1 shadow-lg"
          >
            {onBoard && (
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onBoard();
                }}
              >
                <ListOrdered className="size-4" />
                See the leaderboard
              </button>
            )}
            {canAct && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={() => {
                    setOpen(false);
                    onReveal();
                  }}
                >
                  <EyeIcon className="size-4" />
                  Show results now
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={cn(item, "text-destructive")}
                  onClick={() => {
                    setOpen(false);
                    onCancel();
                  }}
                >
                  <XCircle className="size-4" />
                  Cancel movie night
                </button>
              </>
            )}
            <Link
              role="menuitem"
              href={`/app/movie-night?who=${night.group_id}`}
              className={item}
              onClick={() => setOpen(false)}
            >
              <ArrowLeft className="size-4" />
              Back to Movie night
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
