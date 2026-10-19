import type { Metadata } from "next";
import Link from "next/link";

import { ClaimGuestAccount } from "@/components/guest/claim-account";
import { getSessionProfile } from "@/lib/data";
import { guestDb } from "@/lib/guest";
import { GUEST_SECRET } from "@/lib/movie-night";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Connect your history · FamFlix", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function GuestAccountPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!GUEST_SECRET.test(token)) return <Unavailable />;
  const { user, profile } = await getSessionProfile();
  if (user) {
    const supabase = await createClient();
    const { data: receipt, error: receiptError } = await supabase.rpc("guest_claim_result", { p_token: token });
    if (receiptError) throw new Error(`Could not read your import receipt: ${receiptError.message}`);
    if (receipt) {
      const summary = receipt as { familyId: string; familyName: string; viewings: number; scores: number; alreadyLinked: boolean };
      return <ClaimGuestAccount token={token} name={profile?.display_name ?? "You"} family={summary.familyName}
        accountName={profile?.display_name ?? "your account"} initialSummary={summary} />;
    }
  }
  const { data, error } = await guestDb().rpc("guest_account_invitation", { p_token: token });
  if (error) throw new Error(`Could not read account invitation: ${error.message}`);
  const invitation = data as { valid: boolean; name?: string; family?: string };
  if (!invitation.valid || !invitation.name || !invitation.family) return <Unavailable />;
  return <ClaimGuestAccount token={token} name={invitation.name} family={invitation.family} accountName={user ? profile?.display_name ?? "your account" : null} />;
}

function Unavailable() {
  return <main className="mx-auto flex max-w-md flex-col gap-3 px-5 py-10">
    <h1 className="text-xl font-bold">This account invitation is not available</h1>
    <p className="text-sm text-muted-foreground">It may have expired, been revoked or already been accepted. Ask the family for a new invitation.</p>
    <Link href="/app" className="text-sm underline">Open FamFlix</Link>
  </main>;
}
