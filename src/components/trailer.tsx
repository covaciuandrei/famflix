"use client";

import { Play } from "lucide-react";
import { useState } from "react";

/**
 * A title's trailer. Nothing loads from YouTube until someone presses play, and then it plays in YouTube's
 * privacy-enhanced mode (youtube-nocookie.com), so just opening a title page sets no YouTube cookies.
 */
export function Trailer({
  youtubeKey,
  title,
  backdrop,
}: {
  youtubeKey: string;
  title: string;
  /** A still from TMDB to show before it plays. */
  backdrop: string | null;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Trailer</h2>
      <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-muted">
        {playing ? (
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeKey)}?autoplay=1&rel=0`}
            title={`${title} trailer`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play the ${title} trailer`}
            className="group absolute inset-0 flex items-center justify-center"
          >
            {backdrop && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={backdrop}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-60 transition-opacity group-hover:opacity-80"
              />
            )}
            <span className="relative flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-105">
              <Play className="size-7 translate-x-0.5 fill-current" />
            </span>
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Plays from YouTube, which may set its own cookies once it starts.
      </p>
    </section>
  );
}
