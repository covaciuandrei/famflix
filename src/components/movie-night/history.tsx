"use client";

import { Ban, Clock, Loader2, Popcorn } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { MediaPoster } from "@/components/media-poster";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { findGenre } from "@/lib/genres";
import type { HistoryEntry } from "@/lib/movie-night";

const MAX_FACES = 4;

function People({ entry }: { entry: HistoryEntry }) {
  if (entry.people.length === 0) return null;
  const shown = entry.people.slice(0, MAX_FACES);
  const more = entry.people.length - shown.length;
  const label = `${entry.status === "closed" ? "Watched by" : "Took part"}: ${entry.people.map((p) => p.name).join(", ")}`;
  return (
    <span role="img" aria-label={label} title={label} className="mt-1 flex items-center">
      <span className="flex -space-x-1.5">
        {shown.map((person) => (
          <Avatar key={person.name} name={person.name} url={person.avatarUrl} className="size-5 text-[9px] ring-2 ring-card" />
        ))}
      </span>
      {more > 0 && <span className="ml-1.5 text-xs text-muted-foreground">+{more}</span>}
    </span>
  );
}

/** What an entry says about itself: the headline, and the chip at its end. */
function describe(entry: HistoryEntry): { headline: string; chip: string } {
  if (entry.status === "closed") {
    return {
      headline: entry.picked?.title ?? "A title that was removed",
      chip: entry.source === "logged" ? "Watched together" : "Picked",
    };
  }
  if (entry.status === "cancelled") {
    return { headline: entry.endedByName ? `Cancelled by ${entry.endedByName}` : "Cancelled", chip: "Cancelled" };
  }
  return { headline: "Nobody picked", chip: "Expired" };
}

function Entry({ entry }: { entry: HistoryEntry }) {
  const { headline, chip } = describe(entry);
  const genres = entry.genres.map((slug) => findGenre(slug)?.label ?? slug);
  const facts = [
    formatDay(entry.happenedOn),
    entry.status === "expired" ? "ended after 12 hours" : null,
    entry.source === "swipe" && entry.cards > 0
      ? `${entry.stacks} ${entry.stacks === 1 ? "stack" : "stacks"}, ${entry.cards} titles`
      : null,
    entry.source === "swipe" && genres.length > 0 ? genres.join(", ") : null,
  ].filter(Boolean);

  // A swipe night opens its leaderboard; a Watched together log opens the title it is about.
  const href =
    entry.source === "swipe"
      ? `/app/movie-night/${entry.id}`
      : entry.picked
        ? `/app/media/${entry.picked.mediaType}/${entry.picked.tmdbId}`
        : null;
  const Icon = entry.status === "cancelled" ? Ban : entry.status === "expired" ? Clock : Popcorn;

  const body = (
    <>
      {entry.picked ? (
        <MediaPoster path={entry.picked.posterPath} alt="" size="w92" sizes="48px" className="w-12 shrink-0" />
      ) : (
        <span className="flex aspect-[2/3] w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 block font-medium">{headline}</span>
        <span className="block text-xs text-muted-foreground">{facts.join(" · ")}</span>
        <People entry={entry} />
      </span>
      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] leading-4 text-muted-foreground">
        {chip}
      </span>
    </>
  );
  const className = "flex items-center gap-3 rounded-xl border border-border bg-card p-2.5";
  return (
    <li>
      {href ? (
        <Link href={href} className={`${className} transition-colors hover:bg-muted/40`}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

/** A family's finished movie nights, newest first, a page at a time. Nothing is ever deleted from it. */
export function History({
  groupId,
  familyName,
  initial,
  initialHasMore,
}: {
  groupId: string;
  familyName: string;
  initial: HistoryEntry[];
  initialHasMore: boolean;
}) {
  const [entries, setEntries] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/movie-night/history?group=${groupId}&offset=${entries.length}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { entries: HistoryEntry[]; hasMore: boolean };
      // A night that ended in the meantime shifts the pages by one: never show an entry twice.
      setEntries((current) => {
        const seen = new Set(current.map((e) => e.id));
        return [...current, ...page.entries.filter((e) => !seen.has(e.id))];
      });
      setHasMore(page.hasMore);
    } catch {
      setError("Couldn't load more. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="history" aria-labelledby="history-title" className="flex scroll-mt-20 flex-col gap-3">
      <h2 id="history-title" className="text-lg font-semibold">
        Past movie nights in {familyName}
      </h2>
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing yet. When {familyName} picks something to watch together, it will be kept here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {hasMore && (
        <Button variant="outline" onClick={loadMore} disabled={loading} className="self-start">
          {loading && <Loader2 className="size-4 animate-spin" />}
          Load more
        </Button>
      )}
    </section>
  );
}
