"use client";

import { Check, Loader2, Repeat } from "lucide-react";
import { useCallback, useMemo, useOptimistic, useRef, useState, useTransition } from "react";

import {
  rateEpisode,
  redateEpisodes,
  tickEpisodes,
  tickNextEpisode,
  watchEpisodeAgain,
  watchSeriesAgain,
  type EpisodeResult,
} from "@/app/app/media/series-actions";
import { SeasonBlock, type SeasonEpisodes } from "@/components/series/season-block";
import { ProgressBar, StatusChip } from "@/components/series/series-progress";
import { Button } from "@/components/ui/button";
import { WatchedOnDialog } from "@/components/watched-on-dialog";
import { WatchedOnLine } from "@/components/watched-on-line";
import { useWatchedPrompt } from "@/components/watched-prompt";
import type { TickedEpisode } from "@/lib/data";
import { localDay } from "@/lib/day";
import { formatDayNumeric } from "@/lib/format";
import {
  airedIn,
  airedTotal,
  applyMark,
  applyRating,
  applyRedate,
  currentPass,
  earlierDays,
  episodeKey,
  episodeLabel,
  episodesBetween,
  isFinished,
  MAX_EPISODES,
  nextUp,
  seasonProgress,
  seriesProgress,
  seriesStatus,
  type EarlierEpisode,
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

/** What the page shows at once, before the database has answered: some episodes ticked, unticked or given a day, or one rated. */
type Change =
  | { mark: Parameters<typeof applyMark>[2] }
  | { rate: Parameters<typeof applyRating>[2] }
  | { redate: Parameters<typeof applyRedate>[2] };

/**
 * Where someone is with a series, and its seasons and episodes to tick: a card with the status, the next episode and
 * buttons for it, then a list of seasons that open to their episodes. Ticks show at once and are saved in the
 * background; the database is what says what is true (an ended series completes by itself, ticking is only for aired
 * episodes), and the page follows it as soon as it answers. Ticking one episode is for today; ticking several asks the
 * day first (it can be "I don't remember", for catching up on a series), and a ticked episode's day can be changed.
 */
export function EpisodeTracker({
  tmdbId,
  title,
  series,
  item,
  ticks,
  history,
  watchedOn,
  initial,
}: {
  tmdbId: number;
  title: string;
  series: SeriesInfo;
  item: TrackerItem | null;
  ticks: TickedEpisode[];
  /** The earlier viewings of its episodes: the passes through the series before this one, and episodes watched again. */
  history: EarlierEpisode[];
  /**
   * When the series was marked Watched, if it is: the day (null when nobody remembers it; an episode it counts without a
   * tick of its own has that day), and whether the person marked it themselves (a family's watch can't be changed here).
   */
  watchedOn: { on: string | null; own: boolean } | null;
  /** The season shown open at first, with its episodes when the server could get them. */
  initial: { season: number; episodes: TmdbEpisode[] | null };
}) {
  const askHowItWas = useWatchedPrompt();
  const completedOn = watchedOn?.on ?? null;
  const base = useMemo<EpisodeState>(
    () => ({
      ticks: new Map(ticks.map((t) => [episodeKey(t.s, t.e), { on: t.on, score: t.score, comment: t.comment }])),
      completed: item?.watched ?? false,
      completedOn,
    }),
    [ticks, item?.watched, completedOn],
  );
  const pass = useMemo(() => currentPass(history), [history]);
  const earlier = useMemo(() => earlierDays(history), [history]);
  const [state, addOptimistic] = useOptimistic(base, (current: EpisodeState, change: Change) =>
    "mark" in change
      ? applyMark(series, current, change.mark)
      : "rate" in change
        ? applyRating(series, current, change.rate)
        : applyRedate(series, current, change.redate),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Several episodes about to be ticked, waiting for the day to be picked.
  const [picking, setPicking] = useState<{ from: EpisodeRef; to: EpisodeRef; count: number } | null>(null);

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

  /**
   * Ticks or unticks a range. `on` is the day an episode was watched on (null: nobody remembers it); left out it is today.
   */
  function mark(watched: boolean, from: EpisodeRef, to: EpisodeRef, on: string | null = localDay()) {
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
    startTransition(async () => {
      addOptimistic({ mark: { watched, from, to, on } });
      afterAction(await tickEpisodes({ tmdbId, watched, from, to, on }));
    });
  }

  /**
   * Ticks a range that is likely to be several episodes: those need a day, which is asked first (a person catching up on a
   * series may not remember it). One episode, or none that isn't ticked yet, is for today at once, like a tick.
   */
  function markRange(watched: boolean, from: EpisodeRef, to: EpisodeRef) {
    if (!watched) return mark(false, from, to);
    const count = episodesBetween(series, from, to).filter(
      ({ s, e }) => e <= airedIn(series, s) && !state.ticks.has(episodeKey(s, e)),
    ).length;
    if (count <= 1) return mark(true, from, to);
    setPicking({ from, to, count });
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

  /** Gives a ticked episode another day (null: nobody remembers it); resolves to what went wrong, or null when it was saved. */
  function changeDay(season: number, episode: number, on: string | null): Promise<string | null> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const ref = { s: season, e: episode };
        addOptimistic({ redate: { from: ref, to: ref, on } });
        const res = item
          ? await redateEpisodes({ itemId: item.id, from: ref, to: ref, on })
          : { error: "Add this series to My list first." };
        resolve(res.error ?? null);
      });
    });
  }

  const upNext = nextUp(series, state.ticks, state.completed);

  /** Logs an episode as watched again on a day; resolves to what went wrong, or null when it was saved. */
  function watchAgain(season: number, episode: number, on: string): Promise<string | null> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const res = item
          ? await watchEpisodeAgain({ itemId: item.id, season, episode, on })
          : { error: "Add this series to My list first." };
        resolve(res.error ?? null);
      });
    });
  }

  function startAgain() {
    if (!item) return;
    if (
      !window.confirm(
        `Start ${title} again? What you've watched of it goes into its history as pass ${pass}, with your scores and notes, and the series is Not started again.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await watchSeriesAgain(item.id);
      if (res.error) setError(res.error);
    });
  }

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
  // A series marked Watched without ticking its episodes: they count as watched on the day it was marked.
  const markedWhole = state.completed && state.ticks.size < airedTotal(series);

  return (
    <section aria-labelledby="episodes-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="episodes-title" className="text-lg font-semibold">
          Episodes
        </h2>
        <StatusChip status={status} finished={finished} />
        {pass > 1 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap">
            <Repeat className="size-3 text-muted-foreground" aria-hidden />
            {status === "completed" ? `Pass ${pass}` : `Watching again · pass ${pass}`}
          </span>
        )}
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
        {item && (status === "completed" || progress.watched > 0) && (
          <Button variant="outline" size="sm" onClick={startAgain} disabled={pending} className="ml-auto">
            <Repeat className="size-4" aria-hidden />
            Start again
          </Button>
        )}
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
                onClick={() => markRange(true, { s: upNext.s, e: 1 }, { s: upNext.s, e: MAX_EPISODES })}
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
        {markedWhole && item && watchedOn?.own && (
          <div className="mt-3">
            <WatchedOnLine itemId={item.id} title={title} day={watchedOn.on} label="Marked watched" />
          </div>
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
            onMark={markRange}
            onRate={rate}
            onWatchAgain={watchAgain}
            onChangeDay={changeDay}
            earlier={earlier}
            firstGap={upNext}
          />
        ))}
      </ul>

      {picking && (
        <WatchedOnDialog
          heading={`When did you watch these ${picking.count} episodes?`}
          description="They are marked as watched on that day. If you don't remember, they stay ticked but aren't counted in Your year."
          label="Watched on"
          submitLabel="Mark watched"
          onSave={async (day) => {
            mark(true, picking.from, picking.to, day);
            return null;
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </section>
  );
}
