"use client";

import { Clapperboard, Dices, Shuffle, Star, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CategoryChips } from "@/components/category-chips";
import { MediaPoster } from "@/components/media-poster";
import { Button, buttonVariants } from "@/components/ui/button";
import { listCategories, matchesCategory } from "@/lib/categories";
import { mediaTypeLabel } from "@/lib/constants";
import { ANY_YEAR, listDecades, matchesDecade } from "@/lib/decades";
import { formatScore } from "@/lib/format";
import { seededShuffle } from "@/lib/random";
import type { ListItemCard } from "@/lib/types";
import { cn } from "@/lib/utils";

function detailHref(card: ListItemCard) {
  return `/app/media/${card.media.media_type}/${card.media.tmdb_id}`;
}

/** The To watch list in random order, filterable by release date and category, with a random pick. */
export function MovieNight({
  cards,
  seed: initialSeed,
}: {
  cards: ListItemCard[];
  seed: number;
}) {
  const [seed, setSeed] = useState(initialSeed);
  const [decade, setDecade] = useState(ANY_YEAR);
  const [category, setCategory] = useState("all");
  const [pickedId, setPickedId] = useState<string | null>(null);

  const decades = useMemo(
    () => listDecades(cards.map((c) => c.media.release_year)),
    [cards],
  );
  const inDecade = useMemo(
    () => cards.filter((c) => matchesDecade(c.media.release_year, decade)),
    [cards, decade],
  );
  const categories = useMemo(() => listCategories(inDecade), [inDecade]);
  // A category with no titles from the chosen years shows everything from those years.
  const activeCategory = categories.some((c) => c.value === category)
    ? category
    : "all";

  const shown = useMemo(
    () =>
      seededShuffle(
        inDecade.filter((c) => matchesCategory(c, activeCategory)),
        seed,
      ),
    [inDecade, activeCategory, seed],
  );
  const picked = shown.find((c) => c.item.id === pickedId) ?? null;

  function pickOne() {
    const options =
      shown.length > 1 ? shown.filter((c) => c.item.id !== pickedId) : shown;
    if (options.length === 0) return;
    setPickedId(options[Math.floor(Math.random() * options.length)].item.id);
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <Clapperboard className="size-8 text-muted-foreground" />
        <div>
          <p className="font-medium">Nothing to watch on this list yet</p>
          <p className="text-sm text-muted-foreground">
            Add a few titles first, then come back for movie night.
          </p>
        </div>
        <Link href="/app/browse" className={buttonVariants({ size: "sm" })}>
          Browse titles
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <Button onClick={pickOne} disabled={shown.length === 0}>
          <Dices className="size-4" />
          {picked ? "Pick another" : "Pick one for us"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}
        >
          <Shuffle className="size-4" />
          Shuffle
        </Button>
      </div>

      {picked && (
        <div className="flex gap-4 rounded-2xl border border-primary/50 bg-primary/10 p-4">
          <Link href={detailHref(picked)} className="w-24 shrink-0 sm:w-32">
            <MediaPoster
              path={picked.media.poster_path}
              alt={picked.media.title}
              size="w500"
              className="w-full"
            />
          </Link>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Tonight&apos;s pick
            </p>
            <h2 className="text-xl font-bold">{picked.media.title}</h2>
            <p className="text-sm text-muted-foreground">
              {mediaTypeLabel(picked.media.media_type)}
              {picked.media.release_year ? ` · ${picked.media.release_year}` : ""}
              {picked.media.runtime ? ` · ${picked.media.runtime} min` : ""}
              {picked.media.genres.length > 0
                ? ` · ${picked.media.genres.slice(0, 3).join(", ")}`
                : ""}
            </p>
            {picked.media.overview && (
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {picked.media.overview}
              </p>
            )}
            <div>
              <Link
                href={detailHref(picked)}
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                Details &amp; trailer
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <CategoryChips
          label="Released"
          aria-label="Release date"
          categories={decades}
          value={decade}
          onChange={setDecade}
        />
        <CategoryChips
          categories={categories}
          value={activeCategory}
          onChange={setCategory}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {shown.map((card) => (
          <Link
            key={card.item.id}
            href={detailHref(card)}
            className={cn(
              "flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:bg-muted",
              card.item.id === pickedId && "ring-2 ring-primary",
            )}
          >
            <MediaPoster path={card.media.poster_path} alt={card.media.title} />
            <span className="line-clamp-1 text-sm font-medium">
              {card.media.title}
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {mediaTypeLabel(card.media.media_type)}
              {card.avgScore !== null && (
                <span className="inline-flex items-center gap-0.5 text-star">
                  <Star className="size-3 fill-current" />
                  {formatScore(card.avgScore)}
                </span>
              )}
              {card.likeCount > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <ThumbsUp className="size-3" />
                  {card.likeCount}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
