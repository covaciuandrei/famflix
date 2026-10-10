import { ChevronRight, Crown, UserCog, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ActivityFeed } from "@/components/activity-feed";
import { GroupForms } from "@/components/group-forms";
import { InviteCode } from "@/components/invite-code";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getActivity, getMyGroups, getSessionProfile, refreshInviteCodes } from "@/lib/data";

export default async function GroupsPage() {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  await refreshInviteCodes();
  const groups = await getMyGroups();
  const events = groups.length > 0 ? await getActivity({ limit: 8 }) : [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Families</h1>
        <p className="text-muted-foreground">
          Shared watchlists you can create or join.
        </p>
      </div>

      <GroupForms />

      {groups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Your families</h2>
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              // The whole card opens the family: the name link stretches over it (after:inset-0),
              // and the invite code and Manage controls sit above it (relative z-10).
              <Card
                key={g.id}
                className="relative transition-colors hover:border-primary/50"
              >
                <CardContent className="flex items-center gap-3 pt-5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Users className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 font-semibold">
                      <Link
                        href={`/app/family/${g.id}`}
                        className="break-words after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                      >
                        {g.name}
                      </Link>
                      {g.isOwner && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-star">
                          <Crown className="size-3.5" />
                          Owner
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
                    Invite:
                    <InviteCode code={g.invite_code} className="relative z-10" />
                  </div>
                  {g.isOwner && (
                    <Link
                      href={`/app/family/${g.id}/settings#members`}
                      aria-label={`Manage ${g.name}`}
                      title="Manage members"
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                        className: "relative z-10 shrink-0 max-sm:size-9 max-sm:px-0",
                      })}
                    >
                      <UserCog className="size-4" />
                      <span className="max-sm:hidden">Manage</span>
                    </Link>
                  )}
                  <ChevronRight
                    className="size-5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

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
