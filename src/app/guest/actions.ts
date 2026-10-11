"use server";

import { cookies } from "next/headers";

import { GUEST_COOKIE, guestCookieOptions, guestDb, readGuestSecret } from "@/lib/guest";
import { GUEST_SECRET, isUuid, validVotes, type Vote } from "@/lib/movie-night";

export interface GuestActionResult {
  error?: string;
}

// The messages the room tests for (use-vote-queue.ts) say a night, or a stack, takes no more votes.
const GONE = "This movie night is not available";

/**
 * The database words its own refusals for people ("That name is taken in this movie night"): those are passed on.
 * Anything else is a fault of ours and stays out of a guest's sight.
 */
function plain(error: { code?: string; message: string }): string {
  if (error.code === "P0001") return error.message;
  console.error("A guest's request failed:", error.message);
  return "Something went wrong. Please try again.";
}

/**
 * Joins the night of a guest link with a name. The database makes the guest and gives their secret once, which goes
 * straight into a cookie that only this link's pages get, so the page never sees it. Nothing is returned but a refusal
 * in words.
 */
export async function joinAsGuest(token: string, name: string): Promise<GuestActionResult> {
  if (!GUEST_SECRET.test(String(token))) return { error: "This link isn't working." };
  const { data, error } = await guestDb().rpc("guest_join", { p_token: token, p_name: String(name ?? "") });
  if (error) return { error: plain(error) };
  (await cookies()).set(GUEST_COOKIE, (data as { secret: string }).secret, guestCookieOptions(token));
  return {};
}

/**
 * Saves a batch of a guest's votes on one stack (a null vote takes one back) and returns the loves used in it. Like the
 * members' version it doesn't refresh the page: the stack on screen must not change under someone's thumb.
 */
export async function guestCastVotes(
  stackId: string,
  votes: { candidateId: string; vote: Vote | null }[],
): Promise<GuestActionResult & { loves?: number }> {
  if (!isUuid(stackId) || !validVotes(votes)) return { error: "Those votes aren't valid." };
  const secret = await readGuestSecret();
  if (!secret) return { error: GONE };
  const { data, error } = await guestDb().rpc("guest_cast_votes", {
    p_secret: secret,
    p_stack: stackId,
    p_votes: votes.map((v) => ({ candidate_id: v.candidateId, vote: v.vote })),
  });
  return error ? { error: plain(error) } : { loves: Number(data) };
}

/** Marks a guest as done with a stack. */
export async function guestFinishStack(stackId: string): Promise<GuestActionResult> {
  if (!isUuid(stackId)) return { error: "That isn't a stack." };
  const secret = await readGuestSecret();
  if (!secret) return { error: GONE };
  const { error } = await guestDb().rpc("guest_finish_stack", { p_secret: secret, p_stack: stackId });
  return error ? { error: plain(error) } : {};
}
