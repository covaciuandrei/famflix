import { Popcorn } from "lucide-react";
import { redirect } from "next/navigation";

import { Hub } from "@/components/movie-night/hub";
import { NoFamily } from "@/components/movie-night/no-family";
import { getActiveMovieNights, getMyGroups, getNightHistory, getSessionProfile } from "@/lib/data";
import { HISTORY_PAGE } from "@/lib/movie-night";

/** Movie night: for a family. Swipe through titles together, and let the votes decide what to watch. */
export default async function MovieNightPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const { who: whoParam } = await searchParams;
  const groups = await getMyGroups();
  // The family in the address, or else the first (the oldest).
  const family = groups.find((g) => g.id === (Array.isArray(whoParam) ? whoParam[0] : whoParam)) ?? groups[0] ?? null;
  // Looking at the nights going on also settles those nobody has touched for 12 hours (the layout does it too, but in
  // parallel), so they are in the list below as expired.
  await getActiveMovieNights();
  const history = family ? await getNightHistory(family.id, 0, HISTORY_PAGE) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Popcorn className="size-6 text-primary" />
          Movie night
        </h1>
        <p className="text-muted-foreground">
          Can&apos;t decide what to watch? Everyone in your family swipes through titles that fit your mood, and the
          votes decide.
        </p>
      </div>
      {family && history ? (
        <Hub
          families={groups.map((g) => ({ id: g.id, name: g.name, members: g.memberCount }))}
          selectedId={family.id}
          history={history}
        />
      ) : (
        <NoFamily />
      )}
    </div>
  );
}
