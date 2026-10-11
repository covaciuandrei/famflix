"use client";

import Link from "next/link";

import { LocalTime } from "@/components/movie-night/local-time";
import { useDuePlans } from "@/components/movie-night/night-status";
import { buttonVariants } from "@/components/ui/button";
import { plansInWindow, whenWords } from "@/lib/movie-night-plans";
import { useNow } from "@/lib/use-now";

/**
 * On the Movie night page, from an hour before a planned night's time to three hours after: which family's night it is
 * and when, with a way to its plan. Nothing for a plan the person can't come to.
 */
export function PlanBanner() {
  const plans = useDuePlans();
  const now = useNow();
  if (now === null) return null;
  const due = plansInWindow(plans, now);
  if (due.length === 0) return null;
  return (
    <section aria-label="Planned movie nights about to start" className="flex flex-col gap-2">
      {due.map((plan) => (
        <div
          key={plan.id}
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/50 bg-primary/10 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {plan.group_name}: {whenWords(plan.starts_at, now).toLowerCase()}
            </p>
            <p className="text-sm text-muted-foreground">
              <LocalTime iso={plan.starts_at} />
              {plan.going > 0 ? ` · ${plan.going} going` : ""}
              {plan.note ? ` · “${plan.note}”` : ""}
            </p>
          </div>
          <Link href={`/app/movie-night?who=${plan.group_id}`} className={buttonVariants({ size: "sm" })}>
            See the plan
          </Link>
        </div>
      ))}
    </section>
  );
}
