import { ArrowLeft, EyeOff, Star, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { MediaCard } from "@/components/media-card";
import { libraryKey } from "@/lib/constants";
import { getGroupWithMembers, getLibraryIndex, getMemberList, getMyGroups, getSessionProfile, getSharing } from "@/lib/data";
import { formatDay, formatScore } from "@/lib/format";
import { memberTab, splitMemberList, watchedDay } from "@/lib/member-list";
import { isUuid } from "@/lib/movie-night";
import { cn } from "@/lib/utils";

/** What is on a family member's My list, to look at (and to take titles from, onto your own lists). */
export default async function MemberListPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; userId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { groupId, userId } = await params;
  if (!isUuid(groupId) || !isUuid(userId)) notFound();
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");
  // Your own list is on My list.
  if (userId === user.id) redirect("/app/mine");

  // Only the people of a family are in it (the rules of the database hide a family you are not in).
  const family = await getGroupWithMembers(groupId);
  const person = family?.members.find((m) => m.user_id === userId);
  if (!family || !person) notFound();
  const name = person.profiles?.display_name || "This person";

  const tab = memberTab((await searchParams).tab);
  const sharing = (await getSharing([userId])).get(userId) !== false;
  const groups = sharing ? await getMyGroups() : [];
  const [list, library] = sharing
    ? await Promise.all([getMemberList(userId), getLibraryIndex(user.id, groups)])
    : [null, undefined];
  const targets = [{ id: null, label: "My list" }, ...groups.map((g) => ({ id: g.id, label: g.name }))];

  const tabs = list && "titles" in list ? splitMemberList(list.titles) : null;
  const shown = tabs ? (tab === "watched" ? tabs.watched : tabs.toWatch) : [];
  const tabLink = (active: boolean) =>
    cn(
      "flex items-baseline gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
      active && "bg-muted text-foreground",
    );

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/app/family/${family.group.id}?view=members`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {family.group.name}
      </Link>

      <div className="flex items-center gap-3">
        <Avatar name={person.profiles?.display_name} url={person.profiles?.avatar_url} className="size-12" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{name}&apos;s list</h1>
          <p className="text-sm text-muted-foreground">
            Their My list. Only the people in their families can see it, and you can add what you like to your own lists.
          </p>
        </div>
      </div>

      {!sharing ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-14 text-center">
          <EyeOff className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{name} isn&apos;t sharing their list</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            They have switched it off in their settings. Their family lists are still yours to see.
          </p>
        </div>
      ) : !tabs ? (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
          Couldn&apos;t load this list. Please try again in a little while.
        </p>
      ) : (
        <>
          <nav aria-label="Their list" className="inline-flex self-start rounded-lg border border-border bg-card p-1">
            <Link
              href={`/app/family/${family.group.id}/members/${userId}`}
              aria-current={tab === "want" ? "page" : undefined}
              className={tabLink(tab === "want")}
            >
              To watch
              <span className="text-xs text-muted-foreground">{tabs.toWatch.length}</span>
            </Link>
            <Link
              href={`/app/family/${family.group.id}/members/${userId}?tab=watched`}
              aria-current={tab === "watched" ? "page" : undefined}
              className={tabLink(tab === "watched")}
            >
              Watched
              <span className="text-xs text-muted-foreground">{tabs.watched.length}</span>
            </Link>
          </nav>

          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-14 text-center text-sm text-muted-foreground">
              {tab === "watched" ? `${name} hasn't watched anything yet.` : `${name} has nothing left to watch.`}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 min-[360px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {shown.map((title) => {
                const day = watchedDay(title);
                return (
                  <li key={`${title.media_type}-${title.tmdb_id}`}>
                    <MediaCard
                      item={{
                        tmdbId: title.tmdb_id,
                        mediaType: title.media_type,
                        title: title.title,
                        year: title.release_year,
                        posterPath: title.poster_path,
                        voteAverage: title.tmdb_rating ?? 0,
                      }}
                      targets={targets}
                      library={library?.[libraryKey(title.media_type, title.tmdb_id)]}
                      note={
                        <>
                          {title.status === "watched" && (
                            <span className="block">{day ? `Watched ${formatDay(day)}` : "Watched"}</span>
                          )}
                          {title.score !== null && (
                            <span className="flex items-center gap-1 text-star">
                              <Star className="size-3 fill-current" aria-hidden />
                              {formatScore(title.score)}
                              <span className="text-muted-foreground">their score</span>
                            </span>
                          )}
                        </>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
