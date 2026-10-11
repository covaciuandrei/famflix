"use client";

import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ExportFormat } from "@/lib/export-csv";

/**
 * Settings → Account → Download my data: everything FamFlix keeps about the person as one JSON file, or their watch history
 * as a CSV for a spreadsheet. The file is asked for from FamFlix's own page, so that a problem (too many downloads, the
 * database not ready) is told here rather than saved as a file.
 */
export function DownloadData() {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: ExportFormat) {
    setBusy(format);
    setError(null);
    try {
      const res = await fetch(`/api/account/export?format=${format}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Couldn't download your data. Please try again.");
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `famflix-data.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("Couldn't download your data. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div id="download-data" className="flex flex-col gap-2">
      <p className="text-sm font-medium">Download my data</p>
      <p className="text-sm text-muted-foreground">
        Everything FamFlix keeps about you: your account, families, My list with the episodes you ticked, your watch history,
        your scores, notes and reactions on family lists, your movie nights and votes. Other people&apos;s scores, notes and
        e-mail addresses are not in it, nor are guests or invite codes.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => download("json")} disabled={busy !== null}>
          {busy === "json" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" aria-hidden />}
          Everything (JSON)
        </Button>
        <Button variant="outline" onClick={() => download("csv")} disabled={busy !== null}>
          {busy === "csv" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="size-4" aria-hidden />
          )}
          Watch history (CSV)
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
