"use client";

import { Popcorn } from "lucide-react";
import Link from "next/link";

import { useNightStatus } from "@/components/movie-night/night-status";
import { buttonVariants } from "@/components/ui/button";

/** The family page's way into Movie night: join the one that is going, or start one. */
export function FamilyNightLink({ groupId }: { groupId: string }) {
  const night = useNightStatus().find((n) => n.group_id === groupId);
  return (
    <Link
      href={night ? `/app/movie-night/${night.night_id}` : `/app/movie-night?who=${groupId}`}
      className={buttonVariants({ size: "sm", variant: night && !night.joined ? "default" : "outline" })}
    >
      <Popcorn className="size-4" />
      {!night ? "Movie night" : night.joined ? "Movie night in progress" : "Join movie night"}
    </Link>
  );
}
