import { NextResponse, type NextRequest } from "next/server";

import { exportFileName, toCsv, viewingsOf, type ExportDocument } from "@/lib/export-csv";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

function problem(error: string, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...extra } });
}

/**
 * "Download my data": everything FamFlix keeps about the signed-in person, as a file. `?format=json` (the default) is the
 * whole document from export_my_data(), with the e-mail address of their sign-in added; `?format=csv` is their watch
 * history, one row for every time they watched something. Nothing is kept on the server.
 *
 * It is only for the person themselves, from FamFlix: a request the browser says comes from another site (or even another
 * subdomain) is refused, so that no page, image or script elsewhere can have someone's data downloaded.
 */
export async function GET(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return problem("Forbidden", 403);

  const format = request.nextUrl.searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") return problem("The format is json or csv.", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return problem("Unauthorized", 401);

  const { data, error } = await supabase.rpc("export_my_data");
  if (error) {
    if (/too often/i.test(error.message)) {
      return problem("You've downloaded your data a few times already. Please try again in an hour.", 429, {
        "Retry-After": "3600",
      });
    }
    // PGRST202: the database doesn't have the function yet (the app was updated before it).
    if (error.code === "PGRST202") {
      return problem("Downloading your data isn't available yet. Please try again in a little while.", 503);
    }
    console.error("Could not export an account:", error.message);
    return problem("Couldn't prepare your data. Please try again.", 500);
  }

  const document = data as ExportDocument & { account?: Record<string, unknown> | null };
  const filename = exportFileName(format, new Date());
  const headers = {
    ...NO_STORE,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "X-Content-Type-Options": "nosniff",
  };

  if (format === "csv") {
    // The byte order mark makes spreadsheets read accents and other scripts correctly.
    const body = `\uFEFF${toCsv(viewingsOf(document))}`;
    return new Response(body, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  }

  // The e-mail address is the sign-in's, not a column of any table, so it is added here.
  const account = { ...(document.account ?? {}), email: user.email ?? null };
  return new Response(JSON.stringify({ ...document, account }, null, 2), {
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
