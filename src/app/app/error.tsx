"use client";

import { ErrorState } from "@/components/page-states";

export default function AppError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorState onRetry={unstable_retry} />;
}
