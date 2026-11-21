import { Layers } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CategoryLinks } from "@/components/category-chips";
import { MediaRow } from "@/components/media-row";
import { SearchBox } from "@/components/search-box";
import { buttonVariants } from "@/components/ui/button";
import {
  getLibraryIndex,
  getMyGroups,
  getSessionProfile,
  getSuggestionSeeds,
} from "@/lib/data";
import { BROWSE_TYPES, browseHref, genresFor, parseBrowseFilters } from "@/lib/browse-filters";
import { rowSourceKey } from "@/lib/browse-rows";
import { DECADES } from "@/lib/decades";
import {
  getBrowseRows,
  getDiscoverRows,
  getRowPage,
  type TmdbRow,
} from "@/lib/tmdb";
import type { MediaType } from "@/lib/types";

/**
 * "Because your family liked X" rows (of movies or series only, with a type chosen). Titles already on a list stay, so
 * adding one doesn't make it vanish.
 */
async function getSuggestionRows(type: MediaType | null): Promise<TmdbRow[]> {
  const seeds = await getSuggestionSeeds(3, type);
  const rows = await Promise.allSettled(
    seeds.map(async (seed) => {
      const source = { kind: "like", type: seed.mediaType, id: seed.tmdbId } as const;
      return {
        title: `Because ${seed.fromFamily ? "your family" : "you"} liked ${seed.title}`,
        source,
        ...(await getRowPage(source, 1)),
      };
    }),
  );
  return rows.flatMap((row) => (row.status === "fulfilled" && row.value.items.length > 0 ? [row.value] : []));
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string | string[];
    genre?: string | string[];
    decade?: string | string[];
  }>;
}) {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const { type, genre, decade } = parseBrowseFilters(await searchParams);
  const groups = await getMyGroups();
  const targets = [
    { id: null, label: "My list" },
    ...groups.map((g) => ({ id: g.id, label: g.name })),
  ];
  const library = await getLibraryIndex(user.id, groups);

  let rows: TmdbRow[] = [];
  let suggestions: TmdbRow[] = [];
  let error = false;
  try {
    [rows, suggestions] =
      genre || decade
        ? [await getDiscoverRows({ genre, decade, type }), []]
        : await Promise.all([getBrowseRows(type), getSuggestionRows(type)]);
  } catch (e) {
    console.error("Browse rows failed:", e);
    error = true;
  }

  const allRows = [...suggestions, ...rows];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Browse</h1>
          <Link
            href="/app/browse/discover"
            title="Swipe through titles that fit your mood"
            className={buttonVariants({ className: "browse-discover-link" })}
          >
            <Layers className="size-4" />
            Discover
          </Link>
        </div>
        <p className="text-muted-foreground">
          Search or pick from popular titles, then add to a list.
        </p>
      </div>

      <SearchBox targets={targets} library={library} />

      <div className="flex flex-col gap-3">
        <CategoryLinks
          label="Type"
          aria-label="Type"
          links={[
            {
              label: "All",
              href: browseHref({ genre: genre?.slug, decade: decade?.value }),
              active: type === null,
            },
            ...BROWSE_TYPES.map((t) => ({
              label: t.label,
              // A category the other type doesn't have (Horror series, Kids movies) is left behind, so the chip never
              // leads to a page with nothing on it.
              href: browseHref({
                type: t.value,
                genre: genre && genre[t.value] !== null ? genre.slug : null,
                decade: decade?.value,
              }),
              active: t.value === type,
            })),
          ]}
        />
        <CategoryLinks
          label="Released"
          aria-label="Release date"
          links={[
            {
              label: "Any year",
              href: browseHref({ type, genre: genre?.slug }),
              active: decade === null,
            },
            ...DECADES.map((d) => ({
              label: d.label,
              href: browseHref({ type, genre: genre?.slug, decade: d.value }),
              active: d === decade,
            })),
          ]}
        />
        <CategoryLinks
          links={[
            {
              label: "All",
              href: browseHref({ type, decade: decade?.value }),
              active: genre === null,
            },
            ...genresFor(type).map((g) => ({
              label: g.label,
              href: browseHref({ type, genre: g.slug, decade: decade?.value }),
              active: g === genre,
            })),
          ]}
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Couldn&apos;t load movies and series right now. Search still might
          work; otherwise try again in a minute.
        </div>
      ) : allRows.every((r) => r.items.length === 0) ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nothing matched these filters. Try another category or year.
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {allRows.map((r) => (
            <MediaRow
              // By source, not title: two titles can share a name, and a row that keeps loading keeps its place by its key.
              key={rowSourceKey(r.source)}
              title={r.title}
              items={r.items}
              targets={targets}
              library={library}
              source={r.source}
              hasMore={r.hasMore}
            />
          ))}
        </div>
      )}
    </div>
  );
}
