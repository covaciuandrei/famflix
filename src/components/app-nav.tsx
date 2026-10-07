"use client";

import {
  Bookmark,
  Compass,
  Home,
  LogOut,
  Popcorn,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef } from "react";

import { signOut } from "@/app/login/actions";
import { Avatar } from "@/components/avatar";
import { RatingRequests } from "@/components/rating-requests";
import { placePopover } from "@/lib/popover";
import type { PendingRating } from "@/lib/types";
import { cn } from "@/lib/utils";

const LINKS = [
  {
    href: "/app",
    label: "Home",
    icon: Home,
    match: (p: string) => p === "/app",
  },
  {
    href: "/app/browse",
    label: "Browse",
    icon: Compass,
    match: (p: string) => p.startsWith("/app/browse"),
  },
  {
    href: "/app/movie-night",
    label: "Movie night",
    icon: Popcorn,
    match: (p: string) => p.startsWith("/app/movie-night"),
  },
  {
    href: "/app/mine",
    label: "My list",
    icon: Bookmark,
    match: (p: string) => p.startsWith("/app/mine"),
  },
  {
    href: "/app/groups",
    label: "Families",
    icon: Users,
    match: (p: string) =>
      p.startsWith("/app/groups") || p.startsWith("/app/family"),
  },
];

export function AppNav({
  name,
  avatarUrl,
  currentUserId,
  pending,
}: {
  name: string;
  avatarUrl: string | null;
  currentUserId: string;
  pending: PendingRating[];
}) {
  const pathname = usePathname();
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/app" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
              ▶
            </span>
            FamFlix
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {LINKS.map((l) => {
              const active = l.match(pathname);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-muted text-foreground",
                  )}
                >
                  <l.icon className="size-4" />
                  {l.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <RatingRequests pending={pending} currentUserId={currentUserId} />
            <button
              ref={buttonRef}
              type="button"
              popoverTarget={menuId}
              className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-muted"
            >
              <Avatar name={name} url={avatarUrl} className="size-8" />
              <span className="hidden max-w-24 truncate text-sm font-medium sm:inline">
                {name}
              </span>
            </button>
            {/* Top layer: the header's backdrop-blur would confine fixed-position children to the header. */}
            <div
              ref={menuRef}
              id={menuId}
              popover="auto"
              onBeforeToggle={(e) =>
                placePopover(e, () => buttonRef.current, 8)
              }
              className="inset-auto w-44 overflow-hidden rounded-lg border border-border bg-card p-1 text-card-foreground shadow-lg"
            >
              <Link
                href="/app/settings"
                onClick={() => menuRef.current?.hidePopover()}
                className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
              >
                <Settings className="size-4" />
                Settings
              </Link>
              <form action={signOut}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-destructive hover:bg-muted"
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-border bg-background/95 backdrop-blur sm:hidden">
        {LINKS.map((l) => {
          const active = l.match(pathname);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-muted-foreground",
                active && "text-primary",
              )}
            >
              <l.icon className="size-5" />
              {l.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
