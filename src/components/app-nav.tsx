"use client";

import {
  Bookmark,
  Compass,
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
import { useDuePlans, useNightStatus, waitingOnMe } from "@/components/movie-night/night-status";
import { RatingRequests } from "@/components/rating-requests";
import { APP_HOME } from "@/lib/constants";
import { plansInWindow } from "@/lib/movie-night-plans";
import { placePopover } from "@/lib/popover";
import type { PendingRating } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const LINKS = [
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

/** Says a movie night is waiting: a dot on the icon, and the same in words for screen readers. */
function NightDot({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden className="absolute -top-0.5 -right-1 size-2 rounded-full bg-primary ring-2 ring-background" />
      <span className="sr-only">({label})</span>
    </>
  );
}

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
  const now = useNow();
  const duePlans = useDuePlans();
  // A night that is waiting on me, or a planned one that is about to start (or just has), unless I'm already in Movie
  // night (where it is right there).
  const inMovieNight = pathname.startsWith("/app/movie-night");
  const nightWaiting = useNightStatus().some(waitingOnMe) && !inMovieNight;
  const planDue = !inMovieNight && now !== null && plansInWindow(duePlans, now).length > 0;
  const dot = nightWaiting
    ? "a movie night is waiting for you"
    : planDue
      ? "a planned movie night is about to start"
      : null;
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <header className="app-nav-header sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href={APP_HOME} className="flex items-center gap-2 font-semibold">
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
                  <span className="relative">
                    <l.icon className="size-4" />
                    {l.href === "/app/movie-night" && dot && <NightDot label={dot} />}
                  </span>
                  {l.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <RatingRequests pending={pending} currentUserId={currentUserId} />
            {/* Phones: the avatar goes straight to Settings (which has Sign out). */}
            <Link
              href="/app/settings"
              aria-label="Settings"
              className="rounded-full p-0.5 sm:hidden"
            >
              <Avatar name={name} url={avatarUrl} className="size-8" />
            </Link>
            <button
              ref={buttonRef}
              type="button"
              popoverTarget={menuId}
              className="hidden items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-muted sm:flex"
            >
              <Avatar name={name} url={avatarUrl} className="size-8" />
              <span className="max-w-24 truncate text-sm font-medium">
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
              <span className="relative">
                <l.icon className="size-5" />
                {l.href === "/app/movie-night" && dot && <NightDot label={dot} />}
              </span>
              {l.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
