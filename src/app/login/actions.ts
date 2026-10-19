"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { AUTH_RETURN_COOKIE, AUTH_RETURN_PATH, localReturnPath } from "@/lib/attendance";

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/** The only way in: Google sign-in, which also creates the account on the first visit. */
export async function signInWithGoogle(next = "/app/browse") {
  const supabase = await createClient();
  (await cookies()).set(AUTH_RETURN_COOKIE, localReturnPath(next), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: AUTH_RETURN_PATH, maxAge: 600,
  });
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteOrigin()}/auth/callback` },
  });
  if (error) redirect(`/login?next=${encodeURIComponent(localReturnPath(next))}&error=${encodeURIComponent(error.message)}`);
  if (data.url) redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
