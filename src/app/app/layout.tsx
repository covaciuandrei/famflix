import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { getPendingRatings, getSessionProfile } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getSessionProfile();
  if (!user) redirect("/login");

  const pending = await getPendingRatings();
  const name = profile?.display_name || user.email?.split("@")[0] || "You";

  return (
    <div className="flex min-h-screen flex-col">
      <AppNav
        name={name}
        avatarUrl={profile?.avatar_url ?? null}
        currentUserId={user.id}
        pending={pending}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 sm:px-6 sm:pb-12">
        {children}
      </main>
    </div>
  );
}
