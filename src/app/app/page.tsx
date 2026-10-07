import { Bookmark, Compass, Plus, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ActivityFeed } from "@/components/activity-feed";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getActivity,
  getListCards,
  getMyGroups,
  getSessionProfile,
} from "@/lib/data";

export default async function DashboardPage() {
  const { user, profile } = await getSessionProfile();
  if (!user) redirect("/login");

  const [groups, personal, events] = await Promise.all([
    getMyGroups(),
    getListCards({ groupId: null, userId: user.id }),
    getActivity({ limit: 8 }),
  ]);

  const name = profile?.display_name || "there";
  const wantCount = personal.filter((c) => c.item.status === "want").length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Hi, {name}</h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s on your lists.</p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your families</h2>
          <Link
            href="/app/groups"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Plus className="size-4" />
            New / join
          </Link>
        </div>
        {groups.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <Link key={g.id} href={`/app/family/${g.id}`}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="size-4 text-primary" />
                      {g.name}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                    </p>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-start gap-3 pt-5">
              <p className="text-sm text-muted-foreground">
                You&apos;re not part of a family watchlist yet. Create one and
                invite your family.
              </p>
              <Link href="/app/groups" className={buttonVariants({ size: "sm" })}>
                Create a family
              </Link>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Link href="/app/mine">
          <Card className="h-full transition-colors hover:border-primary/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bookmark className="size-4 text-primary" />
                My personal list
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {wantCount} to watch · {personal.length} total
              </p>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/app/browse">
          <Card className="h-full transition-colors hover:border-primary/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Compass className="size-4 text-primary" />
                Browse &amp; add
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Find trending movies and series.
              </p>
            </CardHeader>
          </Card>
        </Link>
      </section>

      {groups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Latest in your families</h2>
          <div className="rounded-xl border border-border bg-card px-4 py-2">
            <ActivityFeed events={events} currentUserId={user.id} showFamily />
          </div>
        </section>
      )}
    </div>
  );
}
