"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ANY_YEAR, type YearOption } from "@/lib/decades";
import { cn } from "@/lib/utils";

const SELECT =
  "h-9 rounded-md border border-border bg-input px-2.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm";

function optionLabel(o: YearOption) {
  return o.count === undefined || o.value === ANY_YEAR
    ? o.label
    : `${o.label} (${o.count})`;
}

/** Release-date filter for a list that's already loaded. */
export function YearSelect({
  options,
  value,
  onChange,
}: {
  options: YearOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Release date"
      className={SELECT}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {optionLabel(o)}
        </option>
      ))}
    </select>
  );
}

/** The same filter for pages that load new results (Browse): picking a decade opens its link. */
export function YearSelectLinks({
  options,
  value,
}: {
  options: (YearOption & { href: string })[];
  value: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      // Uncontrolled so the new choice shows at once; the key resets it once the page has caught up.
      key={value}
      defaultValue={value}
      onChange={(e) => {
        const href = options.find((o) => o.value === e.target.value)?.href;
        if (href) start(() => router.push(href, { scroll: false }));
      }}
      aria-label="Release date"
      aria-busy={pending || undefined}
      className={cn(SELECT, pending && "animate-pulse")}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {optionLabel(o)}
        </option>
      ))}
    </select>
  );
}
