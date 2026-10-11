"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * The text of a year to send to someone, shown as it will be sent, and a Share button: the phone's share sheet where there
 * is one, otherwise the text is copied. Nobody's name is in it.
 */
export function ShareStats({ text }: { text: string }) {
  const [note, setNote] = useState("");

  async function share() {
    setNote("");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        // Closing the share sheet isn't a problem.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setNote("Copied. Paste it wherever you like.");
    } catch {
      // The clipboard is missing on insecure pages and some older phones.
      window.prompt("Copy this to share:", text);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">Share it. This is all that gets sent:</p>
      <blockquote className="border-l-2 border-primary pl-3 text-sm">{text}</blockquote>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={share}>
          <Share2 className="size-4" aria-hidden />
          Share
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      </div>
    </div>
  );
}
