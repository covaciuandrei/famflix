"use client";

import { Clapperboard, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { restoreListItem } from "@/app/app/actions";
import { ListItemCard } from "@/components/list-item-card";
import { SortSelect } from "@/components/sort-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { sortCards } from "@/lib/sort";
import type {
  ListItemCard as Card,
  MemberSummary,
  SortKey,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "want" | "watched" | "all";

const TABS: { value: Tab; label: string }[] = [
  { value: "want", label: "To watch" },
  { value: "watched", label: "Watched" },
  { value: "all", label: "All" },
];

export function Watchlist({
  cards,
  currentUserId,
  members,
}: {
  cards: Card[];
  currentUserId: string;
  members?: MemberSummary[];
}) {
  const [tab, setTab] = useState<Tab>("want");
  const [sort, setSort] = useState<SortKey>("recent");
  const [removed, setRemoved] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, startUndo] = useTransition();

  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), 10_000);
    return () => clearTimeout(timer);
  }, [removed]);

  function undo() {
    if (!removed) return;
    const { id } = removed;
    setUndoError(null);
    startUndo(async () => {
      const res = await restoreListItem(id);
      if (res.error) setUndoError(res.error);
      else setRemoved(null);
    });
  }

  const counts = useMemo(
    () => ({
      want: cards.filter((c) => c.item.status === "want").length,
      watched: cards.filter((c) => c.item.status === "watched").length,
      all: cards.length,
    }),
    [cards],
  );

  const visible = useMemo(() => {
    const filtered =
      tab === "all" ? cards : cards.filter((c) => c.item.status === tab);
    return sortCards(filtered, sort);
  }, [cards, tab, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                tab === t.value && "bg-muted text-foreground",
              )}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-muted-foreground">
                {counts[t.value]}
              </span>
            </button>
          ))}
        </div>
        <SortSelect value={sort} onChange={setSort} />
      </div>

      {visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visible.map((card) => (
            <ListItemCard
              key={card.item.id}
              card={card}
              currentUserId={currentUserId}
              members={members}
              onRemoved={(id, title) => {
                setUndoError(null);
                setRemoved({ id, title });
              }}
            />
          ))}
        </div>
      )}

      {removed && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-20 z-40 mx-auto flex w-[min(28rem,calc(100%-2rem))] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-xl sm:bottom-6"
        >
          <span className="min-w-0 flex-1 truncate">
            Removed “{removed.title}”
          </span>
          {undoError && <span className="text-destructive">{undoError}</span>}
          <Button size="sm" variant="secondary" onClick={undo} disabled={undoing}>
            <Undo2 className="size-4" />
            Undo
          </Button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      <Clapperboard className="size-8 text-muted-foreground" />
      <div>
        <p className="font-medium">
          {tab === "watched" ? "Nothing watched yet" : "This list is empty"}
        </p>
        <p className="text-sm text-muted-foreground">
          Find something to watch and add it to your list.
        </p>
      </div>
      <Link href="/app/browse" className={buttonVariants({ size: "sm" })}>
        Browse titles
      </Link>
    </div>
  );
}
