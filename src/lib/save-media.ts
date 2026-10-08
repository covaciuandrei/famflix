import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { detailsToMediaRow } from "@/lib/tmdb";

/**
 * Saves a title's TMDB data in the shared `media` table and returns its id.
 *
 * Everyone reads this table, so nobody can write it from the browser: signed-in
 * users have no insert or update rights on it (see db_init.sql). The server does
 * it instead, with the service-role key, which skips those rules. That key can
 * do anything in the database, so it stays in this file and only ever receives
 * data that came from TMDB.
 */
export async function saveMedia(
  row: ReturnType<typeof detailsToMediaRow>,
): Promise<{ id: string } | { error: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to your environment (see .env.local.example).",
    );
    return { error: "Couldn't save this title. Please try again later." };
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
