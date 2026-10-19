import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { APP_HOME } from "@/lib/constants";
import { AUTH_RETURN_COOKIE, AUTH_RETURN_PATH, localReturnPath } from "@/lib/attendance";
import { createClient } from "@/lib/supabase/server";

/** Exchanges an OAuth / email-confirmation code for a session. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const jar = await cookies();
  const next = localReturnPath(jar.get(AUTH_RETURN_COOKIE)?.value ?? searchParams.get("next"), APP_HOME);
  jar.set(AUTH_RETURN_COOKIE, "", { path: AUTH_RETURN_PATH, maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });

  let failure = searchParams.get("error_description");

  // Behind Azure the request URL is the internal server (https://localhost:8080), so redirects
  // (on success and on failure alike) go to the host the visitor actually used.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base =
    forwardedHost && process.env.NODE_ENV !== "development"
      ? `https://${forwardedHost}`
      : origin;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${base}${next}`);
    failure = error.message;
  }

  const reason = failure ?? "Could not sign in. Please try again.";
  return NextResponse.redirect(
    `${base}/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(reason)}`,
  );
}
