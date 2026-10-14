"use client";

import { Check, Eye, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { markWatched, toggleWatched } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { useWatchedPrompt } from "@/components/watched-prompt";
import { localDay } from "@/lib/day";
import type { MediaType } from "@/lib/types";

/** On a title's page: marks it watched on My list (adding it there if needed), then asks how it was. */
export function MarkWatchedButton({
  tmdbId,
  mediaType,
  title,
  mine,
}: {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  /** The title on My list, if it's there. */
  mine: {
    itemId: string;
    watched: boolean;
    score: number | null;
    comment: string | null;
  } | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const askHowItWas = useWatchedPrompt();
  const watched = mine?.watched ?? false;

  function click() {
    setError(null);
    start(async () => {
      if (mine && watched) {
        const res = await toggleWatched(mine.itemId, false);
        if (res.error) setError(res.error);
        return;
      }
      const watchedOn = localDay();
      const res = await markWatched({ tmdbId, mediaType, watchedOn });
      if (res.error || !res.itemId) {
        setError(res.error ?? "Couldn't mark it as watched. Please try again.");
        return;
      }
      askHowItWas({
        itemId: res.itemId,
        title,
        score: mine?.score ?? null,
        comment: mine?.comment ?? null,
        watchedOn,
      });
    });
  }

  return (
    <div>
      <Button
        variant={watched ? "secondary" : "outline"}
        onClick={click}
        disabled={pending}
        title={watched ? "Watched (on My list). Click to mark it as not watched." : undefined}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : watched ? (
          <Check className="size-4 text-like" />
        ) : (
          <Eye className="size-4" />
        )}
        {watched ? "Watched" : "Mark as watched"}
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
