"use client";

import { ArrowLeft, EyeIcon, ListOrdered, LogOut, MoreVertical, Pencil, Popcorn, Search, Trash2, UserPlus, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { findGenre } from "@/lib/genres";
import type { NightInfo } from "@/lib/movie-night";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The title of a night and a menu with what can be done with it: every item is there when its handler is. A member of
 * a night that is open can show the results now, pick a title themselves, invite a guest or cancel it; a member of one
 * that is over can change who watched it and when, or delete it, if the database says they may; a guest can leave.
 * `compact` (while swiping) takes less room on a phone, where every pixel goes to the card: the family's name
 * moves up beside the title and the line under it goes.
 */
export function NightHeader({
  night,
  compact = false,
  backHref,
  onBoard,
  onReveal,
  onPickOther,
  onInvite,
  onCancel,
  onEdit,
  onDelete,
  onLeave,
}: {
  night: NightInfo;
  compact?: boolean;
  /** Where "Back" goes: the family's Movie night page. A guest has no app to go back to. */
  backHref?: string;
  /** Offered while swiping, when there is a leaderboard to look at first. */
  onBoard?: () => void;
  onReveal?: () => void;
  /** Search for any title and end the night with it. */
  onPickOther?: () => void;
  /** Open the window with the night's guest link. */
  onInvite?: () => void;
  onCancel?: () => void;
  /** Change who watched the night's title, and when. */
  onEdit?: () => void;
  /** Delete the night. */
  onDelete?: () => void;
  /** A guest takes their name and votes out of the night. */
  onLeave?: () => void;
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
        <h1 className={cn("flex items-center gap-2 font-bold", compact ? "text-lg sm:text-xl" : "text-xl")}>
          <Popcorn className="size-5 shrink-0 text-primary" />
          <span className="truncate">Movie night</span>
          {compact && (
            <span className="truncate text-sm font-normal text-muted-foreground sm:hidden">· {night.group_name}</span>
          )}
        </h1>
        <p className={cn("truncate text-sm text-muted-foreground", compact && "max-sm:hidden")}>
          {night.group_name} · {genres.length > 0 ? genres.join(", ") : "a bit of everything"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onInvite && (
          <Button size="sm" variant="outline" onClick={onInvite} className={cn(compact && "max-sm:px-2")}>
            <UserPlus className="size-4" aria-hidden />
            <span className={cn(compact && "max-sm:sr-only")}>Invite a guest</span>
          </Button>
        )}
      <div ref={menu} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Movie night menu"
          className={cn(
            "flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground",
            compact && "max-sm:size-8",
          )}
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
            {onReveal && (
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
            )}
            {onPickOther && (
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onPickOther();
                }}
              >
                <Search className="size-4" />
                Pick something else
              </button>
            )}
            {onInvite && (
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onInvite();
                }}
              >
                <UserPlus className="size-4" />
                Invite a guest
              </button>
            )}
            {onCancel && (
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
            )}
            {onEdit && (
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
              >
                <Pencil className="size-4" />
                Edit participants
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                role="menuitem"
                className={cn(item, "text-destructive")}
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <Trash2 className="size-4" />
                Delete movie night
              </button>
            )}
            {onLeave && (
              <button
                type="button"
                role="menuitem"
                className={cn(item, "text-destructive")}
                onClick={() => {
                  setOpen(false);
                  onLeave();
                }}
              >
                <LogOut className="size-4" />
                Leave this movie night
              </button>
            )}
            {backHref && (
              <Link role="menuitem" href={backHref} className={item} onClick={() => setOpen(false)}>
                <ArrowLeft className="size-4" />
                Back to Movie night
              </Link>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
