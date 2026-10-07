"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";

/** Shared body of the error boundaries: what happened and a way out. */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-20 text-center"
    >
      <TriangleAlert className="size-10 text-destructive" />
      <div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This page couldn&apos;t load. Check your connection and try again.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onRetry}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
        <Link href="/app" className={buttonVariants({ variant: "outline" })}>
          Go home
        </Link>
      </div>
    </div>
  );
}

/** Shared body of the 404 pages. */
export function NotFoundState() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-20 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <div>
        <h1 className="text-xl font-semibold">We couldn&apos;t find that</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The link may be old, or the family may have been deleted. If someone
          shared a family with you, ask them for the invite code.
        </p>
      </div>
      <Link href="/app" className={buttonVariants()}>
        Go to FamFlix
      </Link>
    </div>
  );
}
