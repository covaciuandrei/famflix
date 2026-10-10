"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cancelNight, startMovieNight } from "@/app/app/movie-night/actions";
import { MoodPicker, chip } from "@/components/movie-night/mood-picker";
import { NightList } from "@/components/movie-night/night-list";
import { useNightStatus, waitingOnMe } from "@/components/movie-night/night-status";
import { buttonVariants } from "@/components/ui/button";
import { findGenre } from "@/lib/genres";
import { type HistoryEntry, nightAction } from "@/lib/movie-night";
import { cn } from "@/lib/utils";

/**
 * Starts a movie night for a family: the mood, then the stack everyone in the family swipes. With more than one family
 * you pick which (a dot says where a night is waiting for you). A family with a night already going gets that night
 * instead of the form. Beside it (below it on a phone) is the list of that family's movie nights with their status.
 */
export function Hub({
  families,
  selectedId,
  history,
}: {
  /** Every family I'm in, oldest first. Never empty: without one there is nothing to start. */
  families: { id: string; name: string; members: number }[];
  /** The family being looked at: the one in the address, or the first. */
  selectedId: string;
  /** The first page of that family's nights that are over. */
  history: { entries: HistoryEntry[]; hasMore: boolean };
}) {
  const router = useRouter();
  const family = families.find((f) => f.id === selectedId) ?? families[0];
  const nights = useNightStatus();
  // The chosen family's night that is going, kept up to date like the dot on the menu.
  const openNight = nights.find((n) => n.group_id === family.id) ?? null;
  const waitingIn = new Set(nights.filter(waitingOnMe).map((n) => n.group_id));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function cancelOpenNight() {
    if (!openNight || !window.confirm("Cancel this movie night for everyone? Its votes stay in the history.")) return;
    setError(null);
    start(async () => {
      const res = await cancelNight(openNight.night_id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  const inProgress = openNight ? nightAction(openNight) : null;

  return (
    // On a computer the list of movie nights sits beside the form; everywhere else it is one column.
    <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {families.length > 1 && (
          <section aria-labelledby="family-title" className="flex flex-col gap-3">
            <h2 id="family-title" className="text-lg font-semibold">
              Which family?
            </h2>
            <nav aria-label="Choose a family" className="flex flex-wrap gap-1.5">
              {families.map((f) => (
                <Link
                  key={f.id}
                  href={`/app/movie-night?who=${f.id}`}
                  scroll={false}
                  aria-current={family.id === f.id ? "page" : undefined}
                  className={cn(chip(family.id === f.id), "inline-flex max-w-full items-center gap-1.5")}
                >
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs opacity-70">{f.members}</span>
                  {family.id !== f.id && waitingIn.has(f.id) && (
                    <>
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
                      <span className="sr-only">(a movie night is waiting for you)</span>
                    </>
                  )}
                </Link>
              ))}
            </nav>
          </section>
        )}

        {openNight && inProgress ? (
          <section
            aria-label="Movie night in progress"
            className="flex flex-col gap-3 rounded-2xl border border-primary/50 bg-primary/10 p-4"
          >
            <div>
              <p className="text-xs font-semibold tracking-wide text-primary uppercase">Movie night in progress</p>
              <p className="mt-1 text-lg font-semibold">
                {openNight.started_by_name ?? "Someone"} started a movie night for {family.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {openNight.done_members} of {openNight.members} done
                {openNight.genres.length > 0
                  ? ` · ${openNight.genres.map((g) => findGenre(g)?.label ?? g).join(", ")}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/app/movie-night/${openNight.night_id}`} className={buttonVariants()}>
                {inProgress}
              </Link>
              <button
                type="button"
                onClick={cancelOpenNight}
                disabled={pending}
                className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
              >
                Cancel it
              </button>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </section>
        ) : (
          <MoodPicker
            allowSeries={false}
            start={({ genres, count, max }) => startMovieNight({ groupId: family.id, genres, count, max })}
            startLabel={`Start movie night for ${family.name}`}
            hint={`Everyone in ${family.name} gets an invite to swipe too, and the votes decide what to watch.`}
          />
        )}

        <p className="text-sm text-muted-foreground">
          Rather look through everything on your lists?{" "}
          <Link href="/app/movie-night/list" className="underline underline-offset-2 hover:text-foreground">
            Browse your To watch list
          </Link>
          .
        </p>
      </div>

      <NightList
        // Starts over when the first page changes (a night ended, or another family was chosen).
        key={`${family.id}:${history.entries.map((e) => e.id).join(",")}`}
        scope={{ groupId: family.id, familyName: family.name }}
        initial={history.entries}
        initialHasMore={history.hasMore}
      />
    </div>
  );
}
