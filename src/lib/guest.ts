import "server-only";

import { cookies } from "next/headers";

import {
  GUEST_SECRET,
  guestPath,
  type GuestLinkInfo,
  type NightState,
} from "@/lib/movie-night";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Guests have no account: the server speaks for them with the service role, through functions that only it may run
 * (see "Movie night guests" in db_init.sql). A guest's secret lives in this cookie, which the browser only sends to
 * the pages under their own link (the path), where the page, its state and its actions are, and which scripts can't
 * read.
 */
export const GUEST_COOKIE = "famflix_guest";
/** A night closes after 12 quiet hours, so a day is more than a guest needs. */
const GUEST_COOKIE_SECONDS = 24 * 60 * 60;

/** The options for a guest's cookie for the link `token`. */
export function guestCookieOptions(token: string, maxAge = GUEST_COOKIE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: guestPath(token),
    maxAge,
  };
}

/** The secret in the request's guest cookie, if it is one. */
export async function readGuestSecret(): Promise<string | null> {
  const value = (await cookies()).get(GUEST_COOKIE)?.value;
  return value && GUEST_SECRET.test(value) ? value : null;
}

/** The service-role client for the guest functions. */
export function guestDb() {
  const db = createAdminClient();
  if (!db) throw new Error("Guests need SUPABASE_SERVICE_ROLE_KEY on the server.");
  return db;
}

export type GuestState = { ok: true; state: NightState } | { ok: false; reason: "over" | "missing" };

/**
 * The night as its guest may see it. "over" means the night has ended (the page thanks the guest), "missing" that this
 * secret is nobody's: it never was, or its guest was taken out.
 */
export async function loadGuestState(secret: string, full: boolean): Promise<GuestState> {
  const { data, error } = await guestDb().rpc("guest_movie_night_state", { p_secret: secret, p_full: full });
  if (error) {
    if (/is over/i.test(error.message)) return { ok: false, reason: "over" };
    if (/not available/i.test(error.message)) return { ok: false, reason: "missing" };
    throw new Error(`Could not load the guest's movie night: ${error.message}`);
  }
  return { ok: true, state: data as NightState };
}

/** What a link says before anyone has joined; a link that is wrong, replaced, turned off or over says it is not open. */
export async function loadGuestLink(token: string): Promise<GuestLinkInfo> {
  if (!GUEST_SECRET.test(token)) return { open: false };
  const { data, error } = await guestDb().rpc("guest_link_info", { p_token: token });
  if (error) throw new Error(`Could not look up a guest link: ${error.message}`);
  return data as GuestLinkInfo;
}
