import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Heart,
  ListPlus,
  MonitorPlay,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppIntro } from "@/components/app-intro";
import { LandingMotion } from "@/components/landing-motion";
import { LandingPreview } from "@/components/landing-preview";
import { buttonVariants } from "@/components/ui/button";
import { APP_HOME } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(APP_HOME);
  const { deleted } = await searchParams;

  const steps = [
    {
      icon: ListPlus,
      title: "Save the good suggestions.",
      text: "Find movies and series. Add them to your own watchlist or a shared family list.",
    },
    {
      icon: Users,
      title: "Find something you all love.",
      text: "Get everyone's picks in one place. For movie night, swipe and vote together.",
    },
    {
      icon: Check,
      title: "Keep more than a watchlist.",
      text: "Mark it watched, log who joined you, and remember it with your own score and notes.",
    },
  ];

  return (
    <LandingMotion>
      <a href="#main-content" className="sr-only z-50 rounded-md bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4">
        Skip to content
      </a>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-5 px-5 py-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-md text-xl font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="FamFlix home">
          <Image src="/icon.svg" alt="" width={36} height={36} />
          FamFlix
        </Link>
        <nav aria-label="Landing page" className="flex items-center gap-6 text-sm">
          <a href="#how-it-works" className="hidden rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block">How it works</a>
          <a href="#features" className="hidden rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block">Features</a>
          <Link href="/login" className={buttonVariants({ variant: "outline", size: "sm", className: "h-11" })}>
            Sign in <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col overflow-x-clip outline-none">
        {deleted === "1" && (
          <p role="status" className="mx-auto mt-3 w-[calc(100%_-_2.5rem)] max-w-5xl rounded-xl border border-border bg-card px-4 py-3 text-sm">
            Your account and your data have been deleted. Thanks for using
            FamFlix.
          </p>
        )}

        <section aria-labelledby="hero-heading" className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pt-10 pb-16 sm:px-8 sm:pt-14 sm:pb-24 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:pt-16">
          <div data-reveal="0">
            <p data-hero-part="eyebrow" className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
              <Sparkles className="size-3.5" aria-hidden />
              Your list. Your people. Your next great watch.
            </p>
            <h1 id="hero-heading" className="text-[clamp(2.4rem,11vw,3.5rem)] leading-[1.02] font-bold tracking-[-0.055em] sm:text-6xl lg:text-[clamp(3rem,5.2vw,4rem)]">
              <span data-hero-line className="block">Less choosing.</span>
              <span data-hero-line className="block text-primary">More watching.</span>
            </h1>
            <p data-hero-part="copy" className="mt-7 max-w-md text-pretty text-lg leading-relaxed text-muted-foreground">
              Your own watchlist. A shared one for your family and friends.
              And a better answer to &ldquo;what should we watch tonight?&rdquo;
            </p>
            <div data-hero-part="actions" className="landing-actions mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login" className={buttonVariants({ size: "lg", className: "landing-cta" })}>
                Get started — it&apos;s free
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <AppIntro />
            </div>
            <p data-hero-part="trust" className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-primary" aria-hidden /> Movies &amp; series</span>
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-primary" aria-hidden /> Solo or together</span>
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-primary" aria-hidden /> Made for phones</span>
            </p>
          </div>
          <LandingPreview />
        </section>

        <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-8 border-y border-border bg-card/40">
          <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
            <div data-reveal="0" className="mb-9 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="landing-kicker text-xs font-semibold tracking-[0.18em] text-primary uppercase">From &ldquo;we should watch this&rdquo; to movie night</p>
                <h2 id="how-heading" className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">A good night starts with a good list.</h2>
              </div>
              <a href="#features" className="flex items-center gap-2 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">See what&apos;s inside <ArrowDown className="size-3.5" aria-hidden /></a>
            </div>
            <ol className="grid gap-8 md:grid-cols-3 md:gap-10">
              {steps.map(({ icon: Icon, title, text }, index) => (
                <li key={title} data-reveal={index} className="relative">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
                    <span className="text-[11px] font-medium tracking-widest text-muted-foreground">0{index + 1}</span>
                    <span className="h-px flex-1 bg-border" aria-hidden />
                  </div>
                  <h3 className="text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" aria-labelledby="features-heading" className="mx-auto w-full max-w-6xl scroll-mt-8 px-5 py-16 sm:px-8 sm:py-24">
          <div data-reveal="0" className="mb-9 max-w-2xl">
            <p className="landing-kicker text-xs font-semibold tracking-[0.18em] text-primary uppercase">A little more than &ldquo;watch it later&rdquo;</p>
            <h2 id="features-heading" className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">For the next pick.<br />And all the good ones after it.</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">From a quiet episode on your own to a full sofa on Friday. FamFlix keeps the choosing, watching and remembering together.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-6">
            <article data-reveal="0" className="landing-feature-card flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8 md:col-span-3">
              <span className="landing-feature-icon mb-5 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><ListPlus className="size-5" aria-hidden /></span>
              <h3 className="text-xl font-semibold tracking-tight">Your watchlist, your way.</h3>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">The film a friend recommended. The series you keep meaning to start. Save them to My list, mark them watched, and add your own scores and notes.</p>
              <div className="landing-watch-flow mt-7 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/50 px-4 py-5 text-xs" aria-label="From To watch to Watched, with your own rating">
                <span className="landing-flow-step rounded-lg border border-border bg-card px-3 py-2 text-muted-foreground">To watch</span>
                <ArrowRight className="landing-flow-arrow size-4 text-muted-foreground" aria-hidden />
                <span className="landing-flow-step flex items-center gap-1.5 rounded-lg bg-like/10 px-3 py-2 text-like"><Check className="landing-watched-check size-3.5" aria-hidden /> Watched</span>
                <span className="landing-flow-step ml-auto flex items-center gap-1 text-star"><Star className="size-3.5 fill-current" aria-hidden /> Your score</span>
              </div>
              <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Your notes stay yours. Choose whether your family can see your personal list.</p>
            </article>

            <article data-reveal="1" className="landing-feature-card relative flex flex-col overflow-hidden rounded-3xl border border-primary/25 bg-primary/5 p-6 sm:p-8 md:col-span-3">
              <span className="landing-feature-icon mb-5 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Clapperboard className="size-5" aria-hidden /></span>
              <h3 className="text-xl font-semibold tracking-tight">Less back-and-forth. More movie night.</h3>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">One shared list for your family or friends. When nobody can decide, everyone swipes and votes to find a favourite. Guests can vote from a link, no account needed.</p>
              <div className="mt-7 rounded-2xl border border-primary/20 bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="landing-kicker text-[10px] font-semibold tracking-widest text-primary uppercase">Example movie-night result</span>
                    <p className="mt-1.5 text-sm font-semibold">Orbit Club</p>
                  </div>
                  <span className="landing-feature-score flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"><Heart className="size-3.5" aria-hidden /> 5 pts</span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="landing-progress-fill h-full w-4/5 origin-left rounded-full bg-primary" /></div>
                <p className="mt-3 text-xs text-muted-foreground">2 Love + 1 Yes. A pick everyone helped make.</p>
              </div>
            </article>
          </div>

          <details id="more-features" data-reveal="0" className="landing-feature-details group mt-6">
            <summary aria-controls="extra-features" className="mx-auto flex min-h-12 w-full cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-fit [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Show more features</span>
              <span className="hidden group-open:inline">Show less</span>
              <ChevronDown className="size-4 text-primary transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
            </summary>
            <div id="extra-features" className="landing-details-grid grid gap-4 pt-5 md:grid-cols-2">
              <article className="landing-feature-card rounded-3xl border border-border bg-card p-6 sm:p-8">
                <MonitorPlay className="mb-5 size-5 text-primary" aria-hidden />
                <h3 className="text-lg font-semibold tracking-tight">Pick up where you left off.</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Track series episode by episode, or tick a whole season. Your next episode is easy to find.</p>
                <div className="mt-6 rounded-xl border border-border bg-background/50 p-3.5">
                  <div className="mb-2.5 flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Example season progress</span><span>6 / 8</span></div>
                  <div role="progressbar" aria-label="Example season progress" aria-valuenow={6} aria-valuemin={0} aria-valuemax={8} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="landing-progress-fill h-full w-3/4 origin-left rounded-full bg-primary" /></div>
                </div>
              </article>

              <article className="landing-feature-card rounded-3xl border border-border bg-card p-6 sm:p-8">
                <Star className="mb-5 size-5 text-primary" aria-hidden />
                <h3 className="text-lg font-semibold tracking-tight">The good nights, remembered.</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Log who watched with you, revisit your favourites, and look back at your own year or your family&apos;s.</p>
                <div className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-background/50 p-3.5">
                  <span className="landing-memory-icon flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary"><Users className="size-4" aria-hidden /></span>
                  <div><p className="text-xs font-medium">Watched together</p><p className="mt-0.5 text-[10px] text-muted-foreground">The film, the people, the memory.</p></div>
                </div>
              </article>
            </div>
          </details>
        </section>

        <section data-reveal="0" aria-labelledby="start-heading" className="mx-auto mb-16 w-full max-w-6xl px-5 sm:mb-20 sm:px-8">
          <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-primary/5 px-6 py-10 text-center sm:px-12 sm:py-14">
            <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">Something good is waiting on your list</p>
            <h2 id="start-heading" className="mx-auto mt-4 max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Make room for your next favourite.</h2>
            <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">Start with your own watchlist. Bring your people when you&apos;re ready.</p>
            <Link href="/login" className={buttonVariants({ size: "lg", className: "landing-cta mt-7" })}>Create your watchlist <ArrowRight className="size-4" aria-hidden /></Link>
          </div>
          <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden /> Your data, your choice. Export it or delete your account at any time.</p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 text-xs text-muted-foreground sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-sm">
            <p className="font-semibold text-foreground">FamFlix</p>
            <p className="mt-2 leading-relaxed">A place to choose and remember what you watch.<br />Not a streaming service.</p>
          </div>
          <div className="flex max-w-sm flex-col gap-2">
            <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">
              <Image src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" width={92} height={12} className="h-3 w-auto" />
            </a>
            <p className="leading-relaxed">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
          </div>
          <div className="shrink-0">
            <p>
              <Link href="/privacy" className="underline hover:text-foreground">Privacy</Link>
              {" · "}
              <Link href="/terms" className="underline hover:text-foreground">Terms</Link>
            </p>
            <p className="mt-2">Only the cookies needed to keep you signed in.</p>
          </div>
        </div>
      </footer>
    </LandingMotion>
  );
}
