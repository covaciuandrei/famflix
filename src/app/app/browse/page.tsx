import { redirect } from "next/navigation";

import { CategoryLinks } from "@/components/category-chips";
import { MediaRow } from "@/components/media-row";
import { SearchBox } from "@/components/search-box";
import {
  getLibraryIndex,
  getMyGroups,
  getSessionProfile,
  getSuggestionSeeds,
} from "@/lib/data";
import { DECADES, findDecade } from "@/lib/decades";
import { BROWSE_GENRES } from "@/lib/genres";
import {
  getBrowseRows,
  getDiscoverRows,
  getRecommendations,
  type TmdbRow,
} from "@/lib/tmdb";

/** "Because your family liked X" rows. Titles already on a list stay, so adding one doesn't make it vanish. */
async function getSuggestionRows(): Promise<TmdbRow[]> {
  const seeds = await getSuggestionSeeds(3);
  const results = await Promise.allSettled(
    seeds.map((s) => getRecommendations(s.mediaType, s.tmdbId)),
  );
  return seeds.flatMap((seed, i) => {
    const result = results[i];
    if (result.status === "rejected") return [];
    const items = result.value.slice(0, 12);
    if (items.length === 0) return [];
    return [
      {
        title: `Because ${seed.fromFamily ? "your family" : "you"} liked ${seed.title}`,
        items,
      },
    ];
  });
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{
    genre?: string | string[];
    decade?: string | string[];
  }>;
}) {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const params = await searchParams;
  const genre = BROWSE_GENRES.find((g) => g.slug === params.genre) ?? null;
  const decade =
    typeof params.decade === "string" ? findDecade(params.decade) : null;
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
        ? [await getDiscoverRows({ genre, decade }), []]
        : await Promise.all([getBrowseRows(), getSuggestionRows()]);
  } catch (e) {
    console.error("Browse rows failed:", e);
    error = true;
  }

  const browseHref = (genreSlug?: string, decadeValue?: string) => {
    const query = new URLSearchParams();
    if (genreSlug) query.set("genre", genreSlug);
    if (decadeValue) query.set("decade", decadeValue);
    return query.size ? `/app/browse?${query}` : "/app/browse";
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Browse</h1>
        <p className="text-muted-foreground">
          Search or pick from popular titles, then add to a list.
        </p>
      </div>

      <SearchBox targets={targets} library={library} />

      <div className="flex flex-col gap-3">
        <CategoryLinks
          label="Released"
          aria-label="Release date"
          links={[
            {
              label: "Any year",
              href: browseHref(genre?.slug),
              active: decade === null,
            },
            ...DECADES.map((d) => ({
              label: d.label,
              href: browseHref(genre?.slug, d.value),
              active: d === decade,
            })),
          ]}
        />
        <CategoryLinks
          links={[
            {
              label: "All",
              href: browseHref(undefined, decade?.value),
              active: genre === null,
            },
            ...BROWSE_GENRES.map((g) => ({
              label: g.label,
              href: browseHref(g.slug, decade?.value),
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
      ) : (
        <div className="flex flex-col gap-8">
          {[...suggestions, ...rows].map((r) => (
            <MediaRow
              key={r.title}
              title={r.title}
              items={r.items}
              targets={targets}
              library={library}
            />
          ))}
        </div>
      )}
    </div>
  );
}
