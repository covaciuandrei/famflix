"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";

import { updateDisplayName, type FormState } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initial: FormState = {};

export function ProfileForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(updateDisplayName, initial);

  return (
    <form action={action} className="flex max-w-sm flex-col gap-2">
      <label htmlFor="display_name" className="text-sm font-medium">
        Display name
      </label>
      <Input
        id="display_name"
        name="display_name"
        defaultValue={displayName}
        maxLength={250}
        required
      />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.message && <p className="text-sm text-like">{state.message}</p>}
      <div className="mt-1">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}
