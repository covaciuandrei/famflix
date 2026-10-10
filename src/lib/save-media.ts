import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import type { detailsToMediaRow } from "@/lib/tmdb";

type Row = ReturnType<typeof detailsToMediaRow>;

/**
 * Upserts rows into `media`. If the database doesn't have the `series` column yet (the app was updated before the
 * database was), the rows are saved without it, so adding a title keeps working in the meantime.
 */
async function upsertRows(admin: SupabaseClient, rows: Row[]) {
  const run = (toSave: unknown[]) =>
    admin.from("media").upsert(toSave, { onConflict: "tmdb_id,media_type" }).select("id, tmdb_id, media_type");
  const saved = await run(rows);
  if (saved.error?.code !== "PGRST204") return saved;
  console.error("media.series is missing in the database: run the series update from supabase/db_init.sql.");
  return run(rows.map(({ series, ...rest }) => (void series, rest)));
}

/**
 * Saves a title's TMDB data in the shared `media` table and returns its id.
 *
 * Everyone reads this table, so nobody can write it from the browser: signed-in
 * users have no insert or update rights on it (see db_init.sql). The server does
 * it instead, with the service-role key, and only ever with data that came from TMDB.
 */
export async function saveMedia(row: Row): Promise<{ id: string } | { error: string }> {
  const admin = createAdminClient();
  if (!admin) {
    return { error: "Couldn't save this title. Please try again later." };
  }
  const { data, error } = await upsertRows(admin, [row]);
  const saved = (data as { id: string }[] | null)?.[0];
  if (error || !saved) {
    console.error("Saving movie info failed:", error?.message);
    return { error: "Couldn't save this title. Please try again later." };
  }
  return { id: saved.id };
}

/** Saves several titles in one go (a movie night's suggestions); returns each one's id by "movie:123" / "tv:456". */
export async function saveMediaMany(rows: Row[]): Promise<Map<string, string> | { error: string }> {
  if (rows.length === 0) return new Map();
  const admin = createAdminClient();
  if (!admin) {
    return { error: "Couldn't save these titles. Please try again later." };
  }
  const { data, error } = await upsertRows(admin, rows);
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
