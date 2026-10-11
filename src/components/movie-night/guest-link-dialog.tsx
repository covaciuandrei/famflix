"use client";

import { Check, Copy, Link2Off, Loader2, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  getGuestLink,
  newGuestLink,
  turnOffGuestLink,
  type ActionResult,
} from "@/app/app/movie-night/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import { guestPath } from "@/lib/movie-night";

type LinkState =
  | { state: "loading" }
  | { state: "on"; token: string }
  | { state: "off" }
  // The link couldn't be made (the night is over, or too many links were asked for).
  | { state: "failed" };

/**
 * "Invite a guest": the night's guest link, to copy or share, with a button to replace it (the old one stops working)
 * and one to turn it off. It opens as soon as it is shown and makes the link if the night has none, so show it only
 * while it is wanted (and drop it from `onClose`). Guests who already joined stay in whatever happens to the link.
 */
export function GuestLinkDialog({
  nightId,
  groupName,
  onClose,
}: {
  nightId: string;
  groupName: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState<LinkState>({ state: "loading" });
  const [busy, setBusy] = useState<"new" | "off" | "make" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The dialog only ever renders in the browser (it is shown after a tap), so this is safe to read while rendering.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    openModal(dialogRef.current);
    let stopped = false;
    void getGuestLink(nightId).then((res) => {
      if (stopped) return;
      if (res.token) {
        setLink({ state: "on", token: res.token });
      } else {
        setError(res.error ?? "The link couldn't be made. Try again.");
        setLink({ state: "failed" });
      }
    });
    return () => {
      stopped = true;
    };
  }, [nightId]);

  const url = link.state === "on" ? `${window.location.origin}${guestPath(link.token)}` : "";

  /** Runs one change to the link; the buttons wait while it goes. */
  async function change(
    key: "new" | "off" | "make",
    run: () => Promise<ActionResult & { token?: string }>,
  ) {
    if (busy) return;
    setBusy(key);
    setError(null);
    setCopied(false);
    try {
      const res = await run();
      if (res.error) setError(res.error);
      else setLink(res.token ? { state: "on", token: res.token } : { state: "off" });
    } finally {
      setBusy(null);
    }
  }

  function replace() {
    if (!window.confirm("Make a new link? The old one stops working. Guests who are already in stay in.")) return;
    void change("new", () => newGuestLink(nightId));
  }

  function turnOff() {
    if (!window.confirm("Turn the link off? Nobody new can join with it. Guests who are already in stay in.")) return;
    void change("off", () => turnOffGuestLink(nightId));
  }

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("No clipboard");
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // The clipboard API is missing on insecure pages and some older phones.
      window.prompt("Copy this link:", url);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: `${groupName}'s movie night`, text: `Join our movie night on FamFlix 🍿`, url });
    } catch {
      // Closing the share sheet isn't a problem.
    }
  }

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      {...closeOnBackdrop}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto max-h-[85vh] w-[min(28rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl outline-none backdrop:bg-black/60"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        Invite a guest
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Anyone with this link can join {groupName}&apos;s movie night with just a name, no account needed, and swipe
        the same cards. They only see the cards and the leaderboard, nothing else. The link stops working when the
        night is over.
      </p>

      {link.state === "loading" && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Making the link…
        </p>
      )}

      {link.state === "on" && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              readOnly
              value={url}
              aria-label="Guest link"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 font-mono text-xs sm:text-xs"
            />
            <Button onClick={copy} disabled={busy !== null}>
              {copied ? <Check className="size-4 text-like" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {canShare && (
              <Button size="sm" variant="outline" onClick={share} disabled={busy !== null}>
                <Share2 className="size-3.5" />
                Share
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={replace} disabled={busy !== null}>
              {busy === "new" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              New link
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={turnOff}
              disabled={busy !== null}
              className="text-destructive"
            >
              {busy === "off" ? <Loader2 className="size-3.5 animate-spin" /> : <Link2Off className="size-3.5" />}
              Turn off link
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Guests show in the list of people on the night&apos;s page, marked Guest, and anyone in the family can take
            one out.
          </p>
        </div>
      )}

      {link.state === "off" && (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p className="text-sm">The link is turned off. Nobody new can join with it.</p>
          <Button size="sm" onClick={() => void change("make", () => getGuestLink(nightId))} disabled={busy !== null}>
            {busy === "make" && <Loader2 className="size-3.5 animate-spin" />}
            Make a link
          </Button>
        </div>
      )}

      {link.state === "failed" && (
        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={() => void change("make", () => getGuestLink(nightId))} disabled={busy !== null}>
            {busy === "make" && <Loader2 className="size-3.5 animate-spin" />}
            Try again
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
          Done
        </Button>
      </div>
    </dialog>
  );
}
