import { isUuid } from "@/lib/movie-night";
import type { GuestRating, GuestSelection, RatingWithProfile } from "@/lib/types";

export const AUTH_RETURN_COOKIE = "famflix_auth_next";
export const AUTH_RETURN_PATH = "/auth/callback";

export function validGuestSelections(value: unknown): value is GuestSelection[] {
  if (!Array.isArray(value) || value.length > 10) return false;
  return value.every((guest: unknown) => {
    if (guest === null || typeof guest !== "object" || !("guestId" in guest) || !("score" in guest)) return false;
    return isUuid(guest.guestId) && (guest.score === null || (typeof guest.score === "number"
      && Number.isFinite(guest.score) && guest.score >= 1 && guest.score <= 10));
  }) && new Set(value.map((guest: GuestSelection) => guest.guestId)).size === value.length;
}

export function familyScoreSummary(
  ratings: readonly Pick<RatingWithProfile, "score">[],
  guests: readonly Pick<GuestRating, "score" | "guest">[],
) {
  const scores = [
    ...ratings.flatMap((r) => (r.score === null ? [] : [r.score])),
    ...guests.flatMap((r) => (r.guest && r.guest.account_id === null ? [r.score] : [])),
  ];
  return {
    count: scores.length,
    average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
  };
}

export function localReturnPath(value: unknown, fallback = "/app/browse"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return fallback;
  const parsed = new URL(value, "https://famflix.invalid");
  return parsed.origin === "https://famflix.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
}
