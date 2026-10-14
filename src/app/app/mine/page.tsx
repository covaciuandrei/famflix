import { ChartColumn } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RemovedItems } from "@/components/removed-items";
import { buttonVariants } from "@/components/ui/button";
import { Watchlist } from "@/components/watchlist";
import { getLibraryIndex, getListCards, getMyGroups, getRemovedItems, getSessionProfile } from "@/lib/data";

export default async function MinePage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string | string[] }>;
}) {
  const { user, profile } = await getSessionProfile();
  if (!user) redirect("/login");

  // How many titles a Discover stack just put here.
  const { added } = await searchParams;
  const addedCount = typeof added === "string" ? Number.parseInt(added, 10) : 0;

  const groups = await getMyGroups();
  const [cards, removed, library] = await Promise.all([
    getListCards({ groupId: null, userId: user.id }),
    getRemovedItems({ groupId: null, userId: user.id, memberNames: {} }),
    // Which families have each title already, for the button that adds one to a family's list.
    groups.length > 0 ? getLibraryIndex(user.id, groups) : undefined,
  ]);
  const families = groups.map((g) => ({ id: g.id, label: g.name }));
  const seenByFamilies = groups.length > 0 && profile?.share_my_list !== false;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My list</h1>
          <p className="text-muted-foreground">
            {seenByFamilies ? (
              <>
                Your personal watchlist. The people in your families can see it;{" "}
                <Link href="/app/settings" className="underline underline-offset-2 hover:text-foreground">
                  change that in Settings
                </Link>
                .
              </>
            ) : (
              "Your personal watchlist — only you can see this."
            )}
          </p>
        </div>
        <Link
          href="/app/mine/stats"
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          <ChartColumn className="size-4" aria-hidden />
          Your year
        </Link>
      </div>
      {addedCount > 0 && addedCount <= 1000 && (
        <p role="status" className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
          Added {addedCount} {addedCount === 1 ? "title" : "titles"} from Discover to My list.
        </p>
      )}
      <Watchlist cards={cards} currentUserId={user.id} families={families} library={library} />
      <RemovedItems items={removed} />
    </div>
  );
}
