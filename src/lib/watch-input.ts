import "server-only";

import type { createClient } from "@/lib/supabase/server";

/** Names and notes: at most this many characters (the database refuses longer ones too). */
export const MAX_TEXT = 250;

/** Characters as the database counts them (an emoji is one, though it is two JavaScript chars). */
export function tooLong(text: string): boolean {
  return [...text].length > MAX_TEXT;
}

/** A real calendar day written as YYYY-MM-DD (not 2026-13-45). */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Scores run from 1 to 10 with one decimal (6.7); returns undefined if out of range. */
export function cleanScore(score: number | null): number | null | undefined {
  if (score === null) return null;
  if (!Number.isFinite(score) || score < 1 || score > 10) return undefined;
  return Math.round(score * 10) / 10;
}

/** Sets the note on the user's rating, creating one without a score if needed (but never an empty one). */
export async function saveOwnNote(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemId: string,
  userId: string,
  note: string,
): Promise<{ error?: string }> {
  const comment = note.trim() || null;
  if (comment && tooLong(comment)) {
    return { error: `Notes can be at most ${MAX_TEXT} characters.` };
  }
  const { data: existing } = await supabase
    .from("ratings")
    .select("id")
    .eq("list_item_id", itemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("ratings")
      .update({ comment, updated_at: new Date().toISOString() })
      .eq("id", (existing as { id: string }).id);
    return error ? { error: error.message } : {};
  }
  if (!comment) return {};
  const { error } = await supabase
    .from("ratings")
    .insert({ list_item_id: itemId, user_id: userId, comment });
  return error ? { error: error.message } : {};
}
