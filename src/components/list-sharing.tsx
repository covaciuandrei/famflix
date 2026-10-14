"use client";

import { Loader2 } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";

import { setListSharing } from "@/app/app/actions";
import { cn } from "@/lib/utils";

/** Whether the people in your families can see your My list: one switch, saved as soon as it is flipped. */
export function ListSharing({ shared }: { shared: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Shows the new setting at once, and goes back to the saved one if saving fails.
  const [on, show] = useOptimistic(shared);

  function flip() {
    const next = !on;
    setError(null);
    start(async () => {
      show(next);
      const res = await setListSharing(next);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id="share-my-list-label" className="text-sm font-medium">
            Let my families see my list
          </p>
          <p id="share-my-list-help" className="mt-1 text-sm text-muted-foreground">
            The people in your families can see the titles on My list, whether you watched them, when, and your score.
            Never your notes. Switch it off and only you can see it.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="share-my-list-label"
          aria-describedby="share-my-list-help"
          disabled={pending}
          onClick={flip}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-wait disabled:opacity-70",
            on ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "pointer-events-none grid size-5 place-items-center rounded-full bg-white shadow transition-transform",
              on ? "translate-x-[1.375rem]" : "translate-x-0.5",
            )}
          >
            {pending && <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />}
          </span>
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
