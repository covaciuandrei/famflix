import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One night as the signed-in user may see it, for the room to poll. Light by default (numbers and names, no cards);
 * `?full=1` also sends the cards, which only changes when a stack is added.
 */
export async function GET(request: Request, { params }: { params: Promise<{ nightId: string }> }) {
  const { nightId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!UUID.test(nightId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const full = new URL(request.url).searchParams.get("full") === "1";
  const { data, error } = await supabase.rpc("movie_night_state", { p_night: nightId, p_full: full });
  if (error) {
    // Not theirs, or gone: the same answer, so nobody can tell which nights exist.
    if (/not available/i.test(error.message)) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    }
    console.error("Could not load a movie night:", error.message);
    return NextResponse.json({ error: "Couldn't load this movie night." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json(data, { headers: NO_STORE });
}
