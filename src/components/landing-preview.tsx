"use client";

import { ArrowUpRight, Check, CheckCheck, Clapperboard, ListPlus, Star, Users } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const views = [
  { id: "mine", label: "My list", Icon: ListPlus },
  { id: "family", label: "Family list", Icon: Users },
  { id: "night", label: "Movie night", Icon: Clapperboard },
] as const;

type View = (typeof views)[number]["id"];
type Artwork = "orbit" | "lighthouse" | "bloom" | "metro";

const titles: { title: string; genre: string; artwork: Artwork; addedBy: string }[] = [
  { title: "Orbit Club", genre: "Sci-fi · Adventure", artwork: "orbit", addedBy: "Alex's pick" },
  { title: "The Last Lighthouse", genre: "Adventure", artwork: "lighthouse", addedBy: "Luna's pick" },
  { title: "Sunday in Bloom", genre: "Comedy", artwork: "bloom", addedBy: "Sam's pick" },
];

const nightResults: { title: string; artwork: Artwork; points: number; votes: string }[] = [
  { title: "Orbit Club", artwork: "orbit", points: 5, votes: "2 Love · 1 Yes" },
  { title: "Sunday in Bloom", artwork: "bloom", points: 3, votes: "1 Love · 1 Yes · 1 Seen it" },
  { title: "The Last Lighthouse", artwork: "lighthouse", points: 1, votes: "1 Love · 1 Nope · 1 Seen it" },
  { title: "Midnight Metro", artwork: "metro", points: -1, votes: "1 Yes · 2 Nope" },
];

function Poster({ artwork }: { artwork: Artwork }) {
  return (
    <svg
      viewBox="0 0 120 160"
      fill="none"
      aria-hidden="true"
      className="h-full w-full rounded-lg"
    >
      {artwork === "orbit" ? (
        <>
          <path fill="#18324d" d="M0 0h120v160H0z" />
          <circle cx="66" cy="68" r="37" fill="#a5d6d3" />
          <path d="M31 80a37 37 0 0 0 70-22A49 49 0 0 1 31 80Z" fill="#6ba6b7" />
          <ellipse cx="62" cy="70" rx="54" ry="13" transform="rotate(-30 62 70)" stroke="#d7f0dd" strokeWidth="3" />
          <circle cx="22" cy="27" r="1.5" fill="#ededf2" />
          <circle cx="101" cy="120" r="1.5" fill="#ededf2" />
          <circle cx="31" cy="132" r="1" fill="#ededf2" />
        </>
      ) : artwork === "lighthouse" ? (
        <>
          <path fill="#bc7f89" d="M0 0h120v160H0z" />
          <circle cx="88" cy="46" r="24" fill="#ffe1a3" />
          <path d="M0 115c42-26 83-16 120 4v41H0Z" fill="#263e56" />
          <path d="m31 55-7 67h24l-7-67Z" fill="#f3e4c3" />
          <path d="m19 55 17-17 17 17-6 10H25Z" fill="#613749" />
          <path d="m43 52 54 11v9L43 59Z" fill="#ffe1a3" opacity=".6" />
        </>
      ) : artwork === "bloom" ? (
        <>
          <path fill="#e1b5b3" d="M0 0h120v160H0z" />
          <path d="M0 125c46-50 85-36 120-22v57H0Z" fill="#526f61" />
          <path d="m67 72-20 64" stroke="#345242" strokeWidth="3" />
          <path d="M54 55a13 13 0 1 1 25 0 13 13 0 1 1 0 25 13 13 0 1 1-25 0 13 13 0 1 1 0-25Z" fill="#f5e5d6" />
          <circle cx="66.5" cy="67.5" r="13" fill="#edc56f" />
        </>
      ) : (
        <>
          <path fill="#292342" d="M0 0h120v160H0z" />
          <circle cx="88" cy="37" r="17" fill="#c1a8dd" />
          <path d="M0 77h24v83H0zm30-25h25v108H30zm31 41h22v67H61zm28-29h31v96H89z" fill="#51456f" />
          <path d="M37 67h5v7h-5zm9 0h5v7h-5zm-9 13h5v7h-5zm59-1h5v7h-5zm10 0h5v7h-5z" fill="#e7c894" />
          <path d="m0 142 120-28v10L0 152Z" fill="#b9a2d4" />
        </>
      )}
    </svg>
  );
}

export function LandingPreview() {
  const [view, setView] = useState<View>("mine");
  const [watched, setWatched] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const showWatched = view === "mine" && watched;
  const shown = showWatched ? titles.slice(0, 1) : titles;

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % views.length; break;
      case "ArrowLeft": next = (index + views.length - 1) % views.length; break;
      case "Home": next = 0; break;
      case "End": next = views.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setView(views[next].id);
    tabs.current[next]?.focus();
  }

  return (
    <div data-reveal="1" data-preview-shell className="relative min-w-0">
      <div aria-hidden className="landing-preview-aura pointer-events-none absolute -inset-8 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card shadow-[0_24px_100px_-40px_rgba(124,92,255,0.5)]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-like" aria-hidden />
            A little look inside
          </span>
          <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">FamFlix / preview</span>
        </div>
        <div role="tablist" aria-label="Explore FamFlix" className="relative isolate mx-4 mt-4 grid grid-cols-3 rounded-xl bg-muted p-1 sm:mx-6 sm:mt-5">
          <span
            aria-hidden
            className="landing-tab-indicator pointer-events-none absolute inset-y-1 left-1 -z-10 w-[calc((100%_-_0.5rem)/3)] rounded-lg border border-border/60 bg-card shadow-sm"
            style={{ transform: `translateX(${views.findIndex((item) => item.id === view) * 100}%)` }}
          />
          {views.map(({ id: key, label, Icon }, index) => (
            <button
              key={key}
              ref={(element) => { tabs.current[index] = element; }}
              type="button"
              role="tab"
              id={`${id}-${key}-tab`}
              aria-controls={`${id}-${key}-panel`}
              aria-selected={view === key}
              tabIndex={view === key ? 0 : -1}
              onClick={() => setView(key)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={cn(
                "flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-xs",
                view === key ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {views.map(({ id: key, label }) => (
          <div
            key={key}
            role="tabpanel"
            id={`${id}-${key}-panel`}
            aria-labelledby={`${id}-${key}-tab`}
            hidden={view !== key}
            tabIndex={0}
            className="landing-preview-panel min-h-[32rem] p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-6"
          >
            {key === "night" ? (
              <>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Friday crew · Movie night</p>
                    <h2 className="mt-1 text-lg font-semibold tracking-tight">Tonight&apos;s picks</h2>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">3 votes each</span>
                </div>
                <ol aria-label="Example movie-night leaderboard" className="space-y-2.5">
                  {nightResults.map((result, index) => (
                    <li key={result.title} className={cn(
                      "landing-preview-row landing-result flex items-center gap-2.5 rounded-xl border p-2.5",
                      index === 0 ? "border-primary/30 bg-primary/5" : "border-border bg-background/40",
                    )}>
                      <span className={cn("w-3 shrink-0 text-[10px] font-medium", index === 0 ? "text-primary" : "text-muted-foreground")}>{index + 1}</span>
                      <div className="h-12 w-9 shrink-0"><Poster artwork={result.artwork} /></div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-xs font-medium leading-snug">{result.title}</h3>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{result.votes}</p>
                      </div>
                      <span className={cn("overflow-hidden shrink-0 rounded-full px-2 py-1 text-[10px] font-medium", index === 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                        <span className="landing-points-value block">{result.points} {Math.abs(result.points) === 1 ? "point" : "points"}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Guests can vote from a link, without creating an account.
                </p>
              </>
            ) : (
              <>
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{key === "mine" ? "A space for your next watch" : "One list. Everyone's picks."}</p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight">{key === "mine" ? label : "Friday crew"}</h2>
                  </div>
                  {key === "family" ? (
                    <div className="flex -space-x-2" aria-label="Three example family members">
                      {["A", "L", "S"].map((letter, index) => (
                        <span key={letter} className={cn("flex size-8 items-center justify-center rounded-full border-2 border-card text-[10px] font-semibold text-white", ["bg-[#7550cc]", "bg-[#327a73]", "bg-[#a34e6e]"][index])} aria-hidden>{letter}</span>
                      ))}
                    </div>
                  ) : <span className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground">Personal watchlist</span>}
                </div>
                <div className="mb-4 flex gap-4 border-b border-border pb-3 text-xs">
                  <span className={cn(!showWatched ? "font-medium text-primary" : "text-muted-foreground")}>To watch <span className="ml-1">{showWatched ? 2 : 3}</span></span>
                  <span className={cn(showWatched ? "font-medium text-primary" : "text-muted-foreground")}>{key === "family" ? "Watched together" : "Watched"} <span className="ml-1">{showWatched ? 1 : 0}</span></span>
                </div>
                <ul className="space-y-2.5">
                  {(view === key ? shown : titles).map((title, index) => (
                    <li key={title.title} className="landing-preview-row flex items-center gap-3 rounded-xl border border-border bg-background/40 p-2.5">
                      <div className="h-16 w-12 shrink-0"><Poster artwork={title.artwork} /></div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-medium">{title.title}</h3>
                        <p className="mt-1 text-[11px] text-muted-foreground">{key === "family" ? title.addedBy : title.genre}</p>
                        {showWatched && <span className="landing-watched-label mt-1.5 flex items-center gap-1 text-[11px] text-like"><Check className="size-3" aria-hidden /> Watched</span>}
                      </div>
                      {key === "mine" && index === 0 && (
                        <Button variant="outline" size="sm" className="h-auto min-h-11 shrink-0 px-2 text-[10px]" onClick={() => setWatched(!watched)}>
                          {watched ? "Reset preview" : "Mark watched"}
                        </Button>
                      )}
                      {key === "family" && <Star className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                    </li>
                  ))}
                </ul>
                {key === "mine" && (
                  <p role="status" className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    {watched ? <CheckCheck className="mt-0.5 size-4 shrink-0 text-like" aria-hidden /> : <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
                    {watched ? "Marked watched, just in this preview. Your real history starts after sign-in." : "Try Mark watched. A good list remembers what you've seen, too."}
                  </p>
                )}
              </>
            )}
          </div>
        ))}
        <p className="border-t border-border px-5 py-3 text-[10px] leading-relaxed text-muted-foreground sm:px-6">Illustrative preview. Fictional titles and people; nothing is saved.</p>
      </div>
    </div>
  );
}
