"use client";

import { ErrorState } from "@/components/page-states";

// Catches errors the /app error page can't: those thrown by the /app layout itself.
export default function RootError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col">
      <ErrorState onRetry={unstable_retry} />
    </main>
  );
}
