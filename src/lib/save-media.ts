import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { detailsToMediaRow } from "@/lib/tmdb";

/**
 * Saves a title's TMDB data in the shared `media` table and returns its id.
 *
 * Everyone reads this table, so nobody can write it from the browser: signed-in
 * users have no insert or update rights on it (see db_init.sql). The server does
 * it instead, with the service-role key, and only ever with data that came from TMDB.
 */
export async function saveMedia(
  row: ReturnType<typeof detailsToMediaRow>,
): Promise<{ id: string } | { error: string }> {
  const admin = createAdminClient();
  if (!admin) {
    return { error: "Couldn't save this title. Please try again later." };
  }
  const { data, error } = await admin
    .from("media")
    .upsert(row, { onConflict: "tmdb_id,media_type" })
    .select("id")
    .single();
  if (error || !data) {
    console.error("Saving movie info failed:", error?.message);
    return { error: "Couldn't save this title. Please try again later." };
  }
  return { id: (data as { id: string }).id };
}

/** Saves several titles in one go (a movie night's suggestions); returns each one's id by "movie:123" / "tv:456". */
export async function saveMediaMany(
  rows: ReturnType<typeof detailsToMediaRow>[],
): Promise<Map<string, string> | { error: string }> {
  if (rows.length === 0) return new Map();
  const admin = createAdminClient();
  if (!admin) {
    return { error: "Couldn't save these titles. Please try again later." };
  }
  const { data, error } = await admin
    .from("media")
    .upsert(rows, { onConflict: "tmdb_id,media_type" })
    .select("id, tmdb_id, media_type");
  if (error || !data) {
    console.error("Saving movie info failed:", error?.message);
    return { error: "Couldn't save these titles. Please try again later." };
  }
  return new Map(
    (data as { id: string; tmdb_id: number; media_type: string }[]).map((r) => [
      `${r.media_type}:${r.tmdb_id}`,
      r.id,
    ]),
  );
}
