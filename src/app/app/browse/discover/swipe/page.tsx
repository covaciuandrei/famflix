import { ArrowLeft, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DiscoverDeck } from "@/components/discover/discover-deck-loader";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile } from "@/lib/data";
import { buildDiscoverDeck } from "@/lib/deck";
import { findGenre } from "@/lib/genres";
import { parseMood } from "@/lib/movie-night";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A Discover stack, just for you. The address holds the mood and the seed, so a refresh shows the same stack. */
export default async function DiscoverSwipePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const params = await searchParams;
  const seedText = first(params.seed);
  const seed = Number(seedText);
  if (!seedText || !Number.isSafeInteger(seed) || seed < 0 || seed >= 2 ** 31) {
    redirect("/app/browse/discover");
  }
  const mood = parseMood({
    genres: first(params.genres),
    series: first(params.series),
    count: first(params.count),
    max: first(params.max),
  });

  const result = await buildDiscoverDeck({ userId: user.id, mood, seed });
  if ("error" in result) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center"
      >
        <TriangleAlert className="size-10 text-destructive" />
        <div>
          <h1 className="text-xl font-semibold">We couldn&apos;t make your stack</h1>
          <p className="mt-1 text-sm text-muted-foreground">{result.error}</p>
        </div>
        <Link href="/app/browse/discover" className={buttonVariants()}>
          Back to Discover
        </Link>
      </div>
    );
  }

  const labels = mood.genres.map((slug) => findGenre(slug)?.label).filter(Boolean);
  return (
    // On a phone the page sits closer to the top and bottom: the deck takes all the room it can.
    <div className="flex flex-col gap-3 max-sm:-mt-2 max-sm:-mb-8 max-sm:gap-2">
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <Link href="/app/browse/discover" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-4" />
          Change mood
        </Link>
        <p className="truncate">{labels.length > 0 ? labels.join(", ") : "A bit of everything"}</p>
      </div>
      <DiscoverDeck
        cards={result.cards}
        storageKey={`${seed}:${mood.genres.join(",")}:${mood.series ? 1 : 0}:${mood.count}:${mood.maxRuntime ?? 0}`}
      />
    </div>
  );
}
