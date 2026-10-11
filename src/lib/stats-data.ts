import "server-only";

import { createClient } from "@/lib/supabase/server";
import { earlierByTitle, type HistoryRow } from "@/lib/rewatch";
import { mergeViewings, type FamilyInput, type FamilyTitle, type Viewing } from "@/lib/stats";
import type { MediaType } from "@/lib/types";

type Client = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;
// 20 pages is 20,000 rows: far more than a family list or a watch history has.
const MAX_PAGES = 20;

interface PageResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/**
 * Reads every row of a query, a page at a time (the API hands out at most 1000 rows at a time). Returns null when a page
 * can't be read, after logging why, so that a failure is never passed off as "nothing watched". `missing` are the error
 * codes of a table the database doesn't have yet, which count as no rows. The rows are taken to be what the query asks for.
 */
export async function readAll<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<PageResult>,
  missing: string[] = [],
): Promise<T[] | null> {
  const rows: T[] = [];
  for (let from = 0; from < PAGE * MAX_PAGES; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) {
      if (missing.includes(error.code ?? "")) return [];
      console.error(`Could not load ${what}:`, error.message);
      return null;
    }
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) break;
  }
  return rows;
}

export interface MediaRow {
  id: string;
  media_type: MediaType;
  title: string;
  runtime: number | null;
  genres: unknown;
  /** Only where it is asked for: a series' seasons, to tell one that is followed by episode. */
  series?: unknown;
}

interface ItemRow {
  id: string;
  media_id: string;
  status: "want" | "watched";
  media: MediaRow | null;
  ratings: { user_id: string; score: number | null }[];
  reactions: { user_id: string; value: "like" | "dislike" }[];
  watches: { user_id: string; watched_on: string }[];
}

export const MEDIA_SELECT = "id, media_type, title, runtime, genres";
const ITEM_SELECT = `id, media_id, status, media(${MEDIA_SELECT}), ratings(user_id, score), reactions(user_id, value), watches(user_id, watched_on)`;

export const genreNames = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((g): g is string => typeof g === "string") : [];

/** The viewing a family title has now: the days on its watch records, with who was there each day. */
function currentViewings(item: ItemRow): Viewing[] {
  if (item.status !== "watched") return [];
  const days = new Map<string, string[]>();
  for (const watch of item.watches) {
    const day = watch.watched_on.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), watch.user_id]);
  }
  return [...days].map(([on, userIds]) => ({ on, userIds }));
}

/** The details of titles that only the history knows (their list entry is gone), a few at a time. */
export async function loadMedia(supabase: Client, ids: string[]): Promise<MediaRow[] | null> {
  const found: MediaRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("media").select(MEDIA_SELECT).in("id", ids.slice(i, i + 100));
    if (error) {
      console.error("Could not load titles for the stats:", error.message);
      return null;
    }
    found.push(...((data ?? []) as MediaRow[]));
  }
  return found;
}

/**
 * Everything the family stats are worked out from, and only what the family's members can already see: its titles (the
 * ones taken off the list too: they were watched) with their scores, likes and viewings, its earlier viewings, and the days
 * of its movie nights. Null when something couldn't be read.
 */
export async function getFamilyStatsInput(
  groupId: string,
  members: { id: string; name: string }[],
): Promise<FamilyInput | null> {
  const supabase = await createClient();
  const [items, history, nights] = await Promise.all([
    readAll<ItemRow>("the family's titles", (from, to) =>
      supabase.from("list_items").select(ITEM_SELECT).eq("group_id", groupId).order("created_at").order("id").range(from, to),
    ),
    // PGRST205: the database doesn't have the history table yet, so there are no earlier viewings.
    readAll<HistoryRow>(
      "the family's earlier viewings",
      (from, to) =>
        supabase
          .from("watch_history")
          .select("user_id, media_id, watched_on")
          .eq("group_id", groupId)
          .order("watched_on")
          .order("id")
          .range(from, to),
      ["PGRST205"],
    ),
    readAll<{ happened_on: string }>("the family's movie nights", (from, to) =>
      supabase
        .from("movie_nights")
        .select("happened_on")
        .eq("group_id", groupId)
        .eq("source", "swipe")
        .eq("status", "closed")
        .order("happened_on")
        .order("id")
        .range(from, to),
    ),
  ]);
  if (!items || !history || !nights) return null;

  const earlier = earlierByTitle(history);
  const listed = new Set(items.map((item) => item.media_id));
  const orphans = [...earlier.keys()].filter((id) => !listed.has(id));
  const orphanMedia = orphans.length > 0 ? await loadMedia(supabase, orphans) : [];
  if (!orphanMedia) return null;

  const toTitle = (media: MediaRow, rest: Pick<FamilyTitle, "viewings" | "scores" | "likes">): FamilyTitle => ({
    key: media.id,
    title: media.title,
    type: media.media_type,
    runtime: media.runtime,
    genres: genreNames(media.genres),
    ...rest,
  });

  const titles: FamilyTitle[] = [
    ...items.flatMap((item) =>
      item.media
        ? [
            toTitle(item.media, {
              viewings: mergeViewings(currentViewings(item), earlier.get(item.media_id) ?? []),
              scores: item.ratings.flatMap((r) => (typeof r.score === "number" ? [{ userId: r.user_id, score: r.score }] : [])),
              likes: item.reactions.filter((r) => r.value === "like").length,
            }),
          ]
        : [],
    ),
    ...orphanMedia.map((media) => toTitle(media, { viewings: mergeViewings(earlier.get(media.id) ?? []), scores: [], likes: 0 })),
  ];

  return { titles, nights: nights.map((n) => n.happened_on.slice(0, 10)), members };
}

