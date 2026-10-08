"use client";

import { Clapperboard, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { restoreListItem } from "@/app/app/actions";
import { CategoryChips } from "@/components/category-chips";
import { ListItemCard } from "@/components/list-item-card";
import { SortSelect } from "@/components/sort-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { listCategories, matchesCategory } from "@/lib/categories";
import { ANY_YEAR, listDecades, matchesDecade } from "@/lib/decades";
import { isToWatch } from "@/lib/list-status";
import { sortCards } from "@/lib/sort";
import type {
  ListItemCard as Card,
  MemberSummary,
  SortKey,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "want" | "done" | "all";

export function Watchlist({
  cards,
  currentUserId,
  members,
}: {
  cards: Card[];
  currentUserId: string;
  members?: MemberSummary[];
}) {
  // Only family lists are given their members.
  const family = members !== undefined;
  const tabs: { value: Tab; label: string }[] = [
    { value: "want", label: "To watch" },
    { value: "done", label: family ? "Watched together" : "Watched" },
    { value: "all", label: "All" },
  ];
  const [tab, setTab] = useState<Tab>("want");
  const [decade, setDecade] = useState(ANY_YEAR);
  const [category, setCategory] = useState("all");
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

  const counts = useMemo(() => {
    const want = cards.filter(isToWatch).length;
    return { want, done: cards.length - want, all: cards.length };
  }, [cards]);

  const inTab = useMemo(
    () =>
      tab === "all"
        ? cards
        : cards.filter((c) => isToWatch(c) === (tab === "want")),
    [cards, tab],
  );
  // Filters narrow in order (tab, then release date, then category); one that matches nothing
  // here falls back to showing everything instead of an empty list.
  const decades = useMemo(
    () => listDecades(inTab.map((c) => c.media.release_year)),
    [inTab],
  );
  const activeDecade = decades.some((d) => d.value === decade)
    ? decade
    : ANY_YEAR;
  const inDecade = useMemo(
    () =>
      inTab.filter((c) => matchesDecade(c.media.release_year, activeDecade)),
    [inTab, activeDecade],
  );
  const categories = useMemo(() => listCategories(inDecade), [inDecade]);
  const activeCategory = categories.some((c) => c.value === category)
    ? category
    : "all";

  const visible = useMemo(
    () =>
      sortCards(
        inDecade.filter((c) => matchesCategory(c, activeCategory)),
        sort,
      ),
    [inDecade, activeCategory, sort],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* One row on phones: the tabs and the sort button never wrap onto separate lines. */}
      <div className="flex items-center gap-2 sm:flex-wrap sm:justify-between sm:gap-3">
        <div className="inline-flex min-w-0 rounded-lg border border-border bg-card p-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              aria-pressed={tab === t.value}
              className={cn(
                "flex items-baseline whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-3",
                // On a narrow phone only the long "Watched together" label gives way, shortened with "…".
                t.value === "done" ? "min-w-0" : "shrink-0",
                tab === t.value && "bg-muted text-foreground",
              )}
            >
              <span className="truncate">{t.label}</span>
              <span className="ml-1 shrink-0 text-xs text-muted-foreground sm:ml-1.5">
                {counts[t.value]}
              </span>
            </button>
          ))}
        </div>
        <SortSelect value={sort} onChange={setSort} />
      </div>

      {inTab.length > 0 && (
        <div className="flex flex-col gap-3">
          <CategoryChips
            label="Released"
            aria-label="Release date"
            categories={decades}
            value={activeDecade}
            onChange={setDecade}
          />
          {categories.length > 1 && (
            <CategoryChips
              categories={categories}
              value={activeCategory}
              onChange={setCategory}
            />
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState tab={tab} family={family} listEmpty={cards.length === 0} />
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

function EmptyState({
  tab,
  family,
  listEmpty,
}: {
  tab: Tab;
  family: boolean;
  listEmpty: boolean;
}) {
  const [title, text] =
    tab === "done"
      ? family
        ? [
            "Nothing watched together yet",
            "After you watch a title together, tap Watched together on it.",
          ]
        : ["Nothing watched yet", "Mark titles Watched once you've seen them."]
      : listEmpty
        ? ["This list is empty", "Find something to watch and add it to your list."]
        : ["Nothing left to watch", "Find something new to add to your list."];

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      <Clapperboard className="size-8 text-muted-foreground" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      {tab !== "done" && (
        <Link href="/app/browse" className={buttonVariants({ size: "sm" })}>
          Browse titles
        </Link>
      )}
    </div>
  );
}
