import { NextResponse } from "next/server";

import { GUEST_COOKIE, guestCookieOptions, guestDb, readGuestSecret } from "@/lib/guest";
import { GUEST_SECRET } from "@/lib/movie-night";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * A guest leaves: their name and votes go from the night and so does their cookie. (A route rather than a server
 * action, because an action that changes cookies makes the page render again, and the room has a goodbye to show.)
 * The cookie only comes with a request from this site's own pages (SameSite=Lax), so nobody else can send a guest away.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const secret = await readGuestSecret();
  if (secret) {
    const { error } = await guestDb().rpc("guest_leave", { p_secret: secret });
    if (error) {
      console.error("A guest couldn't leave:", error.message);
      return NextResponse.json({ error: "Couldn't leave just now." }, { status: 500, headers: NO_STORE });
    }
  }
  const response = NextResponse.json({}, { headers: NO_STORE });
  if (GUEST_SECRET.test(token)) response.cookies.set(GUEST_COOKIE, "", guestCookieOptions(token, 0));
  return response;
}
