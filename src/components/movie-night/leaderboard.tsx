import { Eye, Heart, Star, ThumbsDown, ThumbsUp } from "lucide-react";

import { MediaPoster } from "@/components/media-poster";
import { formatScore } from "@/lib/format";
import type { NightState } from "@/lib/movie-night";

/** The ranked titles of a night, as far as the viewer may see them. */
export function Leaderboard({ state }: { state: NightState }) {
  const cards = new Map(state.candidates.map((c) => [c.id, c]));
  return (
    <ol className="flex flex-col gap-2">
      {state.results.map((row) => {
        const card = cards.get(row.candidate_id);
        if (!card) return null;
        return (
          <li
            key={row.candidate_id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5"
          >
            <span className="w-7 shrink-0 text-center text-sm font-semibold text-muted-foreground">{row.rank}</span>
            <MediaPoster path={card.poster_path} alt="" size="w92" sizes="48px" className="w-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 font-medium">{card.title}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {card.year ? <span>{card.year}</span> : null}
                {card.rating ? (
                  <span className="inline-flex items-center gap-0.5 text-star">
                    <Star className="size-3 fill-current" />
                    {formatScore(Math.round(card.rating * 10) / 10)}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-0.5" title="Loves">
                  <Heart className="size-3.5 text-pink-500" /> {row.loves}
                </span>
                <span className="inline-flex items-center gap-0.5" title="Yes">
                  <ThumbsUp className="size-3.5 text-like" /> {row.yes}
                </span>
                <span className="inline-flex items-center gap-0.5" title="Seen it, would watch again">
                  <Eye className="size-3.5" /> {row.seen}
                </span>
                <span className="inline-flex items-center gap-0.5" title="Nope">
                  <ThumbsDown className="size-3.5 text-dislike" /> {row.nopes}
                </span>
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-sm font-semibold text-primary">
              {row.points} {Math.abs(row.points) === 1 ? "pt" : "pts"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
