"use client";

import { Loader2, Popcorn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { joinAsGuest } from "@/app/guest/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GUEST_NAME_MAX } from "@/lib/movie-night";

/**
 * What a guest sees first: whose night it is and a place to give a name. Joining sets their cookie (the server does,
 * the page never sees the secret), after which the page shows the night. A family member who is signed in is offered
 * the night in the app (`openInApp`), where their votes count as theirs.
 */
export function JoinForm({
  token,
  familyName,
  full,
  openInApp,
}: {
  token: string;
  familyName: string;
  /** The night has all the guests it takes. */
  full: boolean;
  /** Where a signed-in member of this family can open the night in the app. */
  openInApp: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await joinAsGuest(token, name);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 py-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Popcorn className="size-10 text-primary" aria-hidden />
        <h1 className="text-2xl font-bold">{familyName}&apos;s movie night</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re invited to vote on what to watch. Swipe the movies you like and see what everyone thinks. No
          account needed, just a name.
        </p>
      </div>

      {openInApp && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/50 bg-primary/10 px-4 py-3 text-sm">
          <p>You&apos;re in {familyName}. Your votes count as yours in the app.</p>
          <Link href={openInApp} className={buttonVariants({ size: "sm" })}>
            Open the night in the app
          </Link>
        </div>
      )}

      {full ? (
        <p role="alert" className="rounded-xl border border-border bg-card px-4 py-3 text-center text-sm">
          This movie night has all the guests it can take.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Your name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={GUEST_NAME_MAX}
              required
              autoComplete="given-name"
              placeholder="Who should we say you are?"
              className="font-normal"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending || name.trim() === ""}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Join the movie night
          </Button>
        </form>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Your name and votes stay in this movie night and are only shown to {familyName}. You can leave any time from the
        menu, and they go with you.{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy
        </Link>
      </p>
    </div>
  );
}
