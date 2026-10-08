import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client with the service-role key, which skips the database's security rules. Server-only, and
 * only for what signed-in users must not be able to do themselves: saving the shared movie info
 * (save-media.ts) and counting requests (rate-limit.ts). Never pass it user-chosen ids other than the
 * signed-in user's own.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to your environment (see .env.local.example).",
    );
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
