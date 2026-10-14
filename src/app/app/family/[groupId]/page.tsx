import { Plus, Settings, UserCog } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ActivityFeed } from "@/components/activity-feed";
import { Avatar } from "@/components/avatar";
import { InviteCode } from "@/components/invite-code";
import { MemberLists } from "@/components/member-lists";
import { RemovedItems } from "@/components/removed-items";
import { FamilyNightLink } from "@/components/movie-night/family-night-link";
import { FamilyStatsView } from "@/components/stats/family-stats";
import { buttonVariants } from "@/components/ui/button";
import { Watchlist } from "@/components/watchlist";
import {
  getActivity,
  getGroupWithMembers,
  getListCards,
  getRemovedItems,
  getSessionProfile,
  getSharing,
  refreshInviteCodes,
} from "@/lib/data";
import { timeUntil } from "@/lib/format";
import { familyStats, periodFromParam, yearsWithData } from "@/lib/stats";
import { getFamilyStatsInput } from "@/lib/stats-data";
import { cn } from "@/lib/utils";

export default async function FamilyPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ view?: string | string[]; year?: string | string[] }>;
}) {
  const { groupId } = await params;
  const { view, year } = await searchParams;
  const showActivity = view === "activity";
  const showStats = view === "stats";
  const showMembers = view === "members";
  const showList = !showActivity && !showStats && !showMembers;
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  await refreshInviteCodes();
  const data = await getGroupWithMembers(groupId);
  if (!data) notFound();
  const { group, members } = data;
  const isOwner = members.some(
    (m) => m.user_id === user.id && m.role === "owner",
  );

  const memberSummaries = members.map((m) => ({
    id: m.user_id,
    display_name: m.profiles?.display_name ?? "Member",
    avatar_url: m.profiles?.avatar_url ?? null,
  }));
  const memberNames = Object.fromEntries(
    memberSummaries.map((m) => [m.id, m.display_name]),
  );

  const [cards, removed, events, statsInput, sharing] = await Promise.all([
    showList ? getListCards({ groupId, userId: user.id }) : [],
    showList
      ? getRemovedItems({ groupId, userId: user.id, memberNames })
      : [],
    showActivity ? getActivity({ groupId, limit: 50 }) : [],
    showStats
      ? getFamilyStatsInput(
          groupId,
          memberSummaries.map((m) => ({ id: m.id, name: m.display_name })),
        )
      : null,
    showMembers ? getSharing(memberSummaries.map((m) => m.id)) : new Map<string, boolean>(),
  ]);
  const years = statsInput
    ? yearsWithData(statsInput.titles.flatMap((t) => t.viewings.map((v) => v.on)))
    : [];
  const stats = statsInput ? familyStats(statsInput, periodFromParam(year, years)) : null;

  const tabClass = (active: boolean) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
      active && "bg-muted text-foreground",
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{group.name}</h1>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex -space-x-2">
              {members.map((m) => (
                <Avatar
                  key={m.user_id}
                  name={m.profiles?.display_name}
                  url={m.profiles?.avatar_url}
                  className="size-7 ring-2 ring-background"
                />
              ))}
            </div>
            <span className="text-sm text-muted-foreground">
              {members.length} member{members.length === 1 ? "" : "s"}
            </span>
          </div>
          <Link
            href={`/app/movie-night?who=${group.id}#movie-nights`}
            className="mt-2 inline-block text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Movie nights
          </Link>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Invite code:
            <InviteCode code={group.invite_code} />
            <span className="text-xs">
              changes in {timeUntil(group.invite_code_expires_at)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/app/family/${group.id}/settings`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              {isOwner ? (
                <UserCog className="size-4" />
              ) : (
                <Settings className="size-4" />
              )}
              {isOwner ? "Manage" : "Settings"}
            </Link>
            <FamilyNightLink groupId={group.id} />
            <Link href="/app/browse" className={buttonVariants({ size: "sm" })}>
              <Plus className="size-4" />
              Add titles
            </Link>
          </div>
        </div>
      </div>

      <nav aria-label="Family sections" className="inline-flex self-start rounded-lg border border-border bg-card p-1">
        <Link
          href={`/app/family/${group.id}`}
          aria-current={showList ? "page" : undefined}
          className={tabClass(showList)}
        >
          List
        </Link>
        <Link
          href={`/app/family/${group.id}?view=members`}
          aria-current={showMembers ? "page" : undefined}
          className={tabClass(showMembers)}
        >
          Members
        </Link>
        <Link
          href={`/app/family/${group.id}?view=activity`}
          aria-current={showActivity ? "page" : undefined}
          className={tabClass(showActivity)}
        >
          Activity
        </Link>
        <Link
          href={`/app/family/${group.id}?view=stats`}
          aria-current={showStats ? "page" : undefined}
          className={tabClass(showStats)}
        >
          Stats
        </Link>
      </nav>

      {showActivity ? (
        <div className="rounded-xl border border-border bg-card px-4 py-2">
          <ActivityFeed events={events} currentUserId={user.id} />
        </div>
      ) : showMembers ? (
        <MemberLists
          groupId={group.id}
          meId={user.id}
          sharing={sharing}
          people={members.map((m) => ({
            id: m.user_id,
            name: m.profiles?.display_name || "Member",
            avatarUrl: m.profiles?.avatar_url ?? null,
            owner: m.role === "owner",
          }))}
        />
      ) : showStats ? (
        stats ? (
          <FamilyStatsView stats={stats} years={years} groupId={group.id} />
        ) : (
          <p role="alert" className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
            Couldn&apos;t load the stats. Please try again in a moment.
          </p>
        )
      ) : (
        <>
          <Watchlist
            cards={cards}
            currentUserId={user.id}
            members={memberSummaries}
          />
          <RemovedItems items={removed} />
        </>
      )}
    </div>
  );
}
