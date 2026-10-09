"use client";

import { Popcorn } from "lucide-react";
import Link from "next/link";

import { useNightStatus } from "@/components/movie-night/night-status";
import { buttonVariants } from "@/components/ui/button";
import { findGenre } from "@/lib/genres";

/** One line per movie night going on in my families, with the way into it (on Home). */
export function NightBanners() {
  const nights = useNightStatus();
  if (nights.length === 0) return null;
  return (
    <section aria-label="Movie nights in progress" className="flex flex-col gap-2">
      {nights.map((night) => {
        const genres = night.genres.map((slug) => findGenre(slug)?.label ?? slug);
        const action = !night.joined ? "Join in" : night.waiting_stacks > 0 ? "Keep swiping" : "See the leaderboard";
        return (
          <div
            key={night.night_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/50 bg-primary/10 px-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Popcorn className="size-5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium">
                  {night.started_by_name ?? "Someone"} started a movie night in {night.group_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {night.done_members} of {night.members} done
                  {genres.length > 0 ? ` · ${genres.join(", ")}` : ""}
                </p>
              </div>
            </div>
            <Link
              href={`/app/movie-night/${night.night_id}`}
              className={buttonVariants({ size: "sm", variant: night.joined && night.waiting_stacks === 0 ? "outline" : "default" })}
            >
              {action}
            </Link>
          </div>
        );
      })}
    </section>
  );
}
