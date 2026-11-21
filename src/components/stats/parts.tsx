import Link from "next/link";
import type { ReactNode } from "react";

import type { ChartBar, Period } from "@/lib/stats";
import { cn } from "@/lib/utils";

/** The years that have data, and all time: pick which one the stats are about. */
export function YearPicker({
  years,
  period,
  href,
}: {
  years: number[];
  period: Period;
  href: (period: Period) => string;
}) {
  // A year asked for in the address that has no data is still shown, so it is clear which one this is.
  const shown = period !== null && !years.includes(period) ? [...years, period].sort((a, b) => b - a) : years;
  const options: { label: string; value: Period }[] = [
    ...shown.map((year) => ({ label: String(year), value: year as Period })),
    { label: "All time", value: null },
  ];
  return (
    <nav aria-label="Year" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {options.map((option) => {
        const active = option.value === period;
        return (
          <Link
            key={option.label}
            href={href(option.value)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The big numbers at the top: put StatTile inside. */
export function StatTiles({ children }: { children: ReactNode }) {
  return <dl className="stat-summary grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</dl>;
}

/** A number and what it counts (the label comes first for people who hear it read out, and shows below the number). */
export function StatTile({ value, label, hint }: { value: string | number; label: string; hint?: string }) {
  return (
    <div className="stat-total flex flex-col-reverse justify-end rounded-xl border border-border bg-card p-4">
      <dt className="text-sm text-muted-foreground">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** A box of the stats with its own heading. */
export function StatCard({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4", className)}
    >
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** What to say when a box has nothing in it yet. */
export function Nothing({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** Horizontal bars: each a name and its number in words; the bar only decorates, the words are the information. */
export function BarList({ items }: { items: { key: string; label: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{item.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{item.text}</span>
          </div>
          <div aria-hidden className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(4, Math.round((item.value / max) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Columns for the months of a year (or the years of all time); `one` and `many` say what the numbers count, for people who hear it. */
export function BarChart({ bars, one, many }: { bars: ChartBar[]; one: string; many: string }) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <ol className="flex items-end justify-center gap-1 sm:gap-2">
      {bars.map((bar) => (
        <li key={bar.key} className="flex max-w-20 min-w-0 flex-1 flex-col items-center gap-1">
          <span aria-hidden className="h-4 text-[11px] leading-4 text-muted-foreground tabular-nums">
            {bar.value > 0 ? bar.value : ""}
          </span>
          <div aria-hidden className="flex h-24 w-full items-end border-b border-border">
            {bar.value > 0 && (
              <div
                className="stat-chart-bar w-full rounded-t bg-primary"
                data-peak={bar.value === max ? "" : undefined}
                style={{ height: `${Math.max(6, Math.round((bar.value / max) * 100))}%` }}
              />
            )}
          </div>
          <span aria-hidden className="text-[11px] text-muted-foreground">
            {bar.short}
          </span>
          <span className="sr-only">
            {bar.label}: {bar.value} {bar.value === 1 ? one : many}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** One line of a box: a small heading and what it says. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
