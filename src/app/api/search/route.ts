import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { searchMedia } from "@/lib/tmdb";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const results = await searchMedia(q);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
