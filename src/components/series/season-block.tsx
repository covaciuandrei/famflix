"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { EpisodeRow } from "@/components/series/episode-row";
import { ProgressBar } from "@/components/series/series-progress";
import { Button } from "@/components/ui/button";
import {
  airedIn,
  episodeKey,
  isTicked,
  NO_EARLIER,
  seasonProgress,
  type EpisodeEarlier,
  type EpisodeRef,
  type EpisodeState,
  type SeasonInfo,
  type SeriesInfo,
} from "@/lib/series";
import type { TmdbEpisode } from "@/lib/tmdb";
import { cn } from "@/lib/utils";

/** A long season shows this many episodes, then a button for the rest. */
const FIRST_EPISODES = 50;

/** What the page knows of a season's episodes: not asked yet, being asked, here, or failed. */
export type SeasonEpisodes = { status: "loading" } | { status: "ready"; episodes: TmdbEpisode[] } | { status: "failed" };

/**
 * One season of a series: its name, how far along it is and a button for ticking all of it, and (once opened) its
 * episodes, which are fetched when the season is first opened.
 */
export function SeasonBlock({
  info,
  season,
  state,
  open,
  onToggle,
  loaded,
  onNeed,
  onMark,
  onRate,
  onWatchAgain,
  onChangeDay,
  earlier,
  firstGap,
}: {
  info: SeriesInfo;
  season: SeasonInfo;
  state: EpisodeState;
  open: boolean;
  onToggle: () => void;
  /** What is known of this season's episodes (kept above, so the next-up line can name an episode). */
  loaded: SeasonEpisodes | undefined;
  /** Asks for the season's episodes (once; again when `retry`). */
  onNeed: (season: number, retry?: boolean) => void;
  onMark: (watched: boolean, from: EpisodeRef, to: EpisodeRef) => void;
  /** Saves a score and/or note for an episode; says what went wrong, or nothing. */
  onRate: (season: number, episode: number, score: number | null, comment: string | null) => Promise<string | null>;
  /** Logs an episode as watched again on a day; says what went wrong, or nothing. */
  onWatchAgain: (season: number, episode: number, on: string) => Promise<string | null>;
  /** Gives a ticked episode another day (null: nobody remembers it); says what went wrong, or nothing. */
  onChangeDay: (season: number, episode: number, on: string | null) => Promise<string | null>;
  /** The earlier viewings of each episode (from the history), by episodeKey(). */
  earlier: ReadonlyMap<string, EpisodeEarlier>;
  /** The first aired episode that isn't ticked (where "up to here" starts to mean something). */
  firstGap: EpisodeRef | null;
}) {
  const [showAll, setShowAll] = useState(false);

  // A season's episodes are fetched when it is first opened.
  useEffect(() => {
    if (open && loaded === undefined) onNeed(season.n);
  }, [open, loaded, season.n, onNeed]);

  const aired = airedIn(info, season.n);
  const progress = seasonProgress(info, season.n, state.ticks, state.completed);
  const done = aired > 0 && progress.watched >= aired;
  const episodes = loaded?.status === "ready" ? loaded.episodes.filter((e) => e.number <= season.episodes) : [];
  const shown = showAll ? episodes : episodes.slice(0, FIRST_EPISODES);
  const panel = `season-${season.n}-episodes`;

  return (
    <li className="rounded-xl border border-border">
      <div className="flex items-center gap-2 p-2 sm:p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panel}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:gap-3"
        >
          <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
          <span className="font-semibold whitespace-nowrap">Season {season.n}</span>
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {progress.watched}/{aired}
            {aired < season.episodes ? ` of ${season.episodes}` : ""}
          </span>
          <ProgressBar
            value={progress.watched}
            max={aired}
            label={`Season ${season.n} progress`}
            className="hidden w-24 shrink-0 sm:block"
          />
        </button>
        <Button
          size="sm"
          variant={done ? "ghost" : "outline"}
          disabled={aired === 0}
          onClick={() => onMark(!done, { s: season.n, e: 1 }, { s: season.n, e: season.episodes })}
          aria-label={done ? `Unmark season ${season.n}` : `Mark season ${season.n} watched`}
          className="shrink-0"
        >
          {done ? "Unmark" : "Mark watched"}
        </Button>
      </div>

      {open && (
        <div id={panel} className="border-t border-border px-2 pb-2 sm:px-3">
          {(loaded === undefined || loaded.status === "loading") && (
            <p role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading episodes…
            </p>
          )}
          {loaded?.status === "failed" && (
            <p role="alert" className="flex flex-wrap items-center gap-3 py-4 text-sm text-destructive">
              Couldn&apos;t load this season.
              <Button size="sm" variant="outline" onClick={() => onNeed(season.n, true)}>
                Try again
              </Button>
            </p>
          )}
          {loaded?.status === "ready" && episodes.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">No episodes are listed for this season yet.</p>
          )}
          {shown.length > 0 && (
            <ul className="divide-y divide-border/60">
              {shown.map((episode) => {
                const isAired = episode.number <= aired;
                const afterGap =
                  firstGap !== null &&
                  (season.n > firstGap.s || (season.n === firstGap.s && episode.number > firstGap.e));
                const key = episodeKey(season.n, episode.number);
                const log = state.ticks.get(key);
                return (
                  <EpisodeRow
                    key={key}
                    season={season.n}
                    episode={episode}
                    aired={isAired}
                    ticked={isTicked(info, state, season.n, episode.number)}
                    log={log}
                    earlier={earlier.get(key) ?? NO_EARLIER}
                    // A series marked Watched gives an episode with no tick of its own the day it was marked.
                    currentOn={log ? log.on : state.completed ? (state.completedOn ?? null) : null}
                    onRate={(score, comment) => onRate(season.n, episode.number, score, comment)}
                    onWatchAgain={(on) => onWatchAgain(season.n, episode.number, on)}
                    onChangeDay={(on) => onChangeDay(season.n, episode.number, on)}
                    onTick={(watched) =>
                      onMark(watched, { s: season.n, e: episode.number }, { s: season.n, e: episode.number })
                    }
                    onUpTo={
                      afterGap
                        ? () => onMark(true, { s: info.seasons[0].n, e: 1 }, { s: season.n, e: episode.number })
                        : undefined
                    }
                  />
                );
              })}
            </ul>
          )}
          {!showAll && episodes.length > FIRST_EPISODES && (
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => setShowAll(true)}>
              Show all {episodes.length} episodes
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
