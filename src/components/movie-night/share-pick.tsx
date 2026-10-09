"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Shares what was picked: the phone's share sheet where there is one, otherwise the text is copied. */
export function SharePick({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const text = `We picked ${title} for our movie night on FamFlix 🍿`;
    const url = window.location.origin;
    if (navigator.share) {
      try {
        await navigator.share({ text, url });
      } catch {
        // Closing the share sheet isn't a problem.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // No clipboard (an old browser or a blocked page): nothing to do.
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={share}>
      {copied ? <Check className="size-3.5 text-like" /> : <Share2 className="size-3.5" />}
      {copied ? "Copied" : "Share"}
    </Button>
  );
}
