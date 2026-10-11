import { NextResponse } from "next/server";

import { loadGuestState, readGuestSecret } from "@/lib/guest";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * A guest's night for the room to poll (light by default, with `?full=1` the cards too), like the members' state
 * route. The guest's secret comes from the cookie, which the browser only sends to the pages under their own link, and
 * which is why this lives under the link. 410 says the night is over, 404 that this guest isn't in one (never was, or
 * was taken out).
 */
export async function GET(request: Request) {
  const secret = await readGuestSecret();
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

  const full = new URL(request.url).searchParams.get("full") === "1";
  try {
    const res = await loadGuestState(secret, full);
    if (res.ok) return NextResponse.json(res.state, { headers: NO_STORE });
    return res.reason === "over"
      ? NextResponse.json({ error: "Over" }, { status: 410, headers: NO_STORE })
      : NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  } catch (error) {
    console.error("Could not load a guest's movie night:", error);
    return NextResponse.json({ error: "Couldn't load this movie night." }, { status: 500, headers: NO_STORE });
  }
}
