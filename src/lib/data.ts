import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { libraryKey } from "@/lib/constants";
import { familyScoreSummary } from "@/lib/attendance";
import { dayOf } from "@/lib/day";
import { timeAgo } from "@/lib/format";
import { nightPeople, type ActiveNight, type HistoryEntry, type NightState } from "@/lib/movie-night";
import { parseDuePlans, parsePlans, type DuePlan, type PlannedNight } from "@/lib/movie-night-plans";
import { earlierByTitle, groupEarlier, type HistoryRow } from "@/lib/rewatch";
import type { EarlierEpisode } from "@/lib/series";
import type {
  ActivityEvent,
  CardSeries,
  EarlierViewing,
  Group,
  GroupMemberWithProfile,
  LibraryIndex,
  ListItemCard,
  ListItemWithDetails,
  MediaType,
  MemberTitle,
  PendingRating,
  Profile,
  RemovedItem,
  WatchedWith,
} from "@/lib/types";

const LIST_SELECT =
  "*, media(*), profiles(id,display_name,avatar_url), ratings(*, profiles(id,display_name,avatar_url)), reactions(*, profiles(id,display_name,avatar_url)), guest_ratings(*,guest:family_guests(id,name,account_id),entered_by:profiles(id,display_name,avatar_url)), watches(user_id,watched_on,logged_by,skipped_at,viewing_id)";

export interface GroupWithCount extends Group {
  memberCount: number;
  /** The signed-in user owns this family: they can rename it and remove members. */
  isOwner: boolean;
}

/** The signed-in user and their profile row (cached per request). */
export const getSessionProfile = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null as Profile | null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return { user, profile: (profile as Profile | null) ?? null };
});

/** Groups the current user belongs to, with member counts and whether they own each one. */
export async function getMyGroups(): Promise<GroupWithCount[]> {
  const { user } = await getSessionProfile();
  if (!user) return [];
  const supabase = await createClient();
  const [{ data, error }, { data: owned }] = await Promise.all([
    supabase
      .from("groups")
      .select("*, group_members(count)")
      .order("created_at", { ascending: true }),
    // Ownership moves to another member when the owner leaves, so created_by isn't enough.
    supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id)
      .eq("role", "owner"),
  ]);

  if (error || !data) return [];
  const ownedIds = new Set(
    ((owned ?? []) as { group_id: string }[]).map((m) => m.group_id),
  );

  return (data as (Group & { group_members?: { count: number }[] })[]).map(
    (g) => ({
      id: g.id,
      name: g.name,
      invite_code: g.invite_code,
      invite_code_expires_at: g.invite_code_expires_at,
      created_by: g.created_by,
      created_at: g.created_at,
      memberCount: g.group_members?.[0]?.count ?? 0,
      isOwner: ownedIds.has(g.id),
    }),
  );
}

/** Swaps expired invite codes in the user's families for new ones; call before showing codes. */
export async function refreshInviteCodes() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("refresh_invite_codes");
  // Logged, not thrown: the page still works, it just shows the current code.
  if (error) console.error("Could not refresh invite codes:", error.message);
}

/** A single group plus its members (RLS ensures the user is a member). */
export async function getGroupWithMembers(groupId: string): Promise<{
  group: Group;
  members: GroupMemberWithProfile[];
} | null> {
  const supabase = await createClient();
  const { data: group } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .single();
  if (!group) return null;

  const { data: members } = await supabase
    .from("group_members")
    .select("*, profiles(id,display_name,avatar_url)")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });

  return {
    group: group as Group,
    members: (members ?? []) as GroupMemberWithProfile[],
  };
}

/**
 * What is on another person's My list, for someone who is in a family with them. The database decides who may see it
 * (member_list()): a list that is switched off, or of someone you share no family with, comes back empty. `unavailable`
 * when the database doesn't have the function yet.
 */
export async function getMemberList(
  personId: string,
): Promise<{ titles: MemberTitle[] } | { unavailable: true }> {
  const supabase = await createClient();
  const titles: MemberTitle[] = [];
  // The API hands out at most 1000 rows at a time, so a long list is read a page at a time.
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabase.rpc("member_list", { p_user: personId }).range(from, from + 999);
    if (error) {
      // PGRST202: the database doesn't have the function yet.
      if (error.code !== "PGRST202") console.error("Could not load a member's list:", error.message);
      return { unavailable: true };
    }
    const page = (data ?? []) as MemberTitle[];
    titles.push(...page);
    if (page.length < 1000) break;
  }
  return { titles };
}

/** Whether each of these people lets their families see their My list. Anyone it can't tell about counts as sharing. */
export async function getSharing(ids: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (ids.length === 0) return result;
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, share_my_list").in("id", ids);
  // Quietly: until the database has the setting, nobody has switched it off.
  if (error) return result;
  for (const row of (data ?? []) as { id: string; share_my_list: boolean }[]) {
    result.set(row.id, row.share_my_list);
  }
  return result;
}

/** Fetch and aggregate the cards for a shared (groupId) or personal list. */
export async function getListCards(opts: {
  groupId?: string | null;
  userId: string;
}): Promise<ListItemCard[]> {
  const supabase = await createClient();
  let query = supabase
    .from("list_items")
    .select(LIST_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (opts.groupId) {
    query = query.eq("group_id", opts.groupId);
  } else {
    query = query.is("group_id", null).eq("added_by", opts.userId);
  }

  const { data, error } = await query;
  if (error || !data) {
    console.error("Could not load list cards:", error?.message ?? "No response data");
    throw new Error("Couldn't load the list. Please try again and check that the database update has been applied.");
  }

  const rows = data as unknown as ListItemWithDetails[];
  if (rows.length === 0) return [];
  const [watchedWith, progress, earlier, passes] = await Promise.all([
    opts.groupId ? new Map<string, WatchedWith>() : loadWatchedWith(supabase, opts.userId, rows),
    opts.groupId ? new Map<string, CardSeries>() : loadSeriesProgress(supabase, rows),
    loadEarlier(supabase, opts),
    opts.groupId ? new Map<string, number>() : loadSeriesPasses(supabase, rows),
  ]);
  return rows
    .map((row) =>
      toCard(
        row,
        opts.userId,
        watchedWith.get(row.id) ?? null,
        progress.get(row.id) ?? null,
        earlier.get(row.media_id) ?? [],
        passes.get(row.id) ?? 0,
      ),
    )
    .filter((c): c is ListItemCard => c !== null);
}

/**
 * The viewings before the current one, by title: a family's own (everyone who watched with it) or the signed-in
 * person's (every viewing of theirs, whoever it was with).
 */
async function loadEarlier(
  supabase: Awaited<ReturnType<typeof createClient>>,
  opts: { groupId?: string | null; userId: string },
): Promise<Map<string, EarlierViewing[]>> {
  const rows: HistoryRow[] = [];
  // The API hands out at most 1000 rows at a time, so a long history is read a page at a time.
  for (let from = 0; from < 20_000; from += 1000) {
    const query = supabase
      .from("watch_history")
      .select("user_id, media_id, watched_on, viewing_id")
      .order("watched_on", { ascending: false })
      .order("id")
      .range(from, from + 999);
    const { data, error } = await (opts.groupId ? query.eq("group_id", opts.groupId) : query.eq("user_id", opts.userId));
    if (error) {
      // Logged, not thrown: the list still works, it just shows no earlier viewings. (PGRST205: the database doesn't
      // have the table yet.)
      if (error.code !== "PGRST205") console.error("Could not load earlier viewings:", error.message);
      return new Map();
    }
    const page = (data ?? []) as HistoryRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return earlierByTitle(rows);
}

/** For the series on My list that were started again: how many times through them are kept in the history. */
async function loadSeriesPasses(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: ListItemWithDetails[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!rows.some((r) => r.media?.media_type === "tv")) return result;
  const { data, error } = await supabase.rpc("my_series_passes");
  if (error) {
    // Logged, not thrown: My list still works, its series just show no earlier passes. (PGRST202: the database doesn't
    // have the function yet.)
    if (error.code !== "PGRST202") console.error("Could not load series passes:", error.message);
    return result;
  }
  for (const r of (data ?? []) as { list_item_id: string; passes: number }[]) {
    result.set(r.list_item_id, r.passes);
  }
  return result;
}

/** For the series on My list that have an episode ticked: how many aired episodes are ticked, and which is next. */
async function loadSeriesProgress(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: ListItemWithDetails[],
): Promise<Map<string, CardSeries>> {
  const result = new Map<string, CardSeries>();
  if (!rows.some((r) => r.media?.media_type === "tv")) return result;
  const { data, error } = await supabase.rpc("my_series_progress");
  if (error) {
    // Logged, not thrown: My list still works, its series just show no progress. (PGRST202: the database doesn't
    // have the function yet.)
    if (error.code !== "PGRST202") console.error("Could not load series progress:", error.message);
    return result;
  }
  for (const r of (data ?? []) as {
    list_item_id: string;
    watched: number;
    next_season: number | null;
    next_episode: number | null;
  }[]) {
    result.set(r.list_item_id, {
      watched: r.watched,
      next: r.next_season !== null && r.next_episode !== null ? { s: r.next_season, e: r.next_episode } : null,
    });
  }
  return result;
}

/**
 * For the titles on My list that a Watched together log put there: who else was on that log, and the day this person
 * watched it. They are read from the family title's watch records, which a person who has since left the family can't
 * see: for them there are no names, only the day.
 */
async function loadWatchedWith(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  rows: ListItemWithDetails[],
): Promise<Map<string, WatchedWith>> {
  const result = new Map<string, WatchedWith>();
  const linked = rows.filter((r) => r.group_id === null && r.status === "watched" && r.source_item_id);
  if (linked.length === 0) return result;

  const viewingIds = [...new Set(linked.flatMap((r) => r.source_viewing_id ? [r.source_viewing_id] : []))];
  type Companion = { user_id: string; viewing_id: string; viewing: { list_item_id: string; watched_on: string | null } };
  type GuestCompanion = { viewing_id: string; guest: { name: string } | null };
  const [legacy, participants, guests] = await Promise.all([
    supabase.from("watches").select("list_item_id,user_id,watched_on")
      .in("list_item_id", [...new Set(linked.map((r) => r.source_item_id as string))])
      .returns<{ list_item_id: string; user_id: string; watched_on: string | null }[]>(),
    viewingIds.length ? supabase.from("family_viewing_members").select("user_id,viewing_id,viewing:family_viewings!inner(list_item_id,watched_on)")
      .in("viewing_id", viewingIds).returns<Companion[]>() : null,
    viewingIds.length ? supabase.from("family_viewing_guests").select("viewing_id,guest:family_guests(name)")
      .in("viewing_id", viewingIds).returns<GuestCompanion[]>() : null,
  ]);
  if (legacy.error || participants?.error || guests?.error) {
    console.error("Could not load viewing companions:", legacy.error?.message ?? participants?.error?.message ?? guests?.error?.message);
    return result;
  }
  const watches = [
    ...(legacy.data ?? []).map((w) => ({ ...w, viewing_id: null as string | null })),
    ...(participants?.data ?? []).map((p) => ({
      user_id: p.user_id, viewing_id: p.viewing_id, list_item_id: p.viewing.list_item_id, watched_on: p.viewing.watched_on,
    })),
  ];

  const others = [...new Set(watches.filter((w) => w.user_id !== userId).map((w) => w.user_id))];
  const names = new Map<string, string>();
  if (others.length > 0) {
    const { data: people } = await supabase.from("profiles").select("id, display_name").in("id", others);
    for (const person of (people ?? []) as { id: string; display_name: string }[]) {
      names.set(person.id, person.display_name);
    }
  }

  for (const row of linked) {
    const onTheLog = watches.filter((w) => row.source_viewing_id ? w.viewing_id === row.source_viewing_id : w.viewing_id === null && w.list_item_id === row.source_item_id);
    const mine = onTheLog.find((w) => w.user_id === userId);
    result.set(row.id, {
      names: [...onTheLog
        .filter((w) => w.user_id !== userId)
        .map((w) => names.get(w.user_id) ?? "someone"),
        ...(guests?.data ?? []).flatMap((g) => g.viewing_id === row.source_viewing_id && g.guest ? [`${g.guest.name} (guest)`] : []),
      ]
        .sort((a, b) => a.localeCompare(b)),
      on: mine ? mine.watched_on : dayOf(row.watched_at),
      viewingId: row.source_viewing_id ?? undefined,
    });
  }
  return result;
}

function toCard(
  row: ListItemWithDetails,
  userId: string,
  watchedWith: WatchedWith | null,
  series: CardSeries | null,
  earlier: EarlierViewing[],
  passes: number,
): ListItemCard | null {
  if (!row.media) return null;

  const likeCount = row.reactions.filter((r) => r.value === "like").length;
  const dislikeCount = row.reactions.filter(
    (r) => r.value === "dislike",
  ).length;

  const summary = familyScoreSummary(row.ratings, row.guest_ratings);

  const mine = row.ratings.find((r) => r.user_id === userId) ?? null;
  const myReaction =
    row.reactions.find((r) => r.user_id === userId)?.value ?? null;

  return {
    item: {
      id: row.id,
      group_id: row.group_id,
      added_by: row.added_by,
      media_id: row.media_id,
      status: row.status,
      created_at: row.created_at,
      watched_at: row.watched_at,
      source_item_id: row.source_item_id ?? null,
      source_viewing_id: row.source_viewing_id ?? null,
    },
    media: row.media,
    addedBy: row.profiles,
    ratings: row.ratings,
    reactions: row.reactions,
    guestRatings: row.guest_ratings.filter((r) => r.guest?.account_id === null),
    likeCount,
    dislikeCount,
    avgScore: summary.average,
    ratingCount: summary.count,
    myScore: mine?.score ?? null,
    myComment: mine?.comment ?? null,
    myReaction,
    viewers: row.watches,
    watchedWith,
    series,
    earlier,
    passes,
  };
}

/** Family titles the signed-in user was marked as having watched but hasn't rated yet. */
/** The signed-in user's own score and note on one list item, if any. */
export async function getMyRating(
  itemId: string,
  userId: string,
): Promise<{ score: number | null; comment: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ratings")
    .select("score, comment")
    .eq("list_item_id", itemId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { score: number | null; comment: string | null } | null) ?? null;
}

/**
 * The signed-in person's viewings of one title, for its page: the day it is watched on their My list now (when it
 * is; `on` is null when nobody remembers it, and `own` is false when a family's watch put it there, whose day is the
 * family's), and the viewings before that.
 */
export async function getMyViewings(opts: {
  userId: string;
  mediaType: MediaType;
  tmdbId: number;
  /** The My list entry, if the title is on it. */
  item: { id: string; watched: boolean } | null;
}): Promise<{ current: { on: string | null; own: boolean; viewingId?: string } | null; earlier: EarlierViewing[] }> {
  const supabase = await createClient();
  const [entry, history] = await Promise.all([
    opts.item?.watched
      ? supabase.from("list_items").select("watched_at, source_item_id, source_viewing_id").eq("id", opts.item.id).maybeSingle()
      : null,
    supabase
      .from("watch_history")
      .select("watched_on, viewing_id, media!inner(media_type, tmdb_id)")
      .eq("user_id", opts.userId)
      .eq("media.media_type", opts.mediaType)
      .eq("media.tmdb_id", opts.tmdbId)
      .order("watched_on", { ascending: false, nullsFirst: false })
      .limit(500),
  ]);

  let earlier: EarlierViewing[] = [];
  if (history.error) {
    // Logged, not thrown: the page still works, it just shows no earlier viewings. (PGRST205: the database doesn't
    // have the table yet.)
    if (history.error.code !== "PGRST205") console.error("Could not load earlier viewings:", history.error.message);
  } else {
    earlier = groupEarlier(
      ((history.data ?? []) as unknown as { watched_on: string | null; viewing_id: string | null }[]).map((r) => ({
        user_id: opts.userId,
        watched_on: r.watched_on,
        viewing_id: r.viewing_id,
      })),
    );
  }

  const row = entry?.data as { watched_at: string | null; source_item_id: string | null; source_viewing_id: string | null } | null | undefined;
  return { current: row ? { on: dayOf(row.watched_at), own: row.source_item_id === null, viewingId: row.source_viewing_id ?? undefined } : null, earlier };
}

/** An episode someone ticked on a series, as the series page gets it. */
export interface TickedEpisode {
  s: number;
  e: number;
  /** The day it was watched on; null when nobody remembers it. */
  on: string | null;
  score: number | null;
  comment: string | null;
}

/** The episodes ticked on one of the signed-in person's My list series, with their scores and notes. */
export async function getEpisodeLogs(itemId: string): Promise<TickedEpisode[]> {
  const supabase = await createClient();
  const found: TickedEpisode[] = [];
  // The API hands out at most 1000 rows at a time, so a long series is read a page at a time.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("episode_logs")
      .select("season_number, episode_number, watched_on, score, comment")
      .eq("list_item_id", itemId)
      .order("season_number")
      .order("episode_number")
      .range(from, from + 999);
    if (error) {
      // Logged, not thrown: the page still works, it just shows nothing ticked.
      console.error("Could not load episodes:", error.message);
      break;
    }
    const rows = (data ?? []) as {
      season_number: number;
      episode_number: number;
      watched_on: string | null;
      score: number | null;
      comment: string | null;
    }[];
    for (const r of rows) {
      found.push({ s: r.season_number, e: r.episode_number, on: r.watched_on, score: r.score, comment: r.comment });
    }
    if (rows.length < 1000) break;
  }
  return found;
}

/**
 * The earlier viewings of the episodes of one of the signed-in person's My list series (the ones kept when an episode was
 * watched again or the series started again), for its page.
 */
export async function getEpisodeHistory(itemId: string): Promise<EarlierEpisode[]> {
  const supabase = await createClient();
  const found: EarlierEpisode[] = [];
  // The API hands out at most 1000 rows at a time, so a long history is read a page at a time.
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await supabase
      .from("episode_history")
      .select("season_number, episode_number, watched_on, pass")
      .eq("list_item_id", itemId)
      .order("season_number")
      .order("episode_number")
      .order("watched_on")
      .order("id")
      .range(from, from + 999);
    if (error) {
      // Logged, not thrown: the page still works, it just shows no earlier viewings. (PGRST205: the database doesn't
      // have the table yet.)
      if (error.code !== "PGRST205") console.error("Could not load earlier episodes:", error.message);
      return [];
    }
    const rows = (data ?? []) as {
      season_number: number;
      episode_number: number;
      watched_on: string | null;
      pass: number | null;
    }[];
    for (const r of rows) {
      found.push({ s: r.season_number, e: r.episode_number, on: r.watched_on, pass: r.pass });
    }
    if (rows.length < 1000) break;
  }
  return found;
}

export async function getPendingRatings(): Promise<PendingRating[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pending_rating_requests");
  if (error) {
    // Logged, not thrown: a failure here shouldn't take down every page.
    console.error("Could not load rating requests:", error.message);
    return [];
  }
  return (data ?? []) as PendingRating[];
}

/** Titles removed from a list in the last 30 days, newest first. */
export async function getRemovedItems(opts: {
  groupId: string | null;
  userId: string;
  memberNames: Record<string, string>;
}): Promise<RemovedItem[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let query = supabase
    .from("list_items")
    .select("id, deleted_at, deleted_by, media(title, poster_path)")
    .gte("deleted_at", since)
    .order("deleted_at", { ascending: false });
  query = opts.groupId
    ? query.eq("group_id", opts.groupId)
    : query.is("group_id", null).eq("added_by", opts.userId);

  const { data, error } = await query;
  if (error) {
    console.error("Could not load removed titles:", error.message);
    return [];
  }

  type Row = {
    id: string;
    deleted_at: string;
    deleted_by: string | null;
    media: { title: string; poster_path: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).flatMap((r) => {
    if (!r.media) return [];
    const who =
      r.deleted_by === opts.userId
        ? "you"
        : (r.deleted_by && opts.memberNames[r.deleted_by]) || "someone";
    return [
      {
        id: r.id,
        title: r.media.title,
        posterPath: r.media.poster_path,
        label: `Removed by ${who} · ${timeAgo(r.deleted_at)}`,
      },
    ];
  });
}

/** Newest family events: one family, or all of the user's families. */
export async function getActivity(opts: {
  groupId?: string;
  limit: number;
}): Promise<ActivityEvent[]> {
  const supabase = await createClient();
  let query = supabase
    .from("activity")
    .select("*, groups(name)")
    .order("created_at", { ascending: false })
    .limit(opts.limit);
  if (opts.groupId) query = query.eq("group_id", opts.groupId);

  const { data, error } = await query;
  if (error) {
    console.error("Could not load activity:", error.message);
    return [];
  }
  return (data ?? []) as ActivityEvent[];
}

/**
 * For every title on the user's lists: which lists have it and, when `seenBy` is asked for, who in their families has
 * seen it (a title's own page shows that; Browse only needs the lists, so it leaves the extra queries out).
 */
export async function getLibraryIndex(
  userId: string,
  groups: { id: string; name: string }[],
  { seenBy: withSeenBy = false }: { seenBy?: boolean } = {},
): Promise<LibraryIndex> {
  const supabase = await createClient();
  const [items, watches, members] = await Promise.all([
    supabase
      .from("list_items")
      .select("id, group_id, status, media(tmdb_id, media_type)")
      .is("deleted_at", null),
    withSeenBy
      ? supabase
          .from("watches")
          .select("user_id, list_items(deleted_at, media(tmdb_id, media_type))")
      : null,
    withSeenBy ? supabase.from("group_members").select("user_id, profiles(display_name)") : null,
  ]);

  type MediaRef = { tmdb_id: number; media_type: MediaType } | null;
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const names = new Map(
    ((members?.data ?? []) as unknown as {
      user_id: string;
      profiles: { display_name: string } | null;
    }[]).map((m) => [m.user_id, m.profiles?.display_name ?? "Someone"]),
  );

  const index: LibraryIndex = {};
  const entryFor = (media: NonNullable<MediaRef>) =>
    (index[libraryKey(media.media_type, media.tmdb_id)] ??= {
      lists: [],
      seenBy: [],
    });

  for (const row of (items.data ?? []) as unknown as {
    id: string;
    group_id: string | null;
    status: string;
    media: MediaRef;
  }[]) {
    if (!row.media) continue;
    entryFor(row.media).lists.push({
      listId: row.group_id,
      itemId: row.id,
      watched: row.status === "watched",
      label: row.group_id
        ? (groupName.get(row.group_id) ?? "Family list")
        : "My list",
    });
  }

  for (const w of (watches?.data ?? []) as unknown as {
    user_id: string;
    list_items: { deleted_at: string | null; media: MediaRef } | null;
  }[]) {
    const media = w.list_items?.media;
    if (!media || w.list_items?.deleted_at) continue;
    const seenBy = entryFor(media).seenBy;
    const name = w.user_id === userId ? "You" : (names.get(w.user_id) ?? "Someone");
    if (!seenBy.includes(name)) seenBy.push(name);
  }

  // My list first, then families in the same order as the "Add to…" menu.
  const rank = (listId: string | null) =>
    listId === null ? -1 : groups.findIndex((g) => g.id === listId);
  for (const entry of Object.values(index)) {
    entry.lists.sort((a, b) => rank(a.listId) - rank(b.listId));
  }

  return index;
}

export interface SuggestionSeed {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  fromFamily: boolean;
}

/** The user's best-loved titles: an average score of 7+ or more likes than dislikes. `mediaType` keeps only movies or series. */
export async function getSuggestionSeeds(limit: number, mediaType: MediaType | null = null): Promise<SuggestionSeed[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("list_items")
    .select(
      "group_id, created_at, media(tmdb_id, media_type, title), ratings(score), reactions(value)",
    )
    .is("deleted_at", null);
  if (error) {
    console.error("Could not load suggestion seeds:", error.message);
    return [];
  }

  type Row = {
    group_id: string | null;
    created_at: string;
    media: { tmdb_id: number; media_type: MediaType; title: string } | null;
    ratings: { score: number | null }[];
    reactions: { value: string }[];
  };
  const best = new Map<
    string,
    SuggestionSeed & { avg: number; net: number; added: number }
  >();

  for (const row of (data ?? []) as unknown as Row[]) {
    if (!row.media || (mediaType && row.media.media_type !== mediaType)) continue;
    const scores = row.ratings
      .map((r) => r.score)
      .filter((s): s is number => s !== null);
    const avg = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;
    const net =
      row.reactions.filter((r) => r.value === "like").length -
      row.reactions.filter((r) => r.value === "dislike").length;
    if (avg < 7 && net <= 0) continue;

    const key = libraryKey(row.media.media_type, row.media.tmdb_id);
    const prev = best.get(key);
    const fromFamily = row.group_id !== null || Boolean(prev?.fromFamily);
    if (!prev || avg > prev.avg || (avg === prev.avg && net > prev.net)) {
      best.set(key, {
        tmdbId: row.media.tmdb_id,
        mediaType: row.media.media_type,
        title: row.media.title,
        fromFamily,
        avg,
        net,
        added: Date.parse(row.created_at),
      });
    } else {
      prev.fromFamily = fromFamily;
    }
  }

  return [...best.values()]
    .sort((a, b) => b.avg - a.avg || b.net - a.net || b.added - a.added)
    .slice(0, limit)
    .map(({ tmdbId, mediaType, title, fromFamily }) => ({
      tmdbId,
      mediaType,
      title,
      fromFamily,
    }));
}

/** The movie nights going on in the signed-in user's families that they could join. Empty if the lookup fails. */
export async function getActiveMovieNights(): Promise<ActiveNight[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("active_movie_nights");
  if (error) {
    // Logged, not thrown: a failure here shouldn't take down every page.
    console.error("Could not load movie nights:", error.message);
    return [];
  }
  return (data ?? []) as ActiveNight[];
}

/**
 * One family's planned movie nights (see planned_movie_nights()): the ones still planned, soonest first, then those
 * cancelled or passed in the last day. Empty if the lookup fails or the database doesn't have the function yet, so the
 * Movie night page works either way.
 */
export async function getPlannedNights(groupId: string): Promise<PlannedNight[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("planned_movie_nights", { p_group: groupId });
  if (error) {
    // PGRST202: the database doesn't have the function yet.
    if (error.code !== "PGRST202") console.error("Could not load planned movie nights:", error.message);
    return [];
  }
  return parsePlans(data);
}

/**
 * The planned movie nights to remind the signed-in user of, across their families (see due_movie_night_plans()): from an
 * hour before to three hours after, not those they can't come to. Empty if the lookup fails or the database doesn't have
 * the function yet, so no page is held up by it.
 */
export async function getDuePlans(): Promise<DuePlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("due_movie_night_plans");
  if (error) {
    // PGRST202: the database doesn't have the function yet.
    if (error.code !== "PGRST202") console.error("Could not load planned movie nights to remind of:", error.message);
    return [];
  }
  return parseDuePlans(data);
}

/**
 * One family's movie nights that are over (finished, cancelled or expired), newest first, `limit` at a time from
 * `offset` (row level security keeps everyone but its members out). Nights still going aren't here: they come from
 * active_movie_nights(). `hasMore` says whether there is another page.
 */
export async function getNightHistory(
  groupId: string,
  offset: number,
  limit: number,
): Promise<{ entries: HistoryEntry[]; hasMore: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("movie_nights")
    .select(
      `id, group_id, source, status, genres, happened_on, ended_by,
       family:groups(name),
       picked:media!picked_media_id(title, poster_path, tmdb_id, media_type, release_year),
       members:movie_night_members(watched, profile:profiles(display_name, avatar_url)),
       stacks:movie_night_stacks(count),
       cards:movie_night_candidates(count)`,
    )
    .eq("group_id", groupId)
    .neq("status", "open")
    .order("happened_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);
  if (error) {
    console.error("Could not load movie night history:", error.message);
    throw new Error("Couldn't load movie-night history. Please try again.");
  }

  type Row = {
    id: string;
    group_id: string;
    family: { name: string } | null;
    source: "swipe" | "logged";
    status: HistoryEntry["status"];
    genres: string[];
    happened_on: string | null;
    ended_by: string | null;
    picked: { title: string; poster_path: string | null; tmdb_id: number; media_type: MediaType; release_year: number | null } | null;
    members: { watched: boolean; profile: { display_name: string; avatar_url: string | null } | null }[];
    stacks: { count: number }[];
    cards: { count: number }[];
  };
  const rows = (data ?? []) as unknown as Row[];

  // Whoever cancelled isn't linked to a profile (it is cleared with their account), so their names come separately.
  const enders = [...new Set(rows.filter((r) => r.status === "cancelled" && r.ended_by).map((r) => r.ended_by as string))];
  const names = new Map<string, string>();
  if (enders.length > 0) {
    const { data: people } = await supabase.from("profiles").select("id, display_name").in("id", enders);
    for (const person of (people ?? []) as { id: string; display_name: string }[]) names.set(person.id, person.display_name);
  }

  const shown = rows.slice(0, limit);

  // Do not present incomplete attendance as a complete history when loading guest names fails.
  const guests = new Map<string, string[]>();
  const swipeNights = shown.map((r) => r.id);
  if (swipeNights.length > 0) {
    const { data: found, error: guestError } = await supabase.rpc("movie_night_guest_names", { p_nights: swipeNights });
    if (guestError) {
      console.error("Could not load the guests of movie nights:", guestError.message);
      throw new Error("Couldn't load the participants of movie nights. Please try again.");
    } else {
      for (const guest of (found ?? []) as { night_id: string; name: string }[]) {
        guests.set(guest.night_id, [...(guests.get(guest.night_id) ?? []), guest.name]);
      }
    }
  }

  const entries = shown.map((r): HistoryEntry => {
    const picked = r.status === "closed";
    return {
      id: r.id,
      groupId: r.group_id,
      groupName: r.family?.name ?? "",
      source: r.source,
      status: r.status,
      happenedOn: r.happened_on,
      genres: r.genres,
      endedByName: r.ended_by ? (names.get(r.ended_by) ?? null) : null,
      picked: r.picked
        ? {
            title: r.picked.title,
            posterPath: r.picked.poster_path,
            tmdbId: r.picked.tmdb_id,
            mediaType: r.picked.media_type,
            year: r.picked.release_year,
          }
        : null,
      people: nightPeople({
        picked,
        members: r.members
          .filter((m) => m.profile)
          .map((m) => ({ name: m.profile!.display_name, avatarUrl: m.profile!.avatar_url, watched: m.watched })),
        guests: guests.get(r.id) ?? [],
      }),
      stacks: r.stacks[0]?.count ?? 0,
      cards: r.cards[0]?.count ?? 0,
    };
  });
  return { entries, hasMore: rows.length > limit };
}

/**
 * Everything the room needs about one night, as the signed-in user may see it. Null when it isn't theirs or doesn't
 * exist; `full` also sends the cards (the light version is for polling).
 */
export async function getMovieNightState(nightId: string, full: boolean): Promise<NightState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("movie_night_state", { p_night: nightId, p_full: full });
  if (error) {
    if (/not available/i.test(error.message)) return null;
    throw new Error(`Could not load the movie night: ${error.message}`);
  }
  return (data ?? null) as NightState | null;
}
