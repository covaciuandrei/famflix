import { NextResponse } from "next/server";

import { LIMITS, overRateLimit } from "@/lib/rate-limit";
import { MAX_SEASON } from "@/lib/series";
import { createClient } from "@/lib/supabase/server";
import { getSeasonEpisodes, TmdbError } from "@/lib/tmdb";

const NO_STORE = { "Cache-Control": "no-store" };
// The same for everyone and short-lived, but never shared between people's browsers or a proxy.
const PRIVATE = { "Cache-Control": "private, max-age=120" };

/**
 * The episodes of one season of a series, for the series page to list when someone opens that season. Only for people
 * who are signed in (TMDB answers cost a request each, so it is also rate limited).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; season: string }> }) {
  const { id, season } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const tmdbId = /^\d{1,9}$/.test(id) ? Number(id) : 0;
  const number = /^\d{1,3}$/.test(season) ? Number(season) : 0;
  if (tmdbId < 1 || number < 1 || number > MAX_SEASON) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const limited = await overRateLimit(user.id, LIMITS.season);
  if (limited) return NextResponse.json({ error: limited }, { status: 429, headers: NO_STORE });

  try {
    return NextResponse.json({ episodes: await getSeasonEpisodes(tmdbId, number) }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof TmdbError && error.status === 404) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    }
    console.error("Could not load a season:", error);
    return NextResponse.json({ error: "Couldn't load this season. Please try again." }, { status: 502, headers: NO_STORE });
  }
}
