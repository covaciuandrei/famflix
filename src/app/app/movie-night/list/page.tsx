import { Popcorn } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MovieNight } from "@/components/movie-night";
import { buttonVariants } from "@/components/ui/button";
import { getListCards, getMyGroups, getSessionProfile } from "@/lib/data";
import { isToWatch } from "@/lib/list-status";
import { cn } from "@/lib/utils";

/** The whole To watch list in random order, for choosing without swiping. */
export default async function MovieNightListPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string | string[] }>;
}) {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const { list } = await searchParams;
  const groups = await getMyGroups();
  const lists = [
    ...groups.map((g) => ({ id: g.id, label: g.name })),
    { id: "mine", label: "My list" },
  ];
  const current = lists.find((l) => l.id === list) ?? lists[0];

  const cards = (
    await getListCards({
      groupId: current.id === "mine" ? null : current.id,
      userId: user.id,
    })
  ).filter(isToWatch);
  // Picked here and passed down so the server and the browser shuffle identically.
  // eslint-disable-next-line react-hooks/purity -- server component, renders once per request (it reads cookies); a new order per visit is intended
  const seed = Math.floor(Math.random() * 2 ** 31);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Popcorn className="size-6 text-primary" />
            Your To watch list
          </h1>
          <p className="text-muted-foreground">
            Look through it in random order or by category, or let the app pick
            for you.
          </p>
        </div>
        <Link href="/app/movie-night" className={buttonVariants({ variant: "outline" })}>
          Swipe more
        </Link>
      </div>

      {lists.length > 1 && (
        <nav className="flex flex-wrap gap-1.5" aria-label="Choose a list">
          {lists.map((l) => (
            <Link
              key={l.id}
              href={`/app/movie-night/list?list=${l.id}`}
              className={cn(
                "rounded-md border border-border px-3 py-1.5 text-sm transition-colors",
                l.id === current.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}

      <MovieNight key={current.id} cards={cards} seed={seed} />
    </div>
  );
}
