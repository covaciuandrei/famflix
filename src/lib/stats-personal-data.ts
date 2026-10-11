import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { HistoryRow } from "@/lib/rewatch";
import { parseSeriesInfo } from "@/lib/series";
import {
  periodFromParam,
  personalStats,
  yearsWithData,
  type Period,
  type PersonalInput,
  type PersonalStats,
  type PersonalTitle,
} from "@/lib/stats";
import { genreNames, loadMedia, MEDIA_SELECT, readAll, type MediaRow } from "@/lib/stats-data";

/** The episodes someone watched: per series on My list (by the entry's id) and per month (`YYYY-MM`). */
export interface EpisodeCounts {
  bySeries: Record<string, number>;
  byMonth: Record<string, number>;
}

const NO_EPISODES: EpisodeCounts = { bySeries: {}, byMonth: {} };

const asCounts = (value: unknown): Record<string, number> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => Number.isFinite(entry[1])))
    : {};

/**
 * How many episodes the signed-in person watched, in a year or (null) ever. Without the database function (it isn't run
 * yet) there is no count: logged, and the page leaves the episodes out.
 */
export async function getEpisodeCounts(period: Period): Promise<EpisodeCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_episode_counts", { p_year: period });
  if (error) {
    // PGRST202: the database doesn't have the function yet.
    if (error.code !== "PGRST202") console.error("Could not count episodes:", error.message);
    return NO_EPISODES;
  }
  const counts = (data ?? {}) as { by_series?: unknown; by_month?: unknown };
  return { bySeries: asCounts(counts.by_series), byMonth: asCounts(counts.by_month) };
}

interface MyRating {
  user_id: string;
  score: number | null;
}

interface PersonalItemRow {
  id: string;
  media_id: string;
  status: "want" | "watched";
  watched_at: string | null;
  created_at: string;
  media: MediaRow | null;
  ratings: MyRating[];
}

interface FamilyWatchRow {
  watched_on: string;
  list_items: { media_id: string; media: MediaRow | null; ratings: MyRating[] } | null;
}

const MEDIA_WITH_SERIES = `${MEDIA_SELECT}, series`;

/**
 * Every title the signed-in person has watched, with each day they watched it and their own score: from My list (the ones
 * taken off it too), from their earlier viewings, and from what they watched with a family. A viewing that is in more than
 * one of these is one day. A series on My list that is followed by episode has no days of its own from My list (its
 * episodes are what was watched) and is told apart by the entry's id, which is what the episode counts are keyed by. Null
 * when something couldn't be read.
 */
export async function getPersonalTitles(userId: string): Promise<PersonalTitle[] | null> {
  const supabase = await createClient();
  const [items, history, familyWatches] = await Promise.all([
    readAll<PersonalItemRow>("your list", (from, to) =>
      supabase
        .from("list_items")
        .select(`id, media_id, status, watched_at, created_at, media(${MEDIA_WITH_SERIES}), ratings(user_id, score)`)
        .is("group_id", null)
        .eq("added_by", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    // PGRST205: the database doesn't have the history table yet, so there are no earlier viewings.
    readAll<HistoryRow>(
      "your earlier viewings",
      (from, to) =>
        supabase
          .from("watch_history")
          .select("user_id, media_id, watched_on")
          .eq("user_id", userId)
          .order("watched_on")
          .order("id")
          .range(from, to),
      ["PGRST205"],
    ),
    readAll<FamilyWatchRow>("what you watched with your families", (from, to) =>
      supabase
        .from("watches")
        .select(`watched_on, list_items!inner(media_id, status, media(${MEDIA_WITH_SERIES}), ratings(user_id, score))`)
        .eq("user_id", userId)
        .eq("list_items.status", "watched")
        .order("watched_on")
        .order("id")
        .range(from, to),
    ),
  ]);
  if (!items || !history || !familyWatches) return null;

  interface Draft {
    media: MediaRow;
    days: Set<string>;
    episodeEntry: string | null;
    listScore: number | null;
    familyScore: number | null;
  }
  const drafts = new Map<string, Draft>();
  const draft = (media: MediaRow): Draft => {
    const found = drafts.get(media.id);
    if (found) return found;
    const created: Draft = { media, days: new Set(), episodeEntry: null, listScore: null, familyScore: null };
    drafts.set(media.id, created);
    return created;
  };
  const myScore = (ratings: MyRating[]) =>
    ratings.find((r) => r.user_id === userId && typeof r.score === "number")?.score ?? null;

  for (const item of items) {
    if (!item.media) continue;
    const d = draft(item.media);
    d.listScore = myScore(item.ratings);
    if (parseSeriesInfo(item.media.series) !== null) d.episodeEntry = item.id;
    else if (item.status === "watched") d.days.add((item.watched_at ?? item.created_at).slice(0, 10));
  }
  for (const watch of familyWatches) {
    const item = watch.list_items;
    if (!item?.media) continue;
    const d = draft(item.media);
    d.days.add(watch.watched_on.slice(0, 10));
    d.familyScore ??= myScore(item.ratings);
  }
  const onlyInHistory = [...new Set(history.map((h) => h.media_id))].filter((id) => !drafts.has(id));
  const orphanMedia = onlyInHistory.length > 0 ? await loadMedia(supabase, onlyInHistory) : [];
  if (!orphanMedia) return null;
  for (const media of orphanMedia) draft(media);
  for (const row of history) drafts.get(row.media_id)?.days.add(row.watched_on.slice(0, 10));

  return [...drafts.values()].map((d) => ({
    key: d.episodeEntry ?? d.media.id,
    title: d.media.title,
    type: d.media.media_type,
    runtime: d.media.runtime,
    genres: genreNames(d.media.genres),
    days: [...d.days],
    score: d.listScore ?? d.familyScore,
  }));
}

/**
 * The signed-in person's year (or all time): their stats, and the years the picker offers (those with a viewing or an
 * episode in them). Null when something couldn't be read.
 */
export async function getPersonalStats(
  userId: string,
  yearParam: string | string[] | undefined,
): Promise<{ stats: PersonalStats; years: number[] } | null> {
  const [titles, allTime] = await Promise.all([getPersonalTitles(userId), getEpisodeCounts(null)]);
  if (!titles) return null;
  const years = yearsWithData([
    ...titles.flatMap((t) => t.days),
    ...Object.keys(allTime.byMonth).map((month) => `${month}-01`),
  ]);
  const period = periodFromParam(yearParam, years);
  const episodes = period === null ? allTime : await getEpisodeCounts(period);
  const input: PersonalInput = { titles, episodes };
  return { stats: personalStats(input, period), years };
}
