import { redirect } from "next/navigation";

import { MediaRow } from "@/components/media-row";
import { SearchBox } from "@/components/search-box";
import { libraryKey } from "@/lib/constants";
import {
  getLibraryIndex,
  getMyGroups,
  getSessionProfile,
  getSuggestionSeeds,
} from "@/lib/data";
import { getBrowseRows, getRecommendations, type TmdbRow } from "@/lib/tmdb";
import type { LibraryIndex } from "@/lib/types";

/** "Because your family liked X" rows, without titles already on the user's lists. */
async function getSuggestionRows(library: LibraryIndex): Promise<TmdbRow[]> {
  const seeds = await getSuggestionSeeds(3);
  const results = await Promise.allSettled(
    seeds.map((s) => getRecommendations(s.mediaType, s.tmdbId)),
  );
  return seeds.flatMap((seed, i) => {
    const result = results[i];
    if (result.status === "rejected") return [];
    const items = result.value
      .filter((item) => !library[libraryKey(item.mediaType, item.tmdbId)])
      .slice(0, 12);
    if (items.length === 0) return [];
    return [
      {
        title: `Because ${seed.fromFamily ? "your family" : "you"} liked ${seed.title}`,
        items,
      },
    ];
  });
}

export default async function BrowsePage() {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const groups = await getMyGroups();
  const targets = [
    { id: null, label: "My list" },
    ...groups.map((g) => ({ id: g.id, label: g.name })),
  ];
  const library = await getLibraryIndex(user.id, groups);

  let rows: TmdbRow[] = [];
  let suggestions: TmdbRow[] = [];
  let error: string | null = null;
  try {
    [rows, suggestions] = await Promise.all([
      getBrowseRows(),
      getSuggestionRows(library),
    ]);
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Browse</h1>
        <p className="text-muted-foreground">
          Search or pick from popular titles, then add to a list.
        </p>
      </div>

      <SearchBox targets={targets} library={library} />

      {error ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Couldn&apos;t load titles from TMDB. Make sure{" "}
          <code className="font-mono text-foreground">TMDB_ACCESS_TOKEN</code> is
          set in your environment.
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
