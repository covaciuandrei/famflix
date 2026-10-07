"use client";

import { Film, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authenticate, signInWithGoogle, type AuthState } from "./actions";

const initialState: AuthState = {};

export function LoginForm({ signInError }: { signInError?: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, formAction, pending] = useActionState(
    authenticate,
    initialState,
  );

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/15">
            <Film className="size-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "signin"
              ? "Sign in to your family watchlist."
              : "Start tracking movies with your family."}
          </p>
        </div>

        <form action={signInWithGoogle}>
          <Button variant="outline" className="w-full" type="submit">
            <GoogleIcon />
            Continue with Google
          </Button>
        </form>
        {signInError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {signInError}
          </p>
        )}

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="mode" value={mode} />
          {mode === "signup" && (
            <Input
              name="displayName"
              type="text"
              autoComplete="name"
              placeholder="Your name"
            />
          )}
          <Input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
          <Input
            name="password"
            type="password"
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            placeholder="Password"
            required
          />

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state.message && (
            <p className="text-sm text-like">{state.message}</p>
          )}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="font-medium text-primary hover:underline"
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
        <p className="mt-8 text-center text-xs text-muted-foreground">
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy policy
          </Link>
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-.96 2.6-2.05 3.4v2.8h3.3c1.94-1.8 3.05-4.4 3.05-7.5 0-.7-.06-1.4-.18-2z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.65-2.4l-3.3-2.6c-.9.6-2.06 1-3.35 1-2.58 0-4.76-1.74-5.54-4.08H3.05v2.6C4.7 19.9 8.1 22 12 22z"
      />
      <path
        fill="#FBBC05"
        d="M6.46 13.9c-.2-.6-.32-1.24-.32-1.9s.12-1.3.32-1.9V7.5H3.05C2.38 8.8 2 10.35 2 12s.38 3.2 1.05 4.5l3.41-2.6z"
      />
      <path
        fill="#4285F4"
        d="M12 6.02c1.47 0 2.78.5 3.82 1.5l2.85-2.85C16.97 3.06 14.7 2 12 2 8.1 2 4.7 4.1 3.05 7.5l3.41 2.6C7.24 7.76 9.42 6.02 12 6.02z"
      />
    </svg>
  );
}
