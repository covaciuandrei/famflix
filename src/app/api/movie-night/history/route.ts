import { NextResponse } from "next/server";

import { getNightHistory } from "@/lib/data";
import { HISTORY_PAGE } from "@/lib/movie-night";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Far beyond any family's history; it only keeps a request from asking for an absurd page. */
const MAX_OFFSET = 100_000;

/** The next page of a family's (`group`) finished, cancelled and expired movie nights, for the Load more button. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const params = new URL(request.url).searchParams;
  const group = params.get("group");
  const offset = Number(params.get("offset") ?? "0");
  if (group === null || !UUID.test(group) || !Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    return NextResponse.json({ error: "Bad request" }, { status: 400, headers: NO_STORE });
  }

  // Row level security only lets a family's members see it, so anyone else gets the same answer as for no family.
  const { data: family } = await supabase.from("groups").select("id").eq("id", group).maybeSingle();
  if (!family) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  const history = await getNightHistory(group, offset, HISTORY_PAGE);
  return NextResponse.json(history, { headers: NO_STORE });
}
