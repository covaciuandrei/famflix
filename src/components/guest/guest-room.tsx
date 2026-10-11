"use client";

import { useMemo, useState } from "react";

import { guestCastVotes, guestFinishStack } from "@/app/guest/actions";
import { GuestMessage } from "@/components/guest/guest-message";
import { Room } from "@/components/movie-night/room";
import type { NightTransport } from "@/components/movie-night/transport";
import { guestPath, type NightState } from "@/lib/movie-night";

/**
 * A night for someone who came in through its link: the same room as a family member's, which talks to the server
 * through the guest's own pages and actions (the browser holds a secret cookie that the page never sees).
 */
export function GuestRoom({ token, initial }: { token: string; initial: NightState }) {
  const transport = useMemo<NightTransport>(
    () => ({
      // The cookie only goes to this link's own pages, which is why the state lives under it.
      stateUrl: (full) => `${guestPath(token)}/state${full ? "?full=1" : ""}`,
      castVotes: guestCastVotes,
      finishStack: guestFinishStack,
    }),
    [token],
  );
  const [left, setLeft] = useState(false);

  if (left) return <GuestMessage kind="left" />;
  return (
    <Room
      initial={initial}
      transport={transport}
      onLeave={async () => {
        // Not a server action: one that changes cookies makes the page render again, and the message would be lost.
        try {
          const res = await fetch(`${guestPath(token)}/leave`, { method: "POST" });
          if (!res.ok) return { error: "Couldn't leave just now. Please try again." };
        } catch {
          return { error: "You seem to be offline. Try again once you're back." };
        }
        setLeft(true);
        return {};
      }}
    />
  );
}
