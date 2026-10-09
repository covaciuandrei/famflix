"use client";

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

/**
 * The solo stack picks up where someone left off from sessionStorage, which the server can't see. So it is only
 * rendered in the browser (a spinner stands in until then), which also avoids a server/browser mismatch.
 */
export const SoloDeck = dynamic(
  () => import("@/components/movie-night/solo-deck").then((m) => m.SoloDeck),
  {
    ssr: false,
    loading: () => (
      <div role="status" aria-label="Loading" className="flex h-80 items-center justify-center text-muted-foreground">
        <Loader2 className="size-7 animate-spin" />
      </div>
    ),
  },
);
