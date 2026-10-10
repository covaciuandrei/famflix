import { Layers, Users } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

/** What Movie night shows to someone who isn't in a family yet: a movie night is a family's, so the way in is a family. */
export function NoFamily() {
  return (
    <section
      aria-labelledby="no-family-title"
      className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-6 py-12 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
        <Users className="size-7" aria-hidden />
      </span>
      <div className="max-w-md">
        <h2 id="no-family-title" className="text-lg font-semibold">
          Movie night is for families
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone in a family swipes through the same titles, and the votes decide what you watch together. Create a
          family, or join one with an invite code, to start one.
        </p>
      </div>
      <Link href="/app/groups" className={buttonVariants()}>
        Create or join a family
      </Link>
      <p className="flex flex-wrap items-center justify-center gap-x-1 text-sm text-muted-foreground">
        <Layers className="size-4 shrink-0" aria-hidden />
        Want to swipe on your own?
        <Link href="/app/browse/discover" className="underline underline-offset-2 hover:text-foreground">
          Try Discover
        </Link>
        on Browse.
      </p>
    </section>
  );
}
