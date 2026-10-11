"use client";

import { Loader2, Repeat } from "lucide-react";
import { useState, useTransition } from "react";

import { watchSeriesAgain } from "@/app/app/media/series-actions";
import { Button } from "@/components/ui/button";

/**
 * On the card of a series on My list that is marked Watched: start it again, as a new pass. What was watched of it goes
 * into its history (the series page has the same button, and the episodes' days).
 */
export function StartSeriesAgain({ itemId, title, pass }: { itemId: string; title: string; pass: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function click() {
    if (
      !window.confirm(
        `Start ${title} again? What you've watched of it goes into its history as pass ${pass}, with your scores and notes, and the series is Not started again.`,
      )
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const res = await watchSeriesAgain(itemId);
      if (res.error) setError(res.error);
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={click} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Repeat className="size-4" aria-hidden />}
        Start again
      </Button>
      {error && (
        <p role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
