"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startDiscover } from "@/app/app/browse/discover/actions";
import { cancelNight, startMovieNight } from "@/app/app/movie-night/actions";
import { MoodPicker, chip } from "@/components/movie-night/mood-picker";
import { NightList, PendingNights } from "@/components/movie-night/night-list";
import { useNightStatus } from "@/components/movie-night/night-status";
import { buttonVariants } from "@/components/ui/button";
import { findGenre } from "@/lib/genres";
import { type HistoryEntry, nightAction } from "@/lib/movie-night";
import { cn } from "@/lib/utils";

/**
 * Picks who is watching (just you, or one of your families), the mood, and starts the night. A family with a night
 * already going gets that night instead of a new one. Beside it (below it on a phone) is the list of movie nights
 * with their status: the chosen family's, or all of mine when it is Just me.
 */
export function Hub({
  families,
  who,
  history,
}: {
  families: { id: string; name: string; members: number }[];
  /** The family chosen in the address, if any. */
  who: string | null;
  /** The first page of nights that are over, for the chosen family or all of mine; null without a family. */
  history: { entries: HistoryEntry[]; hasMore: boolean } | null;
}) {
  const router = useRouter();
  const family = families.find((f) => f.id === who) ?? null;
  // The chosen family's night that is going, kept up to date like the dot on the menu.
  const openNight = useNightStatus().find((n) => n.group_id === family?.id) ?? null;
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
    <div className={cn("grid items-start gap-x-10 gap-y-8", history && "lg:grid-cols-[minmax(0,1fr)_24rem]")}>
      <div className="flex min-w-0 flex-col gap-6">
        {families.length > 0 && (
          <section aria-labelledby="who-title" className="flex flex-col gap-3">
            <h2 id="who-title" className="text-lg font-semibold">
              Who&apos;s watching?
            </h2>
            <nav aria-label="Who is watching" className="flex flex-wrap gap-1.5">
              <Link
                href="/app/movie-night"
                scroll={false}
                aria-current={family ? undefined : "page"}
                className={chip(!family)}
              >
                Just me
              </Link>
              {families.map((f) => (
                <Link
                  key={f.id}
                  href={`/app/movie-night?who=${f.id}`}
                  scroll={false}
                  aria-current={family?.id === f.id ? "page" : undefined}
                  className={cn(chip(family?.id === f.id), "max-w-full truncate")}
                >
                  {f.name} <span className="text-xs opacity-70">{f.members}</span>
                </Link>
              ))}
            </nav>
          </section>
        )}

        {!family && <PendingNights />}

        {family && openNight && inProgress && (
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
        )}

        {!(family && openNight) && (
          <MoodPicker
            start={(options) =>
              family ? startMovieNight({ groupId: family.id, ...options }) : startDiscover(options)
            }
            startLabel={family ? `Start movie night for ${family.name}` : "Start swiping"}
            hint={
              family
                ? `Everyone in ${family.name} gets an invite to swipe too, and the votes decide what to watch.`
                : "Swipe right on what you'd watch. Those go on My list."
            }
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

      {history && (
        <NightList
          // Starts over when the first page changes (a night ended, or another family was chosen).
          key={`${family?.id ?? "all"}:${history.entries.map((e) => e.id).join(",")}`}
          scope={family ? { groupId: family.id, familyName: family.name } : null}
          showFamily={!family && families.length > 1}
          pendingOnTopBelowLg={!family}
          initial={history.entries}
          initialHasMore={history.hasMore}
        />
      )}
    </div>
  );
}
