import "server-only";

import { LIMITS, overRateLimit } from "@/lib/rate-limit";
import { saveMedia } from "@/lib/save-media";
import { detailsToMediaRow, getMediaDetails } from "@/lib/tmdb";
import type { MediaType } from "@/lib/types";

/** Checks a title id sent by the browser, fetches the title from TMDB and saves its movie info; returns its media id. */
export async function saveTitle(
  userId: string,
  input: { tmdbId: number; mediaType: MediaType },
): Promise<{ id: string } | { error: string }> {
  // Server actions get whatever the browser sends, and these two pick what is asked from TMDB and saved.
  if (
    !Number.isSafeInteger(input.tmdbId) ||
    input.tmdbId <= 0 ||
    (input.mediaType !== "movie" && input.mediaType !== "tv")
  ) {
    return { error: "That isn't a valid title." };
  }
  const limited = await overRateLimit(userId, LIMITS.addTitle);
  if (limited) return { error: limited };

  let details;
  try {
    details = await getMediaDetails(input.mediaType, input.tmdbId);
  } catch {
    return { error: "Couldn't reach the movie database. Please try again." };
  }
  // The movie info is shared by everyone, so the server saves it, not the signed-in user.
  return saveMedia(detailsToMediaRow(details));
}
