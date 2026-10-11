/** Shared application + database domain types. */

export type MediaType = "movie" | "tv";
export type ListStatus = "want" | "watched";
export type ReactionValue = "like" | "dislike";
export type MemberRole = "owner" | "member";

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  invite_code: string;
  /** Codes last 24 hours; refreshInviteCodes() swaps expired ones for new ones. */
  invite_code_expires_at: string;
  created_by: string;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
}

export interface GroupMemberWithProfile extends GroupMember {
  profiles: Profile | null;
}

export interface Media {
  id: string;
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  release_year: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string | null;
  tmdb_rating: number | null;
  runtime: number | null;
  genres: string[];
  trailer_key: string | null;
  /** A series' seasons and how far it has aired (see parseSeriesInfo in lib/series.ts); null for a movie. */
  series: unknown;
  updated_at: string;
}

export interface ListItem {
  id: string;
  group_id: string | null;
  added_by: string;
  media_id: string;
  status: ListStatus;
  created_at: string;
  watched_at: string | null;
  /** On My list: the family title a Watched together log put this here from, if one did. */
  source_item_id: string | null;
}

/** A title on My list that a Watched together log put there: who else was on the log, and the day. */
export interface WatchedWith {
  /** The others on the log (not the signed-in person), by name. */
  names: string[];
  /** The day, as YYYY-MM-DD. */
  on: string;
}

export interface Rating {
  id: string;
  list_item_id: string;
  user_id: string;
  score: number | null;
  comment: string | null;
  /** Who actually entered it; differs from user_id when filled in on their behalf. */
  rated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RatingWithProfile extends Rating {
  profiles: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
}

export interface Reaction {
  id: string;
  list_item_id: string;
  user_id: string;
  value: ReactionValue;
  created_at: string;
}

export type MemberSummary = Pick<Profile, "id" | "display_name" | "avatar_url">;

/** A family member marked as having watched a family-list title. */
export interface Watch {
  user_id: string;
  watched_on: string;
  logged_by: string | null;
  skipped_at: string | null;
}

/** A family title you were marked as having watched but haven't rated yourself or skipped. */
export interface PendingRating {
  list_item_id: string;
  group_name: string;
  watched_on: string;
  logged_by: string | null;
  logged_by_name: string | null;
  media_type: MediaType;
  tmdb_id: number;
  title: string;
  release_year: number | null;
  poster_path: string | null;
  /** A score someone else filled in for you, to confirm or change. */
  filled_in_score: number | null;
  filled_in_by_name: string | null;
}

/** A title removed from a list in the last 30 days, which can still be restored. */
export interface RemovedItem {
  id: string;
  title: string;
  posterPath: string | null;
  /** e.g. "Removed by Ana · 2 days ago" (built on the server). */
  label: string;
}

export type ActivityKind =
  | "created"
  | "joined"
  | "left"
  | "removed_member"
  | "new_owner"
  | "renamed"
  | "new_code"
  | "added"
  | "watched"
  | "watched_together"
  | "rated"
  | "removed"
  | "restored"
  | "movie_night_started"
  | "movie_night_cancelled"
  | "movie_night_added";

export interface ActivityEvent {
  id: string;
  group_id: string;
  actor_id: string | null;
  actor_name: string | null;
  kind: ActivityKind;
  list_item_id: string | null;
  media_title: string | null;
  subject_id: string | null;
  subject_name: string | null;
  score: number | null;
  detail: string | null;
  created_at: string;
  groups: { name: string } | null;
}

/** What the signed-in user's lists already know about one TMDB title. */
export interface LibraryEntry {
  /** My list (listId null) first, then families; itemId is the list item, for removing it. */
  lists: { listId: string | null; itemId: string; label: string; watched: boolean }[];
  /** Names of family members marked as having watched it ("You" for yourself); only filled in when asked for. */
  seenBy: string[];
}

/** Keyed by libraryKey(mediaType, tmdbId). */
export type LibraryIndex = Record<string, LibraryEntry>;

/** A list item joined with its media, ratings, reactions and watch records (from Supabase embeds). */
export interface ListItemWithDetails extends ListItem {
  media: Media | null;
  profiles: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
  ratings: RatingWithProfile[];
  reactions: Reaction[];
  watches: Watch[];
}

/** Where the signed-in person is with a series on My list that has an episode ticked (from my_series_progress()). */
export interface CardSeries {
  /** Aired episodes that are ticked. */
  watched: number;
  /** The first aired episode that isn't ticked; null when everything that has aired is. */
  next: { s: number; e: number } | null;
}

/** A list item with derived aggregates, ready for rendering. */
export interface ListItemCard {
  item: ListItem;
  media: Media;
  addedBy: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
  ratings: RatingWithProfile[];
  likeCount: number;
  dislikeCount: number;
  avgScore: number | null;
  ratingCount: number;
  myScore: number | null;
  myComment: string | null;
  myReaction: ReactionValue | null;
  viewers: Watch[];
  /** Only on My list, for a title a Watched together log put there. */
  watchedWith: WatchedWith | null;
  /** Only on My list, for a series with an episode ticked. */
  series: CardSeries | null;
}

export type SortKey =
  | "recent"
  | "most_liked"
  | "top_rated"
  | "recently_watched"
  | "title";
