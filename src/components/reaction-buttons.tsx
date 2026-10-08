"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useTransition } from "react";

import { setReaction } from "@/app/app/actions";
import type { ReactionValue } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ReactionButtons({
  itemId,
  likeCount,
  dislikeCount,
  mine,
}: {
  itemId: string;
  likeCount: number;
  dislikeCount: number;
  mine: ReactionValue | null;
}) {
  const [pending, start] = useTransition();

  function react(value: ReactionValue) {
    start(async () => {
      await setReaction(itemId, value);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => react("like")}
        aria-pressed={mine === "like"}
        aria-label={`Like (${likeCount})`}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50",
          mine === "like" && "text-like",
        )}
      >
        <ThumbsUp className="size-4" />
        {likeCount}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => react("dislike")}
        aria-pressed={mine === "dislike"}
        aria-label={`Dislike (${dislikeCount})`}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50",
          mine === "dislike" && "text-dislike",
        )}
      >
        <ThumbsDown className="size-4" />
        {dislikeCount}
      </button>
    </div>
  );
}
