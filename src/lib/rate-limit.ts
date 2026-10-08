import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/** How often one person may do the expensive things (each one asks TMDB, which allows ~40 requests a second). */
export const LIMITS = {
  /** Adding a title to a list or marking it watched from its page. */
  addTitle: { action: "add_title", max: 30, seconds: 60 },
  /** Searching for titles. */
  search: { action: "search", max: 60, seconds: 60 },
} as const;

/**
 * Counts one go at `limit` for this user (in the database, so every server instance shares the count).
 * Returns an error message once they've gone over it, otherwise null.
 */
export async function overRateLimit(
  userId: string,
  limit: (typeof LIMITS)[keyof typeof LIMITS],
): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { error } = await admin.rpc("hit_rate_limit", {
    p_user: userId,
    p_action: limit.action,
    p_max: limit.max,
    p_seconds: limit.seconds,
  });
  if (!error) return null;
  if (/too often/i.test(error.message)) return error.message;
  // Don't lock people out because the counter itself failed.
  console.error("Rate limit check failed:", error.message);
  return null;
}
