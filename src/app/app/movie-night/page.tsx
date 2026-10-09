import { Popcorn } from "lucide-react";
import { redirect } from "next/navigation";

import { Hub } from "@/components/movie-night/hub";
import { getActiveMovieNights, getMyGroups, getNightHistory, getSessionProfile } from "@/lib/data";
import { HISTORY_PAGE } from "@/lib/movie-night";

/** Movie night: swipe through titles on your own, or start one for a family and let the votes decide. */
export default async function MovieNightPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const { who: whoParam } = await searchParams;
  const groups = await getMyGroups();
  const who = groups.find((g) => g.id === (Array.isArray(whoParam) ? whoParam[0] : whoParam))?.id ?? null;
  // Looking at the nights going on also settles those nobody has touched for 12 hours (the layout does it too, but in
  // parallel), so they are in the list below as expired.
  await getActiveMovieNights();
  const history = groups.length > 0 ? await getNightHistory(who, 0, HISTORY_PAGE) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Popcorn className="size-6 text-primary" />
          Movie night
        </h1>
        <p className="text-muted-foreground">
          Can&apos;t decide what to watch? Swipe through titles that fit your mood, alone or with your family.
        </p>
      </div>
      <Hub
        families={groups.map((g) => ({ id: g.id, name: g.name, members: g.memberCount }))}
        who={who}
        history={history}
      />
    </div>
  );
}
