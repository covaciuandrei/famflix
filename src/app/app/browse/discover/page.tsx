import { ArrowLeft, Layers } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { startDiscover } from "@/app/app/browse/discover/actions";
import { MoodPicker } from "@/components/movie-night/mood-picker";
import { getSessionProfile } from "@/lib/data";

/** Discover: pick a mood, then swipe through titles on your own. What you swipe right goes on My list. */
export default async function DiscoverPage() {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/app/browse"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Browse
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Layers className="size-6 text-primary" />
            Discover
          </h1>
          <p className="text-muted-foreground">
            Swipe through titles that fit your mood. Swipe right on what you&apos;d watch and it goes on My list.
          </p>
        </div>
      </div>
      <MoodPicker
        start={startDiscover}
        startLabel="Start swiping"
        hint="Swipe right on what you'd watch. Those go on My list."
      />
    </div>
  );
}
