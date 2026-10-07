import { Film, Heart, Star, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");

  const features = [
    {
      icon: Users,
      title: "Shared family list",
      text: "Everyone adds what they want to watch together.",
    },
    {
      icon: Star,
      title: "Rate & note",
      text: "Give each title a score out of 10 and a quick note.",
    },
    {
      icon: Heart,
      title: "Like or dislike",
      text: "React fast and sort by what the family loves most.",
    },
    {
      icon: Film,
      title: "Personal lists too",
      text: "Keep your own private watchlist alongside.",
    },
  ];

  return (
    <main className="flex flex-1 flex-col">
      <section className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 px-6 py-20 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-60 [background:radial-gradient(60%_50%_at_50%_0%,rgba(124,92,255,0.25),transparent)]"
        />
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground">
          <Film className="size-4 text-primary" />
          FamFlix
        </div>
        <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-6xl">
          The watchlist your <span className="text-primary">family</span>{" "}
          shares.
        </h1>
        <p className="max-w-xl text-pretty text-lg text-muted-foreground">
          Keep track of every movie and series you watch together. Add titles,
          mark them watched, rate them and see what everyone loved — all in one
          simple place.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            Get started — it&apos;s free
          </Link>
          <Link
            href="/login"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Sign in
          </Link>
        </div>

        <div className="mt-10 grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card p-5 text-left"
            >
              <f.icon className="size-6 text-primary" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="flex flex-col items-center gap-2 border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        <a
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tmdb-logo.svg"
            alt="The Movie Database (TMDB)"
            width={92}
            height={12}
            className="h-3 w-auto"
          />
        </a>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
        <Link href="/privacy" className="underline hover:text-foreground">
          Privacy policy
        </Link>
      </footer>
    </main>
  );
}
