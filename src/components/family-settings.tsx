"use client";

import { Loader2, LogOut, RefreshCw, UserMinus } from "lucide-react";
import { useState, useTransition } from "react";

import {
  leaveGroup,
  regenerateInviteCode,
  removeMember,
  renameGroup,
  type ActionResult,
} from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Runs a server action in a transition and keeps its error message. */
function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<ActionResult>, onDone?: () => void) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res?.error) setError(res.error);
      else onDone?.();
    });
  };
  return { pending, error, run };
}

export function RenameForm({ groupId, name }: { groupId: string; name: string }) {
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useAction();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(() => renameGroup(groupId, value), () => setSaved(true));
      }}
    >
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={60}
          required
          aria-label="Family name"
        />
        <Button type="submit" disabled={pending || !value.trim()}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-like">Saved.</p>}
    </form>
  );
}

export function NewCodeButton({ groupId }: { groupId: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (confirm("Make a new invite code? The old code will stop working.")) {
            run(() => regenerateInviteCode(groupId));
          }
        }}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        New code
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function RemoveMemberButton({
  groupId,
  userId,
  name,
}: {
  groupId: string;
  userId: string;
  name: string;
}) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (
            confirm(
              `Remove ${name} from this family? Their scores and notes stay on the list.`,
            )
          ) {
            run(() => removeMember(groupId, userId));
          }
        }}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <UserMinus className="size-4" />
        )}
        Remove
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function LeaveFamilyButton({
  groupId,
  warning,
}: {
  groupId: string;
  warning: string;
}) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{warning}</p>
      <div>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() => {
            if (confirm(`Leave this family? ${warning}`)) {
              run(() => leaveGroup(groupId));
            }
          }}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <LogOut className="size-4" />
          )}
          Leave family
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
