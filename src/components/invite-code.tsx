"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export function InviteCode({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    // The clipboard API is missing on insecure pages and some older phones.
    if (!navigator.clipboard) {
      window.prompt("Copy this invite code:", code);
      return;
    }
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => window.prompt("Copy this invite code:", code),
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy invite code"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-sm tracking-wider hover:bg-muted/70",
        className,
      )}
    >
      {code}
      {copied ? (
        <Check className="size-3.5 text-like" />
      ) : (
        <Copy className="size-3.5 text-muted-foreground" />
      )}
    </button>
  );
}
