"use client";

import { BookOpen, Brain, ChevronDown, Ghost, Laugh, Loader2, Mountain, Play, Sofa, Users, Zap, type LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { BROWSE_GENRES, findGenre } from "@/lib/genres";
import {
  DEFAULT_STACK_SIZE,
  MAX_GENRES,
  MOODS,
  RUNTIME_LIMITS,
  STACK_SIZES,
  type StackSize,
} from "@/lib/movie-night";
import { cn } from "@/lib/utils";

/** A pill, for a genre or for choosing among a few things. */
export const chip = (active: boolean) =>
  cn(
    "rounded-full border border-border px-3 py-1 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
    active && "border-primary bg-primary/15 text-foreground",
  );

// A mood is a ready-made mix of genres, so it is drawn as a tile with its own picture, not as another genre pill.
const MOOD_ICONS: Record<(typeof MOODS)[number]["slug"], LucideIcon> = {
  laugh: Laugh,
  cozy: Sofa,
  edge: Zap,
  mind: Brain,
  adventure: Mountain,
  scare: Ghost,
  family: Users,
  true: BookOpen,
};

// Side by side on a phone (two to a row); on wider screens the picture is above the name so the names fit on a line.
const moodTile = (active: boolean) =>
  cn(
    "flex items-center gap-2.5 rounded-xl border p-1.5 pr-2.5 text-left text-sm leading-tight font-medium text-foreground transition-colors sm:flex-col sm:justify-center sm:gap-1.5 sm:px-1.5 sm:py-2.5 sm:text-center sm:text-[13px]",
    active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50",
  );

const groupLabel = "text-xs font-semibold tracking-wide text-muted-foreground uppercase";

const segment = (active: boolean) =>
  cn(
    "rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
    active && "bg-muted text-foreground",
  );

function sameGenres(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((g) => b.includes(g));
}

/** What someone picked for a stack. */
export interface StackOptions {
  genres: string[];
  series: boolean;
  count: StackSize;
  max: number | null;
}

/**
 * The mood, the genres and a few options for a stack of titles to swipe through, and the button that starts it. Used
 * for Discover (a stack of your own) and for a family's movie night; what starting does is up to the caller.
 */
export function MoodPicker({
  start,
  startLabel,
  hint,
  allowSeries = true,
}: {
  /** Starts the stack. It redirects to it when it works, so it only comes back with a problem to show. */
  start: (options: StackOptions) => Promise<{ error?: string } | void>;
  startLabel: string;
  /** A line under the button about what happens next. */
  hint: string;
  /** Whether the stack may have series: Discover's can, a family's movie night is for movies only. */
  allowSeries?: boolean;
}) {
  const [genres, setGenres] = useState<string[]>([]);
  const [series, setSeries] = useState(false);
  const [count, setCount] = useState<StackSize>(DEFAULT_STACK_SIZE);
  const [maxRuntime, setMaxRuntime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Some categories only exist for series (Kids), so with series off they'd find nothing; a stack of movies has none.
  const genreChips = allowSeries ? BROWSE_GENRES : BROWSE_GENRES.filter((genre) => genre.movie !== null);
  const seriesOnly =
    allowSeries && genres.length > 0 && !series && genres.every((slug) => findGenre(slug)?.movie === null);

  function toggleGenre(slug: string) {
    setGenres((current) =>
      current.includes(slug) ? current.filter((g) => g !== slug) : [...current, slug].slice(0, MAX_GENRES),
    );
  }

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await start({ genres, series: allowSeries && series, count, max: maxRuntime });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="mood-title" className="flex flex-col gap-4">
        <div>
          <h2 id="mood-title" className="text-lg font-semibold">
            What are you in the mood for?
          </h2>
          <p className="text-sm text-muted-foreground">
            Pick a mood to start from, or mix your own from the genres. No pick means a bit of everything.
            {!allowSeries && " Movie nights are for movies; series are tracked on My list."}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="flex items-baseline gap-2">
            <span id="moods-label" className={groupLabel}>
              Moods
            </span>
            <span className="text-xs text-muted-foreground">a ready-made mix of genres</span>
          </p>
          <div role="group" aria-labelledby="moods-label" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MOODS.map((mood) => {
              const active = sameGenres(genres, mood.genres);
              const Icon = MOOD_ICONS[mood.slug];
              return (
                <button
                  key={mood.slug}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setGenres(active ? [] : [...mood.genres])}
                  className={moodTile(active)}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg",
                      active ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  {mood.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="flex items-baseline gap-2">
            <span id="genres-label" className={groupLabel}>
              Genres
            </span>
            <span className="text-xs text-muted-foreground">up to {MAX_GENRES}</span>
          </p>
          <div role="group" aria-labelledby="genres-label" className="flex flex-wrap gap-1.5">
            {genreChips.map((genre) => {
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
        </div>
      </section>

      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium select-none">
          <span>
            More options
            <span className="ml-2 font-normal text-muted-foreground">
              {count} cards{allowSeries && series ? ", with series" : ""}
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
          {allowSeries && (
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
          )}
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
          {startLabel}
        </Button>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
