import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

/** The open movie nights in the signed-in user's families, for the invite popup, the menu dot and the banners. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const { data, error } = await supabase.rpc("active_movie_nights");
  if (error) {
    console.error("Could not load movie nights:", error.message);
    return NextResponse.json({ error: "Couldn't check for movie nights." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ nights: data ?? [] }, { headers: NO_STORE });
}
