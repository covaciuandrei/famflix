import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** Exchanges an OAuth / email-confirmation code for a session. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? "/app";
  // Paths only: appended to the origin, "@evil.com" would turn the address into evil.com.
  if (!next.startsWith("/") || next.startsWith("//")) next = "/app";

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
    `${base}/login?error=${encodeURIComponent(reason)}`,
  );
}
