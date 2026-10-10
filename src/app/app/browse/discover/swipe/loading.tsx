import { Loader2 } from "lucide-react";

// Building a stack asks TMDB for dozens of titles, which can take a few seconds the first time.
export default function DiscoverSwipeLoading() {
  return (
    <div
      role="status"
      aria-label="Finding titles for your mood"
      className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground"
    >
      <Loader2 className="size-7 animate-spin" />
      <p className="text-sm">Finding titles for your mood…</p>
    </div>
  );
}
