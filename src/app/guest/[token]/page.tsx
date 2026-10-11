import type { Metadata } from "next";

import { GuestMessage } from "@/components/guest/guest-message";
import { GuestRoom } from "@/components/guest/guest-room";
import { JoinForm } from "@/components/guest/join-form";
import { getActiveMovieNights, getSessionProfile } from "@/lib/data";
import { loadGuestLink, loadGuestState, readGuestSecret } from "@/lib/guest";

export const metadata: Metadata = {
  title: "Movie night · FamFlix",
  // The link is a secret: the page isn't indexed, and the link doesn't travel in a Referer header (next.config.ts
  // says the same in headers).
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Where a signed-in member of the night's family can open it in the app; null for anyone else. */
async function openInApp(nightId: string | undefined): Promise<string | null> {
  if (!nightId) return null;
  const { user } = await getSessionProfile();
  if (!user) return null;
  const nights = await getActiveMovieNights();
  return nights.some((n) => n.night_id === nightId) ? `/app/movie-night/${nightId}` : null;
}

/**
 * A night's guest link, for someone with no account: the night itself for a guest who has joined, a place to give a
 * name for someone who hasn't, and otherwise only a short message. Nothing else of FamFlix or the family is shown.
 */
export default async function GuestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // A guest who is in goes straight to the night, even if the link was replaced or turned off since: they are in.
  const secret = await readGuestSecret();
  if (secret) {
    const res = await loadGuestState(secret, true);
    if (res.ok) return <GuestRoom token={token} initial={res.state} />;
    if (res.reason === "over") return <GuestMessage kind="over" />;
  }

  const link = await loadGuestLink(token);
  if (!link.open) return <GuestMessage kind={secret ? "out" : "dead"} />;
  return (
    <JoinForm
      token={token}
      familyName={link.family_name ?? "A family"}
      full={Boolean(link.full)}
      openInApp={await openInApp(link.night_id)}
    />
  );
}
