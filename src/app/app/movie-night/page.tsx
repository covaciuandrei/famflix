import { Popcorn } from "lucide-react";
import { redirect } from "next/navigation";

import { Hub } from "@/components/movie-night/hub";
import { getSessionProfile } from "@/lib/data";

export default async function MovieNightPage() {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Popcorn className="size-6 text-primary" />
          Movie night
        </h1>
        <p className="text-muted-foreground">
          Can&apos;t decide what to watch? Swipe through titles that fit your mood.
        </p>
      </div>
      <Hub />
    </div>
  );
}
