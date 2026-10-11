"use client";

import { Check, Loader2 } from "lucide-react";
import { useCallback, useMemo, useOptimistic, useRef, useState, useTransition } from "react";

import { rateEpisode, tickEpisodes, tickNextEpisode, type EpisodeResult } from "@/app/app/media/series-actions";
import { SeasonBlock, type SeasonEpisodes } from "@/components/series/season-block";
import { ProgressBar, StatusChip } from "@/components/series/series-progress";
import { Button } from "@/components/ui/button";
import { useWatchedPrompt } from "@/components/watched-prompt";
import type { TickedEpisode } from "@/lib/data";
import { formatDayNumeric } from "@/lib/format";
import {
  airedIn,
  applyMark,
  applyRating,
  episodeKey,
  episodeLabel,
  episodesBetween,
  isFinished,
  MAX_EPISODES,
  nextUp,
  seasonProgress,
  seriesProgress,
  seriesStatus,
  type EpisodeRef,
  type EpisodeState,
  type SeriesInfo,
} from "@/lib/series";
import type { TmdbEpisode } from "@/lib/tmdb";

/** The series' entry on My list, if it is there. */
export interface TrackerItem {
  id: string;
  watched: boolean;
  /** The person's own score and note for the whole series, which the "How was it?" popup starts from. */
  score: number | null;
  comment: string | null;
}

/** Today in the person's own time, as YYYY-MM-DD. */
const localDay = () => new Date().toLocaleDateString("en-CA");

/** What the page shows at once, before the database has answered: some episodes ticked or unticked, or one rated. */
type Change = { mark: Parameters<typeof applyMark>[2] } | { rate: Parameters<typeof applyRating>[2] };

/**
 * Where someone is with a series, and its seasons and episodes to tick: a card with the status, the next episode and
 * buttons for it, then a list of seasons that open to their episodes. Ticks show at once and are saved in the
 * background; the database is what says what is true (an ended series completes by itself, ticking is only for aired
 * episodes), and the page follows it as soon as it answers.
 */
export function EpisodeTracker({
  tmdbId,
  title,
  series,
  item,
  ticks,
  initial,
}: {
  tmdbId: number;
  title: string;
  series: SeriesInfo;
  item: TrackerItem | null;
  ticks: TickedEpisode[];
  /** The season shown open at first, with its episodes when the server could get them. */
  initial: { season: number; episodes: TmdbEpisode[] | null };
}) {
  const askHowItWas = useWatchedPrompt();
  const base = useMemo<EpisodeState>(
    () => ({
      ticks: new Map(ticks.map((t) => [episodeKey(t.s, t.e), { on: t.on, score: t.score, comment: t.comment }])),
      completed: item?.watched ?? false,
    }),
    [ticks, item?.watched],
  );
  const [state, addOptimistic] = useOptimistic(base, (current: EpisodeState, change: Change) =>
    "mark" in change ? applyMark(series, current, change.mark) : applyRating(series, current, change.rate),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The episodes of each season that has been opened (the first one comes with the page).
  const [loaded, setLoaded] = useState<Record<number, SeasonEpisodes>>(
    initial.episodes ? { [initial.season]: { status: "ready", episodes: initial.episodes } } : {},
  );
  const requested = useRef(new Set<number>(initial.episodes ? [initial.season] : []));
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([initial.season]));

  const need = useCallback(
    (season: number, retry = false) => {
      if (requested.current.has(season) && !retry) return;
      requested.current.add(season);
      setLoaded((prev) => ({ ...prev, [season]: { status: "loading" } }));
      fetch(`/api/tv/${tmdbId}/season/${season}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as { episodes: TmdbEpisode[] };
          setLoaded((prev) => ({ ...prev, [season]: { status: "ready", episodes: data.episodes } }));
        })
        .catch(() => setLoaded((prev) => ({ ...prev, [season]: { status: "failed" } })));
    },
    [tmdbId],
  );

  function toggle(season: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(season)) next.add(season);
      return next;
    });
  }

  function afterAction(res: EpisodeResult) {
    if (res.error) {
      setError(res.error);
      return;
    }
    // Ticking the last episode of a series that has ended makes it Watched: ask how it was, like marking it watched.
    if (res.completed && res.itemId) {
      askHowItWas({ itemId: res.itemId, title, score: item?.score ?? null, comment: item?.comment ?? null });
    }
  }

  function mark(watched: boolean, from: EpisodeRef, to: EpisodeRef) {
    if (!watched) {
      // Unticking takes an episode's score and note with it, so that is asked first.
      const rated = episodesBetween(series, from, to).filter(({ s, e }) => {
        const log = state.ticks.get(episodeKey(s, e));
        return !!log && (log.score !== null || !!log.comment);
      });
      if (
        rated.length > 0 &&
        !window.confirm(
          rated.length === 1
            ? `Unticking ${episodeLabel(rated[0].s, rated[0].e)} also removes your score and note for it. Continue?`
            : `Unticking these episodes also removes your scores and notes for ${rated.length} of them. Continue?`,
        )
      ) {
        return;
      }
    }
    setError(null);
    const on = localDay();
    startTransition(async () => {
      addOptimistic({ mark: { watched, from, to, on } });
      afterAction(await tickEpisodes({ tmdbId, watched, from, to, on }));
    });
  }

  /** Saves the person's score and/or note for an episode; resolves to what went wrong, or null when it was saved. */
  function rate(season: number, episode: number, score: number | null, comment: string | null): Promise<string | null> {
    const on = localDay();
    return new Promise((resolve) => {
      startTransition(async () => {
        addOptimistic({ rate: { season, episode, score, comment, on } });
        const res = await rateEpisode({ tmdbId, season, episode, score, comment });
        if (!res.error) afterAction(res);
        resolve(res.error ?? null);
      });
    });
  }

  const upNext = nextUp(series, state.ticks, state.completed);

  function markNext() {
    setError(null);
    const on = localDay();
    startTransition(async () => {
      if (upNext) addOptimistic({ mark: { watched: true, from: upNext, to: upNext, on } });
      afterAction(await tickNextEpisode({ tmdbId, on }));
    });
  }

  const progress = seriesProgress(series, state.ticks, state.completed);
  const status = seriesStatus(series, state.ticks, state.completed);
  const finished = isFinished(series);
  const nextSeason = upNext ? loaded[upNext.s] : undefined;
  const nextName =
    upNext && nextSeason?.status === "ready"
      ? nextSeason.episodes.find((e) => e.number === upNext.e)?.name
      : undefined;
  const leftInSeason = upNext
    ? airedIn(series, upNext.s) - seasonProgress(series, upNext.s, state.ticks, false).watched
    : 0;

  return (
    <section aria-labelledby="episodes-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="episodes-title" className="text-lg font-semibold">
          Episodes
        </h2>
        <StatusChip status={status} finished={finished} />
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <ProgressBar value={progress.watched} max={progress.aired} label="Episodes watched" />
        <p className="mt-2 text-sm text-muted-foreground">
          {progress.watched} of {progress.aired} aired episodes watched
          {progress.total > progress.aired ? ` · ${progress.total - progress.aired} still to air` : ""}
        </p>

        {upNext ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={markNext}>
              <Check className="size-4" aria-hidden />
              Watched {episodeLabel(upNext.s, upNext.e)}
            </Button>
            {leftInSeason > 1 && (
              <Button
                variant="outline"
                onClick={() => mark(true, { s: upNext.s, e: 1 }, { s: upNext.s, e: MAX_EPISODES })}
              >
                Mark rest of season {upNext.s} watched
              </Button>
            )}
            <span className="text-sm text-muted-foreground">
              Next: {episodeLabel(upNext.s, upNext.e)}
              {nextName ? ` · ${nextName}` : ""}
            </span>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {status === "completed"
              ? "You've watched all of it. Untick an episode to go back to watching."
              : progress.aired === 0
                ? "No episode has aired yet."
                : finished
                  ? "Every episode is ticked."
                  : "You're all caught up."}
            {status !== "completed" && series.nextAir ? ` The next episode airs ${formatDayNumeric(series.nextAir)}.` : ""}
          </p>
        )}
        {!item && (
          <p className="mt-3 text-xs text-muted-foreground">Ticking an episode puts this series on My list.</p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {series.seasons.map((season) => (
          <SeasonBlock
            key={season.n}
            info={series}
            season={season}
            state={state}
            open={open.has(season.n)}
            onToggle={() => toggle(season.n)}
            loaded={loaded[season.n]}
            onNeed={need}
            onMark={mark}
            onRate={rate}
            firstGap={upNext}
          />
        ))}
      </ul>
    </section>
  );
}
