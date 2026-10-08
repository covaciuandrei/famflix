"use client";

import { Check, Eye, Loader2 } from "lucide-react";
import { useTransition } from "react";

import { toggleWatched } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { useWatchedPrompt } from "@/components/watched-prompt";

export function WatchedToggle({
  itemId,
  watched,
  title,
  myScore,
  myComment,
}: {
  itemId: string;
  watched: boolean;
  title: string;
  myScore: number | null;
  myComment: string | null;
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
          const res = await toggleWatched(itemId, !watched);
          if (!res.error && !watched) {
            askHowItWas({ itemId, title, score: myScore, comment: myComment });
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
