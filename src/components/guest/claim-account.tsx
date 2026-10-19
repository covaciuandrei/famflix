"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { claimGuest } from "@/app/app/movie-night/attendance-actions";
import { Button, buttonVariants } from "@/components/ui/button";

export function ClaimGuestAccount({ token, name, family, accountName, initialSummary }: {
  token: string; name: string; family: string; accountName: string | null;
  initialSummary?: { familyId: string; viewings: number; scores: number; alreadyLinked: boolean };
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ familyId: string; viewings: number; scores: number; alreadyLinked: boolean } | null>(initialSummary ?? null);

  function accept() {
    setError(null);
    start(async () => {
      const res = await claimGuest(token);
      if (res.error || !res.summary) setError(res.error ?? "Couldn't link your history.");
      else setSummary(res.summary);
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 py-10">
      <h1 className="text-2xl font-bold">{summary ? "Your history is linked" : `Welcome to ${family}`}</h1>
      {summary ? (
        <>
          <p role="status" className="text-sm">
            {summary.alreadyLinked && "This invitation was accepted by your account. "}
            {summary.viewings} viewing {summary.viewings === 1 ? "record" : "records"} and {summary.scores} family {summary.scores === 1 ? "score" : "scores"} imported. Existing account data was kept.
          </p>
          <Link href={`/app/family/${summary.familyId}`} className={buttonVariants()}>Open the family</Link>
          <Link href="/app/mine" className={buttonVariants({ variant: "outline" })}>Open My list</Link>
        </>
      ) : (
        <>
          <p className="text-sm">You have been invited to connect the saved guest <strong>{name}</strong> to your FamFlix account and join <strong>{family}</strong> as a member.</p>
          <p className="text-sm text-muted-foreground">Your past attendance and missing movie scores will follow you. Existing account ratings, notes, reactions and personal-list status will not be overwritten. This does not edit movie-night votes.</p>
          {accountName ? (
            <>
              <p className="text-sm">Signed in as <strong>{accountName}</strong>. Continue only if this guest history is yours.</p>
              <Button onClick={accept} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}Link my history and join the family</Button>
            </>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(`/guest/account/${token}`)}`} className={buttonVariants()}>Continue with Google</Link>
          )}
          <p className="text-xs text-muted-foreground">If you are still participating in an active guest night, finish that night first and then return here. Signing in alone does not accept this invitation.</p>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Link href="/privacy" className="text-xs text-muted-foreground underline">Privacy</Link>
    </main>
  );
}
