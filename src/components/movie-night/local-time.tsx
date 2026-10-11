"use client";

import { useSyncExternalStore } from "react";

import { formatPlanTime } from "@/lib/movie-night-plans";

const subscribe = () => () => {};

/**
 * A moment in the viewer's own time zone and language ("Sat, Oct 18, 8:00 PM"). The server can't know either, so it
 * leaves the text empty and the browser fills it in; that way what is drawn first is never a time that then jumps.
 */
export function LocalTime({
  iso,
  kind = "full",
  className,
  id,
}: {
  iso: string;
  kind?: "full" | "day";
  className?: string;
  id?: string;
}) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatPlanTime(iso, { kind }),
    () => "",
  );
  return (
    <time id={id} dateTime={iso} className={className}>
      {text}
    </time>
  );
}
