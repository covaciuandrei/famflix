import { NextResponse } from "next/server";

import { LIMITS, overRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { searchMedia } from "@/lib/tmdb";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await overRateLimit(user.id, LIMITS.search);
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });

  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const results = await searchMedia(q);
    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search failed:", error);
    return NextResponse.json(
      { error: "Search isn't working right now. Please try again." },
      { status: 502 },
    );
  }
}
