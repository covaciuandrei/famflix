import { episodeLabel } from "@/lib/series";
import { formatDayNumeric, formatRuntime } from "@/lib/format";
import type { TmdbEpisode } from "@/lib/tmdb";
import { cn } from "@/lib/utils";

/** What an episode row says about when it aired. */
function airLine(episode: TmdbEpisode, aired: boolean): string {
  if (!episode.airDate) return "Not aired yet";
  return `${aired ? "Aired" : "Airs"} ${formatDayNumeric(episode.airDate)}`;
}

/**
 * One episode of a season: a tick, its number and name, when it aired and how long it is, and what it is about.
 * Episodes that haven't aired can't be ticked. `onUpTo` (only given when there is something before it to tick) ticks
 * everything up to this episode.
 */
export function EpisodeRow({
  season,
  episode,
  aired,
  ticked,
  onTick,
  onUpTo,
}: {
  season: number;
  episode: TmdbEpisode;
  aired: boolean;
  ticked: boolean;
  onTick: (watched: boolean) => void;
  onUpTo?: () => void;
}) {
  const label = episodeLabel(season, episode.number);
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
      {onUpTo && aired && !ticked && (
        // Always there on a phone; on a computer it shows when the row is hovered or focused, to keep the list calm.
        <button
          type="button"
          onClick={onUpTo}
          className="mb-1 ml-9 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        >
          Mark all up to {label}
        </button>
      )}
    </li>
  );
}
