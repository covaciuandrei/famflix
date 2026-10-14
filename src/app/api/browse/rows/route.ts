import { NextResponse } from "next/server";

import { parsePage, rowSourceFromParams, type CardItem } from "@/lib/browse-rows";
import { LIMITS, overRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getRowPage, type TmdbItem } from "@/lib/tmdb";

const toCard = ({ tmdbId, mediaType, title, year, posterPath, voteAverage }: TmdbItem): CardItem => ({
  tmdbId,
  mediaType,
  title,
  year,
  posterPath,
  voteAverage,
});

/**
 * One page of a row of titles (?kind=popular&type=movie&page=2), for the row to add as it is scrolled to its end: the
 * pages after the first, which the page itself shows. What a row may be made of is checked, so this can't be made to
 * ask TMDB for anything else.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const source = rowSourceFromParams(params);
  const page = parsePage(params.get("page"));
  if (!source || !page) {
    return NextResponse.json({ error: "That isn't a row of titles." }, { status: 400 });
  }

  const limited = await overRateLimit(user.id, LIMITS.rowMore);
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });

  try {
    const { items, hasMore } = await getRowPage(source, page);
    // The same for everyone and slow to change, so the browser may keep it for a while (not a shared cache: it is for signed-in people).
    return NextResponse.json(
      { items: items.map(toCard), hasMore },
      { headers: { "Cache-Control": "private, max-age=600" } },
    );
  } catch (error) {
    console.error("Loading a row failed:", error);
    return NextResponse.json({ error: "Couldn't load more titles right now." }, { status: 502 });
  }
}
