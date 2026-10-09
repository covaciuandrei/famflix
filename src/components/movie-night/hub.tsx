"use client";

import { ChevronDown, Loader2, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cancelNight, startMovieNight, startSoloStack } from "@/app/app/movie-night/actions";
import { useNightStatus } from "@/components/movie-night/night-status";
import { NightList, PendingNights } from "@/components/movie-night/night-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { BROWSE_GENRES, findGenre } from "@/lib/genres";
import {
  DEFAULT_STACK_SIZE,
  type HistoryEntry,
  MAX_GENRES,
  MOODS,
  nightAction,
  RUNTIME_LIMITS,
  STACK_SIZES,
  type StackSize,
} from "@/lib/movie-night";
import { cn } from "@/lib/utils";

const chip = (active: boolean) =>
  cn(
    "rounded-full border border-border px-3 py-1 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
    active && "border-primary bg-primary/15 text-foreground",
  );

const segment = (active: boolean) =>
  cn(
    "rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
    active && "bg-muted text-foreground",
  );

function sameGenres(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((g) => b.includes(g));
}

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
  const [genres, setGenres] = useState<string[]>([]);
  const [series, setSeries] = useState(false);
  const [count, setCount] = useState<StackSize>(DEFAULT_STACK_SIZE);
  const [maxRuntime, setMaxRuntime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Some categories only exist for series (Kids), so with series off they'd find nothing.
  const seriesOnly =
    genres.length > 0 && !series && genres.every((slug) => findGenre(slug)?.movie === null);

  function toggleGenre(slug: string) {
    setGenres((current) =>
      current.includes(slug) ? current.filter((g) => g !== slug) : [...current, slug].slice(0, MAX_GENRES),
    );
  }

  function go() {
    setError(null);
    start(async () => {
      // Redirects to the stack (or the family's night) when it works.
      const options = { genres, series, count, max: maxRuntime };
      const res = family
        ? await startMovieNight({ groupId: family.id, ...options })
        : await startSoloStack(options);
      if (res?.error) setError(res.error);
    });
  }

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
          <>
            <section aria-labelledby="mood-title" className="flex flex-col gap-3">
              <div>
                <h2 id="mood-title" className="text-lg font-semibold">
                  What are you in the mood for?
                </h2>
                <p className="text-sm text-muted-foreground">
                  Pick a mood or a few genres. No pick means a bit of everything.
                </p>
              </div>
              <div role="group" aria-label="Moods" className="flex flex-wrap gap-1.5">
                {MOODS.map((mood) => {
                  const active = sameGenres(genres, mood.genres);
                  return (
                    <button
                      key={mood.slug}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setGenres(active ? [] : [...mood.genres])}
                      className={chip(active)}
                    >
                      {mood.label}
                    </button>
                  );
                })}
              </div>
              <div role="group" aria-label="Genres" className="flex flex-wrap gap-1.5">
                {BROWSE_GENRES.map((genre) => {
                  const active = genres.includes(genre.slug);
                  return (
                    <button
                      key={genre.slug}
                      type="button"
                      aria-pressed={active}
                      disabled={!active && genres.length >= MAX_GENRES}
                      title={!active && genres.length >= MAX_GENRES ? `Up to ${MAX_GENRES} genres` : undefined}
                      onClick={() => toggleGenre(genre.slug)}
                      className={chip(active)}
                    >
                      {genre.label}
                    </button>
                  );
                })}
              </div>
              {genres.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {genres.length} of {MAX_GENRES} genres.{" "}
                  <button type="button" onClick={() => setGenres([])} className="underline underline-offset-2 hover:text-foreground">
                    Clear
                  </button>
                </p>
              )}
            </section>

            <details className="group rounded-xl border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium select-none">
                <span>
                  More options
                  <span className="ml-2 font-normal text-muted-foreground">
                    {count} cards{series ? ", with series" : ""}
                    {maxRuntime ? `, up to ${maxRuntime} min` : ""}
                  </span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">Cards in the stack</span>
                  <div role="group" aria-label="Cards in the stack" className="inline-flex rounded-lg border border-border p-0.5">
                    {STACK_SIZES.map((size) => (
                      <button key={size} type="button" aria-pressed={count === size} onClick={() => setCount(size)} className={segment(count === size)}>
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">Include series</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={series}
                    aria-label="Include series"
                    onClick={() => setSeries((on) => !on)}
                    className={cn(
                      "relative h-6 w-11 rounded-full border border-border transition-colors",
                      series ? "bg-primary" : "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform",
                        series && "translate-x-5",
                      )}
                    />
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">Movie length</span>
                  <div role="group" aria-label="Movie length" className="inline-flex rounded-lg border border-border p-0.5">
                    <button type="button" aria-pressed={maxRuntime === null} onClick={() => setMaxRuntime(null)} className={segment(maxRuntime === null)}>
                      Any
                    </button>
                    {RUNTIME_LIMITS.map((limit) => (
                      <button key={limit} type="button" aria-pressed={maxRuntime === limit} onClick={() => setMaxRuntime(limit)} className={segment(maxRuntime === limit)}>
                        Under {limit} min
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </details>

            {seriesOnly && (
              <p role="status" className="text-sm text-amber-500">
                Kids only has series. Turn on Include series (under More options), or pick another genre.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-col items-start gap-2">
              <Button size="lg" onClick={go} disabled={pending || seriesOnly} className="h-auto min-h-11 max-w-full py-2 whitespace-normal">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
                {family ? `Start movie night for ${family.name}` : "Start swiping"}
              </Button>
              <p className="text-sm text-muted-foreground">
                {family
                  ? `Everyone in ${family.name} gets an invite to swipe too, and the votes decide what to watch.`
                  : "Swipe right on what you'd watch. Those go on My list."}
              </p>
            </div>
          </>
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
