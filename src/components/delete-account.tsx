"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import { deleteAccount } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Settings → Delete account: asks the person to type DELETE before anything happens. */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const confirmed = confirmation.trim().toUpperCase() === "DELETE";

  if (!open) {
    return (
      <Button
        variant="ghost"
        className="w-fit px-0 text-destructive hover:bg-transparent hover:underline"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
        Delete account
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4">
      <p className="text-sm font-medium">Delete your account?</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Your personal list and your scores, notes and reactions are deleted.
        </li>
        <li>
          Families you share keep their titles. If you own one, the member
          who joined first becomes the owner. Families with nobody else in
          them are deleted.
        </li>
        <li>Your name is removed from your families&apos; activity.</li>
        <li>This can&apos;t be undone.</li>
      </ul>
      <label className="flex flex-col gap-1.5 text-sm">
        Type DELETE to confirm
        <Input
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="max-w-48"
        />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          disabled={!confirmed || pending}
          onClick={() => {
            setError(null);
            start(async () => {
              // Redirects home when it works.
              const res = await deleteAccount(confirmation);
              if (res?.error) setError(res.error);
            });
          }}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Delete my account
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setConfirmation("");
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
