"use client";

import { MessageSquare, Repeat, Star } from "lucide-react";
import { useState } from "react";

import { EpisodeAgainPanel } from "@/components/series/episode-again";
import { EpisodeRatingPanel } from "@/components/series/episode-rating";
import { WatchedOnDialog } from "@/components/watched-on-dialog";
import { formatDayNumeric, formatRuntime, formatScore } from "@/lib/format";
import { episodeLabel, episodeViewings, type EpisodeEarlier, type EpisodeLog } from "@/lib/series";
import type { TmdbEpisode } from "@/lib/tmdb";
import { cn } from "@/lib/utils";

/** What an episode row says about when it aired. */
function airLine(episode: TmdbEpisode, aired: boolean): string {
  if (!episode.airDate) return "Not aired yet";
  return `${aired ? "Aired" : "Airs"} ${formatDayNumeric(episode.airDate)}`;
}

/**
 * One episode of a season: a tick, its number and name, when it aired and how long it is, and what it is about.
 * Episodes that haven't aired can't be ticked or rated. A button opens the person's own score and note for it, and a
 * ticked episode can be logged as watched again (its days then show: "Watched 2×"). A ticked episode says when it was
 * watched ("Date unknown" when nobody remembers), and that can be changed.
 * `onUpTo` (only given when there is something before it to tick) ticks everything up to this episode.
 */
export function EpisodeRow({
  season,
  episode,
  aired,
  ticked,
  log,
  earlier,
  currentOn,
  onTick,
  onRate,
  onWatchAgain,
  onChangeDay,
  onUpTo,
}: {
  season: number;
  episode: TmdbEpisode;
  aired: boolean;
  ticked: boolean;
  /** The person's own tick for it (its day, score and note), if it has one: a series marked Watched ticks none. */
  log: EpisodeLog | undefined;
  /** The earlier viewings of it (from the history): the days, newest first, and how many have no day. */
  earlier: EpisodeEarlier;
  /** The day it is ticked on now; null when it isn't, or when it is ticked with no known day. */
  currentOn: string | null;
  onTick: (watched: boolean) => void;
  /** Saves a score and/or note; says what went wrong, or nothing. */
  onRate: (score: number | null, comment: string | null) => Promise<string | null>;
  /** Logs it as watched again on a day; says what went wrong, or nothing. */
  onWatchAgain: (on: string) => Promise<string | null>;
  /** Gives it another day (null: nobody remembers it); says what went wrong, or nothing. */
  onChangeDay: (on: string | null) => Promise<string | null>;
  onUpTo?: () => void;
}) {
  const [rating, setRating] = useState(false);
  const [again, setAgain] = useState(false);
  const [changing, setChanging] = useState(false);
  const label = episodeLabel(season, episode.number);
  const score = log?.score ?? null;
  const note = log?.comment ?? null;
  const { times, days, unknown } = episodeViewings(earlier, ticked, currentOn);
  const ownTick = ticked && log !== undefined;
  const dayLabels = [
    ...days.map(formatDayNumeric),
    ...(unknown > 0 ? [unknown === 1 ? "date unknown" : `${unknown} with no date`] : []),
  ];
  return (
    <li className={cn("group py-1", !aired && "opacity-60")}>
      <label
        className={cn(
          "flex items-start gap-3 rounded-lg px-1 py-2",
          aired ? "cursor-pointer hover:bg-muted/40" : "cursor-not-allowed",
        )}
      >
        <input
          type="checkbox"
          checked={ticked}
          disabled={!aired}
          onChange={(e) => onTick(e.target.checked)}
          aria-label={`${label} ${episode.name}`}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium break-words">
            <span className="text-muted-foreground">{episode.number}.</span> {episode.name}
          </span>
          <span className="block text-xs text-muted-foreground">
            {airLine(episode, aired)}
            {episode.runtime ? ` · ${formatRuntime(episode.runtime)}` : ""}
          </span>
          {episode.overview && (
            <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{episode.overview}</span>
          )}
        </span>
      </label>
      {aired && (
        <div className="mb-1 ml-9 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <button
            type="button"
            onClick={() => setRating((open) => !open)}
            aria-expanded={rating}
            aria-label={
              score !== null
                ? `Your rating for ${label}: ${formatScore(score)}`
                : note
                  ? `Your note for ${label}`
                  : `Rate or add a note to ${label}`
            }
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            {score !== null ? (
              <>
                <Star className="size-3.5 fill-star text-star" aria-hidden />
                <span className="font-semibold text-foreground">{formatScore(score)}</span>
              </>
            ) : note ? (
              <>
                <MessageSquare className="size-3.5" aria-hidden />
                Your note
              </>
            ) : (
              <>
                <Star className="size-3.5" aria-hidden />
                Rate / note
              </>
            )}
          </button>
          {onUpTo && !ticked && (
            // Always there on a phone; on a computer it shows when the row is hovered or focused, to keep the list calm.
            <button
              type="button"
              onClick={onUpTo}
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
            >
              Mark all up to {label}
            </button>
          )}
          {ticked && (
            <button
              type="button"
              onClick={() => setAgain((open) => !open)}
              aria-expanded={again}
              aria-label={`Watched ${label} again`}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Repeat className="size-3.5" aria-hidden />
              Watched again
            </button>
          )}
        </div>
      )}
      {(times >= 2 || ownTick) && (
        <p className="mb-1 ml-9 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {times >= 2 ? (
              <>
                <span className="font-medium text-foreground">Watched {times}×</span>
                {dayLabels.length > 0 && ` · ${dayLabels.join(", ")}`}
              </>
            ) : currentOn ? (
              `Watched ${formatDayNumeric(currentOn)}`
            ) : (
              "Date unknown"
            )}
          </span>
          {ownTick && (
            <button
              type="button"
              onClick={() => setChanging(true)}
              aria-label={`Change date for ${label}`}
              className="underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Change date
            </button>
          )}
        </p>
      )}
      {changing && (
        <WatchedOnDialog
          heading={`When did you watch ${label}?`}
          description="Episodes with no day stay ticked, but aren't counted in Your year."
          initial={currentOn}
          onSave={onChangeDay}
          onClose={() => setChanging(false)}
        />
      )}
      {note && !rating && <p className="mb-1 ml-9 text-xs break-words text-muted-foreground">“{note}”</p>}
      {again && <EpisodeAgainPanel label={label} onSave={onWatchAgain} onClose={() => setAgain(false)} />}
      {rating && (
        <EpisodeRatingPanel
          // A new form each time it opens, so it starts from what is saved.
          key={`${score}:${note}`}
          label={label}
          score={score}
          comment={note}
          onSave={onRate}
          onClose={() => setRating(false)}
        />
      )}
    </li>
  );
}
