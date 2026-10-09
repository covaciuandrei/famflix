import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { libraryKey } from "@/lib/constants";
import { timeAgo } from "@/lib/format";
import type { ActiveNight, NightState } from "@/lib/movie-night";
import type {
  ActivityEvent,
  Group,
  GroupMemberWithProfile,
  LibraryIndex,
  ListItemCard,
  ListItemWithDetails,
  MediaType,
  PendingRating,
  Profile,
  RemovedItem,
} from "@/lib/types";

const LIST_SELECT =
  "*, media(*), profiles(id,display_name,avatar_url), ratings(*, profiles(id,display_name,avatar_url)), reactions(*), watches(user_id,watched_on,logged_by,skipped_at)";

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
  if (error || !data) return [];

  return (data as unknown as ListItemWithDetails[])
    .map((row) => toCard(row, opts.userId))
    .filter((c): c is ListItemCard => c !== null);
}

function toCard(row: ListItemWithDetails, userId: string): ListItemCard | null {
  if (!row.media) return null;

  const likeCount = row.reactions.filter((r) => r.value === "like").length;
  const dislikeCount = row.reactions.filter(
    (r) => r.value === "dislike",
  ).length;

  const scored = row.ratings.filter(
    (r): r is typeof r & { score: number } => typeof r.score === "number",
  );
  const avgScore = scored.length
    ? scored.reduce((sum, r) => sum + r.score, 0) / scored.length
    : null;

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
    },
    media: row.media,
    addedBy: row.profiles,
    ratings: row.ratings,
    likeCount,
    dislikeCount,
    avgScore,
    ratingCount: scored.length,
    myScore: mine?.score ?? null,
    myComment: mine?.comment ?? null,
    myReaction,
    viewers: row.watches,
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

/** For every title on the user's lists: which lists have it and who in their families has seen it. */
export async function getLibraryIndex(
  userId: string,
  groups: { id: string; name: string }[],
): Promise<LibraryIndex> {
  const supabase = await createClient();
  const [items, watches, members] = await Promise.all([
    supabase
      .from("list_items")
      .select("id, group_id, status, media(tmdb_id, media_type)")
      .is("deleted_at", null),
    supabase
      .from("watches")
      .select("user_id, list_items(deleted_at, media(tmdb_id, media_type))"),
    supabase.from("group_members").select("user_id, profiles(display_name)"),
  ]);

  type MediaRef = { tmdb_id: number; media_type: MediaType } | null;
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const names = new Map(
    ((members.data ?? []) as unknown as {
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

  for (const w of (watches.data ?? []) as unknown as {
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

/** The user's best-loved titles: an average score of 7+ or more likes than dislikes. */
export async function getSuggestionSeeds(limit: number): Promise<SuggestionSeed[]> {
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
    if (!row.media) continue;
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
