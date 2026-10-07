"use client";

import { Check, Eye, Loader2 } from "lucide-react";
import { useTransition } from "react";

import { toggleWatched } from "@/app/app/actions";
import { Button } from "@/components/ui/button";

export function WatchedToggle({
  itemId,
  watched,
}: {
  itemId: string;
  watched: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <Button
      variant={watched ? "secondary" : "outline"}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await toggleWatched(itemId, !watched);
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
