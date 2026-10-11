"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { cancelPlan, rsvpPlan, startMovieNight } from "@/app/app/movie-night/actions";
import { LocalTime } from "@/components/movie-night/local-time";
import { chip } from "@/components/movie-night/mood-picker";
import { Button } from "@/components/ui/button";
import { findGenre } from "@/lib/genres";
import {
  ANSWER_LABEL,
  endedLabel,
  peopleByAnswer,
  PLAN_ANSWERS,
  rsvpSummary,
  timeHasCome,
  type PlanAnswer,
  type PlannedNight,
} from "@/lib/movie-night-plans";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * A family's planned movie nights, soonest first, then those that were cancelled or passed in the last day. Each says
 * when, what the note and the mood are, who is coming, and lets anyone answer, start the night now or cancel the plan.
 */
export function PlanList({
  plans,
  groupId,
  meId,
  className,
}: {
  plans: PlannedNight[];
  groupId: string;
  meId: string;
  className?: string;
}) {
  if (plans.length === 0) return null;
  return (
    <section aria-labelledby="plans-title" className={cn("flex min-w-0 flex-col gap-3", className)}>
      <h2 id="plans-title" className="text-lg font-semibold">
        Planned movie nights
      </h2>
      <ul className="flex flex-col gap-3">
        {plans.map((plan) => (
          <li key={plan.id}>
            <PlanCard plan={plan} groupId={groupId} meId={meId} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlanCard({ plan, groupId, meId }: { plan: PlannedNight; groupId: string; meId: string }) {
  const router = useRouter();
  const whenId = useId();
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const over = endedLabel(plan.status);
  const itsTime = over === null && now !== null && timeHasCome(plan.starts_at, now);
  const mood = plan.genres.map((slug) => findGenre(slug)?.label ?? slug).join(", ");
  const who = peopleByAnswer(plan.answers, meId);

  function answer(next: PlanAnswer) {
    setError(null);
    startTransition(async () => {
      // Pressing the answer you gave takes it back.
      const res = await rsvpPlan(plan.id, plan.my_answer === next ? null : next);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function startNow() {
    setError(null);
    startTransition(async () => {
      const res = await startMovieNight({ groupId, planId: plan.id });
      // A night that starts takes the person to it; only a problem comes back.
      if (res?.error) setError(res.error);
    });
  }

  function cancel() {
    if (!window.confirm("Cancel this planned movie night for everyone?")) return;
    setError(null);
    startTransition(async () => {
      const res = await cancelPlan(plan.id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <article
      aria-labelledby={whenId}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-4",
        over ? "border-border bg-card opacity-80" : itsTime ? "border-primary/60 bg-primary/10" : "border-border bg-card",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
            over
              ? "border-border bg-muted text-muted-foreground"
              : itsTime
                ? "border-primary bg-primary text-primary-foreground"
                : "border-primary/40 bg-primary/15 text-foreground",
          )}
        >
          {over ?? (itsTime ? "It's time" : "Planned")}
        </span>
        <LocalTime iso={plan.starts_at} id={whenId} className="text-base font-semibold" />
      </div>
      {plan.note && <p className="text-sm text-pretty">“{plan.note}”</p>}
      <p className="text-sm text-muted-foreground">
        {mood ? `${mood} · ` : ""}planned by {plan.created_by_name ?? "someone"}
      </p>
      <p className="text-sm font-medium">{rsvpSummary(plan.answers)}</p>

      {over === null && (
        <>
          <div role="group" aria-label="Your answer" className="flex flex-wrap gap-2">
            {PLAN_ANSWERS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={plan.my_answer === a}
                disabled={pending}
                onClick={() => answer(a)}
                className={chip(plan.my_answer === a)}
              >
                {ANSWER_LABEL[a]}
              </button>
            ))}
          </div>
          {who.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
                Who is coming
              </summary>
              <dl className="mt-2 flex flex-col gap-1">
                {who.map((group) => (
                  <div key={group.answer} className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">{ANSWER_LABEL[group.answer]}</dt>
                    <dd>{group.names.join(", ")}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant={itsTime ? "default" : "outline"} disabled={pending} onClick={startNow}>
              Start now
            </Button>
            <button
              type="button"
              disabled={pending}
              onClick={cancel}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            >
              Cancel plan
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}
