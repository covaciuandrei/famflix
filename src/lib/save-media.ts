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
