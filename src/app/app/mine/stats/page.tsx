import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PersonalStatsView } from "@/components/stats/personal-stats";
import { getSessionProfile } from "@/lib/data";
import { getPersonalStats } from "@/lib/stats-personal-data";

export default async function YourYearPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const { year } = await searchParams;
  const result = await getPersonalStats(user.id, year);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/app/mine"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          My list
        </Link>
        <h1 className="text-2xl font-bold">Your year</h1>
        <p className="text-muted-foreground">
          What you watched, with your own scores. Only you can see this.
        </p>
      </div>
      {result ? (
        <PersonalStatsView stats={result.stats} years={result.years} />
      ) : (
        <p role="alert" className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
          Couldn&apos;t load your stats. Please try again in a moment.
        </p>
      )}
    </div>
  );
}
