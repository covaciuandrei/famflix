"use client";

import { Check, Eye, Loader2 } from "lucide-react";
import { useTransition } from "react";

import { toggleWatched } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { useWatchedPrompt } from "@/components/watched-prompt";
import { localDay } from "@/lib/day";

export function WatchedToggle({
  itemId,
  watched,
  title,
  myScore,
  myComment,
  personal,
}: {
  itemId: string;
  watched: boolean;
  title: string;
  myScore: number | null;
  myComment: string | null;
  /** On My list: the day it was watched on is the person's to pick (the popup after marking asks). */
  personal: boolean;
}) {
  const [pending, start] = useTransition();
  const askHowItWas = useWatchedPrompt();

  return (
    <Button
      variant={watched ? "secondary" : "outline"}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const watchedOn = personal && !watched ? localDay() : undefined;
          const res = await toggleWatched(itemId, !watched, watchedOn);
          if (!res.error && !watched) {
            askHowItWas({ itemId, title, score: myScore, comment: myComment, watchedOn });
          }
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : watched ? (
        <Check className="size-4 text-like" />
      ) : (
        <Eye className="size-4" />
      )}
      {watched ? "Watched" : "Mark watched"}
    </Button>
  );
}
