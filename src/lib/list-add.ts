import "server-only";

import type { createClient } from "@/lib/supabase/server";

/**
 * Puts a title that is already saved on a shared (groupId) or personal (null) list. A title that was removed is only
 * hidden, so adding it again restores it with its ratings. Says so when it is already there.
 */
export async function putOnList(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  mediaId: string,
  groupId: string | null,
): Promise<{ error?: string }> {
  let existing = supabase.from("list_items").select("id, deleted_at").eq("media_id", mediaId);
  existing = groupId ? existing.eq("group_id", groupId) : existing.is("group_id", null).eq("added_by", userId);

  const { data: found } = await existing.maybeSingle();
  const prior = found as { id: string; deleted_at: string | null } | null;
  if (prior && !prior.deleted_at) {
    return { error: "It's already on this list." };
  }
  if (prior) {
    const { error } = await supabase.from("list_items").update({ deleted_at: null }).eq("id", prior.id);
    return error ? { error: error.message } : {};
  }
  const { error } = await supabase
    .from("list_items")
    .insert({ group_id: groupId, added_by: userId, media_id: mediaId, status: "want" });
  return error ? { error: error.message } : {};
}
