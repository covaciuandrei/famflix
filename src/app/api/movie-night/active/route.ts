import { NextResponse } from "next/server";

import { parseDuePlans } from "@/lib/movie-night-plans";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The open movie nights in the signed-in user's families, for the invite popup, the menu dot and the banners, and the
 * planned ones that are about to start (or just have) to remind them of.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const [{ data, error }, due] = await Promise.all([
    supabase.rpc("active_movie_nights"),
    supabase.rpc("due_movie_night_plans"),
  ]);
  if (error) {
    console.error("Could not load movie nights:", error.message);
    return NextResponse.json({ error: "Couldn't check for movie nights." }, { status: 500, headers: NO_STORE });
  }
  // The plans are a bonus: if they can't be read (or the database doesn't have them yet) the nights still come.
  // PGRST202 is the database not having the function yet.
  if (due.error && due.error.code !== "PGRST202") {
    console.error("Could not load planned movie nights to remind of:", due.error.message);
  }
  return NextResponse.json(
    { nights: data ?? [], plans: due.error ? [] : parseDuePlans(due.data) },
    { headers: NO_STORE },
  );
}
