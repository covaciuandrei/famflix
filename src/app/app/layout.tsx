import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { NightInvite } from "@/components/movie-night/invite";
import { NightStatusProvider } from "@/components/movie-night/night-status";
import { WatchedPromptProvider } from "@/components/watched-prompt";
import { WelcomeTour } from "@/components/welcome-tour";
import { getActiveMovieNights, getMyGroups, getPendingRatings, getSessionProfile } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getSessionProfile();
  if (!user) redirect("/login");

  const [pending, groups, nights] = await Promise.all([
    getPendingRatings(),
    getMyGroups(),
    getActiveMovieNights(),
  ]);
  const name = profile?.display_name || user.email?.split("@")[0] || "You";

  return (
    <NightStatusProvider initial={nights} poll={groups.some((g) => g.memberCount > 1)}>
      <div className="flex min-h-screen flex-col">
        <AppNav
          name={name}
          avatarUrl={profile?.avatar_url ?? null}
          currentUserId={user.id}
          pending={pending}
        />
        <WelcomeTour name={name} hasFamily={groups.length > 0} />
        <NightInvite />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 sm:px-6 sm:pb-12">
          <WatchedPromptProvider>{children}</WatchedPromptProvider>
        </main>
      </div>
    </NightStatusProvider>
  );
}
