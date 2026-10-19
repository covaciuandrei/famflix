"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { validGuestSelections } from "@/lib/attendance";
import { readPickedDay } from "@/lib/day";
import { isUuid } from "@/lib/movie-night";
import type { FamilyGuest, GuestSelection, ViewingDetails } from "@/lib/types";
import { cleanScore } from "@/lib/watch-input";

type Result = { error?: string };

function refresh() {
  revalidatePath("/app", "layout");
}

export async function familyGuests(groupId: string, search = "", selected: string[] = []): Promise<Result & { guests?: FamilyGuest[]; hasMore?: boolean }> {
  const { supabase } = await requireUser();
  if (!isUuid(groupId) || typeof search !== "string" || !Array.isArray(selected) || selected.length > 10 || selected.some((id) => !isUuid(id))) return { error: "This family isn't valid." };
  let query = supabase.from("family_guests").select("id,group_id,name,account_id").eq("group_id", groupId)
    .is("account_id", null).order("name").limit(101);
  if (search.trim()) query = query.ilike("name", `%${search.trim().slice(0, 30).replace(/[%_\\]/g, "\\$&")}%`);
  const [found, extra] = await Promise.all([
    query.returns<FamilyGuest[]>(),
    selected.length ? supabase.from("family_guests").select("id,group_id,name,account_id")
      .eq("group_id", groupId).is("account_id", null).in("id", selected).returns<FamilyGuest[]>() : null,
  ]);
  if (found.error || extra?.error) {
    console.error("Could not load saved guests:", found.error?.message ?? extra?.error?.message);
    return { error: "Couldn't load the saved guests. Please try again." };
  }
  const all = new Map([...(found.data ?? []).slice(0, 100), ...(extra?.data ?? [])].map((g) => [g.id, g]));
  return { guests: [...all.values()], hasMore: (found.data?.length ?? 0) > 100 };
}

export async function saveFamilyGuest(groupId: string, name: string, guestId?: string): Promise<Result & { id?: string }> {
  const { supabase } = await requireUser();
  if (!isUuid(groupId) || typeof name !== "string" || (guestId !== undefined && !isUuid(guestId))) return { error: "This guest isn't valid." };
  const { data, error } = await supabase.rpc("save_family_guest", { p_group: groupId, p_name: name, p_guest: guestId ?? null });
  if (error) return { error: error.message };
  refresh();
  return { id: data as string };
}

export async function mergeFamilyGuests(from: string, into: string): Promise<Result> {
  const { supabase } = await requireUser();
  if (!isUuid(from) || !isUuid(into)) return { error: "Select two saved guests." };
  const { error } = await supabase.rpc("merge_family_guests", { p_from: from, p_into: into });
  if (error) return { error: error.message };
  refresh();
  return {};
}

export async function viewingDetails(viewingId: string): Promise<Result & { info?: ViewingDetails }> {
  const { supabase } = await requireUser();
  if (!isUuid(viewingId)) return { error: "This viewing isn't valid." };
  const { data, error } = await supabase.rpc("family_viewing_details", { p_viewing: viewingId });
  if (error) return { error: error.message };
  return { info: data as ViewingDetails };
}

export async function currentViewing(itemId: string): Promise<Result & { info?: ViewingDetails }> {
  const { supabase } = await requireUser();
  if (!isUuid(itemId)) return { error: "This title isn't valid." };
  const { data, error } = await supabase.from("watches").select("viewing_id").eq("list_item_id", itemId)
    .order("watched_on", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return { error: error.message };
  if (!data?.viewing_id) return { error: "This viewing couldn't be found. Refresh the page and try again." };
  return viewingDetails(data.viewing_id);
}

export async function editViewing(input: {
  viewingId: string; revision: number; watchedOn: string | null; viewers: { userId: string }[]; guests: GuestSelection[];
}): Promise<Result> {
  const { supabase } = await requireUser();
  const picked = readPickedDay(input?.watchedOn);
  if ("error" in picked) return picked;
  if (!isUuid(input.viewingId) || !Number.isSafeInteger(input.revision) || input.revision < 1
    || !Array.isArray(input.viewers) || input.viewers.length < 1 || input.viewers.length > 50
    || input.viewers.some((v) => !v || !isUuid(v.userId)) || new Set(input.viewers.map((v) => v.userId)).size !== input.viewers.length
    || !validGuestSelections(input.guests)) return { error: "Select valid participants for this viewing." };
  const { error } = await supabase.rpc("edit_family_viewing", {
    p_viewing: input.viewingId, p_on: picked.day, p_members: input.viewers.map((v) => v.userId),
    p_guests: input.guests.map((g) => g.guestId), p_revision: input.revision,
  });
  if (error) return { error: error.message };
  refresh();
  return {};
}

export async function setGuestScore(itemId: string, guestId: string, score: number | null): Promise<Result> {
  const { supabase } = await requireUser();
  const cleaned = cleanScore(score);
  if (!isUuid(itemId) || !isUuid(guestId)) return { error: "This guest or title isn't valid." };
  if (cleaned === undefined) return { error: "Scores must be between 1 and 10." };
  const { error } = await supabase.rpc("set_guest_rating", { p_item: itemId, p_guest: guestId, p_score: cleaned });
  if (error) return { error: error.message };
  refresh();
  return {};
}

export async function guestInvitation(guestId: string, nightId?: string): Promise<Result & { path?: string }> {
  const { supabase } = await requireUser();
  if (!isUuid(guestId) || (nightId !== undefined && !isUuid(nightId))) return { error: "This invitation isn't valid." };
  const { data, error } = await supabase.rpc("create_guest_invitation", { p_guest: guestId, p_night: nightId ?? null });
  if (error) return { error: error.message };
  return { path: `${nightId ? "/guest" : "/guest/account"}/${data as string}` };
}

export async function revokeGuestInvitations(guestId: string, nightId?: string): Promise<Result> {
  const { supabase } = await requireUser();
  if (!isUuid(guestId) || (nightId !== undefined && !isUuid(nightId))) return { error: "This invitation isn't valid." };
  const { error } = await supabase.rpc("revoke_guest_invitations", { p_guest: guestId, p_night: nightId ?? null });
  return error ? { error: error.message } : {};
}

export async function claimGuest(token: string): Promise<Result & { summary?: { familyId: string; viewings: number; scores: number; alreadyLinked: boolean } }> {
  const { supabase } = await requireUser();
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "This invitation isn't valid." };
  const { data, error } = await supabase.rpc("claim_family_guest", { p_token: token });
  if (error) return { error: error.message };
  refresh();
  return { summary: data as { familyId: string; viewings: number; scores: number; alreadyLinked: boolean } };
}
