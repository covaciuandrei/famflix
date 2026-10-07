"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";

import {
  createGroupAction,
  joinGroupAction,
  type FormState,
} from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const initial: FormState = {};

export function GroupForms() {
  const [createState, createAction, creating] = useActionState(
    createGroupAction,
    initial,
  );
  const [joinState, joinAction, joining] = useActionState(
    joinGroupAction,
    initial,
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Start a family</CardTitle>
          <CardDescription>
            Create a shared watchlist and invite others with a code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="flex flex-col gap-3">
            <Input name="name" placeholder="Family name" required />
            {createState.error && (
              <p className="text-sm text-destructive">{createState.error}</p>
            )}
            <Button type="submit" disabled={creating}>
              {creating && <Loader2 className="size-4 animate-spin" />}
              Create family
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Join a family</CardTitle>
          <CardDescription>
            Enter the invite code someone shared with you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={joinAction} className="flex flex-col gap-3">
            <Input
              name="code"
              placeholder="Invite code"
              required
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              className="uppercase"
            />
            {joinState.error && (
              <p className="text-sm text-destructive">{joinState.error}</p>
            )}
            <Button type="submit" variant="outline" disabled={joining}>
              {joining && <Loader2 className="size-4 animate-spin" />}
              Join family
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
