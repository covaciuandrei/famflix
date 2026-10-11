"use client";

import { Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { tickNextEpisode } from "@/app/app/media/series-actions";
import { ProgressBar, StatusChip } from "@/components/series/series-progress";
import { Button } from "@/components/ui/button";
import { useWatchedPrompt } from "@/components/watched-prompt";
import { formatDayNumeric } from "@/lib/format";
import { airedTotal, episodeLabel, isFinished, parseSeriesInfo, type SeriesStatus } from "@/lib/series";
import type { ListItemCard } from "@/lib/types";

/**
 * On a series on My list that has episodes ticked (and isn't marked watched): where the person is, how far, and a
 * one-tap button for the next episode. Everything else about it (the seasons, scores and notes) is on its page.
 */
export function SeriesCardLine({ card }: { card: ListItemCard }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const askHowItWas = useWatchedPrompt();

  const info = parseSeriesInfo(card.media.series);
  const progress = card.series;
  if (!info || !progress || card.item.group_id || card.item.status === "watched") return null;

  const aired = airedTotal(info);
  const status: SeriesStatus = aired > 0 && progress.watched >= aired ? "caught-up" : "watching";
  const next = progress.next;

  function tick() {
    setError(null);
    start(async () => {
      const res = await tickNextEpisode({ tmdbId: card.media.tmdb_id, on: new Date().toLocaleDateString("en-CA") });
      if (res.error) setError(res.error);
      else if (res.completed && res.itemId) {
        askHowItWas({ itemId: res.itemId, title: card.media.title, score: card.myScore, comment: card.myComment });
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusChip status={status} finished={isFinished(info)} />
        <span className="text-xs text-muted-foreground">
          {progress.watched} of {aired} aired episodes
        </span>
      </div>
      <ProgressBar value={progress.watched} max={aired} label={`${card.media.title} progress`} />
      {next ? (
        <div>
          <Button size="sm" variant="outline" onClick={tick} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" aria-hidden />}
            Watched {episodeLabel(next.s, next.e)}
          </Button>
        </div>
      ) : (
        info.nextAir && (
          <p className="text-xs text-muted-foreground">Next episode airs {formatDayNumeric(info.nextAir)}.</p>
        )
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
