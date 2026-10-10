"use client";

import { Ban, Clock, Loader2, Popcorn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/avatar";
import { MediaPoster } from "@/components/media-poster";
import { useNightStatus } from "@/components/movie-night/night-status";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { findGenre } from "@/lib/genres";
import {
  type ActiveNight,
  type HistoryEntry,
  NIGHT_STATUS_LABEL,
  type NightStatus,
  nightAction,
} from "@/lib/movie-night";
import { cn } from "@/lib/utils";

const MAX_FACES = 4;

const TONE: Record<NightStatus, string> = {
  open: "border-primary bg-primary font-medium text-primary-foreground",
  closed: "border-like/40 text-like",
  cancelled: "border-border text-muted-foreground",
  expired: "border-border text-muted-foreground",
};

/** A night's status in words (never by colour alone). */
function StatusChip({ status }: { status: NightStatus }) {
  return (
    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-4", TONE[status])}>
      {NIGHT_STATUS_LABEL[status]}
    </span>
  );
}

const genreNames = (slugs: readonly string[]) => slugs.map((slug) => findGenre(slug)?.label ?? slug);

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

/** A night that is over: what was picked, or why nothing was. */
function Entry({ entry }: { entry: HistoryEntry }) {
  const headline =
    entry.status === "closed"
      ? (entry.picked?.title ?? "A title that was removed")
      : entry.status === "cancelled"
        ? entry.endedByName
          ? `Cancelled by ${entry.endedByName}`
          : "Cancelled"
        : "Nobody picked";
  const genres = genreNames(entry.genres);
  const facts = [
    formatDay(entry.happenedOn),
    entry.source === "logged" ? "Watched together" : null,
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
      <StatusChip status={entry.status} />
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

/** A night that is going: the way in is on the row ("Join in", "Keep swiping", "See the leaderboard"). */
function PendingEntry({ night }: { night: ActiveNight }) {
  const genres = genreNames(night.genres);
  const facts = [
    formatDay(night.created_at.slice(0, 10)),
    `${night.done_members} of ${night.members} done`,
    genres.length > 0 ? genres.join(", ") : null,
  ].filter(Boolean);
  return (
    <li>
      <Link
        href={`/app/movie-night/${night.night_id}`}
        className="flex items-center gap-3 rounded-xl border border-primary/50 bg-primary/10 p-2.5 transition-colors hover:bg-primary/15"
      >
        <span className="flex aspect-[2/3] w-12 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
          <Popcorn className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 block font-medium">Started by {night.started_by_name ?? "someone"}</span>
          <span className="block text-xs text-muted-foreground">{facts.join(" · ")}</span>
          <span className="mt-1 block text-xs font-medium text-primary">{nightAction(night)} →</span>
        </span>
        <StatusChip status="open" />
      </Link>
    </li>
  );
}

/**
 * Every movie night of a family, with its status: the ones in progress first (live, from the same check as the dot on
 * the menu), then those that are over, newest first, a page at a time. Nothing is ever deleted from it.
 */
export function NightList({
  scope,
  initial,
  initialHasMore,
}: {
  scope: { groupId: string; familyName: string };
  initial: HistoryEntry[];
  initialHasMore: boolean;
}) {
  const router = useRouter();
  const live = useNightStatus();
  const pending = live.filter((n) => n.group_id === scope.groupId);
  const [entries, setEntries] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A night that was going has ended (finished, cancelled or run out of time): the server knows how, so ask for the
  // list again and it appears below with its new status.
  const pendingIds = pending.map((n) => n.night_id).join(",");
  const lastIds = useRef(pendingIds);
  useEffect(() => {
    const before = lastIds.current ? lastIds.current.split(",") : [];
    lastIds.current = pendingIds;
    const now = new Set(pendingIds ? pendingIds.split(",") : []);
    if (before.some((id) => !now.has(id))) router.refresh();
  }, [pendingIds, router]);

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/movie-night/history?group=${scope.groupId}&offset=${entries.length}`, { cache: "no-store" });
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
    <section id="movie-nights" aria-labelledby="nights-title" className="flex scroll-mt-20 flex-col gap-3">
      <h2 id="nights-title" className="text-lg font-semibold">
        Movie nights in {scope.familyName}
      </h2>
      {pending.length === 0 && entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No movie nights yet. Start one for {scope.familyName} and it will show up here, with its status.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((night) => (
            <PendingEntry key={night.night_id} night={night} />
          ))}
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
