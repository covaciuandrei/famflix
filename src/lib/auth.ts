import "server-only";

import { createClient } from "@/lib/supabase/server";

/** The signed-in user and a Supabase client acting as them; throws when nobody is signed in (server actions). */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return { supabase, user };
}
