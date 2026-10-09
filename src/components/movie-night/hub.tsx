"use client";

import { ChevronDown, Loader2, Play } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { startSoloStack } from "@/app/app/movie-night/actions";
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

/** Picks the mood for a movie night and starts it. */
export function Hub() {
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
      // Redirects to the stack when it works.
      const res = await startSoloStack({ genres, series, count, max: maxRuntime });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
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
        <Button size="lg" onClick={go} disabled={pending || seriesOnly}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
          Start swiping
        </Button>
        <p className="text-sm text-muted-foreground">
          Swipe right on what you&apos;d watch. Those go on My list.
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Rather look through everything on your lists?{" "}
        <Link href="/app/movie-night/list" className="underline underline-offset-2 hover:text-foreground">
          Browse your To watch list
        </Link>
        .
      </p>
    </div>
  );
}
