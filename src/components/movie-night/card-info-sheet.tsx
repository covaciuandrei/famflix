"use client";

import { ExternalLink, Star, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef } from "react";

import { Trailer } from "@/components/trailer";
import { formatRuntime, formatScore } from "@/lib/format";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import { tmdbImage } from "@/lib/images";
import type { DeckCard } from "@/lib/movie-night";

/**
 * More about a card: the whole description, genres and the trailer (it loads from YouTube only when played).
 * A bottom sheet on phones and a centred window on wider screens. Shown while `card` is set.
 */
export function CardInfoSheet({
  card,
  onClose,
  titlePage = true,
}: {
  card: DeckCard | null;
  onClose: () => void;
  /** Offer the title's page in the app (a guest has no account to open it with). */
  titlePage?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (card) openModal(dialog);
    else if (dialog.open) dialog.close();
  }, [card]);

  const poster = card ? tmdbImage(card.posterPath, "w185") : null;
  const facts = card
    ? [
        card.mediaType === "tv" ? "Series" : "Movie",
        card.year ? String(card.year) : null,
        card.mediaType === "movie" && card.runtime ? formatRuntime(card.runtime) : null,
      ].filter(Boolean)
    : [];

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      {...closeOnBackdrop}
      onClose={onClose}
      aria-labelledby="card-info-title"
      className="sheet mx-auto mt-auto mb-0 max-h-[88dvh] w-full max-w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-5 text-foreground shadow-xl outline-none backdrop:bg-black/60 sm:my-auto sm:w-[min(36rem,calc(100%-2rem))] sm:rounded-2xl"
    >
      {card && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-4">
            {poster && (
              <Image
                src={poster}
                alt=""
                width={92}
                height={138}
                className="w-20 shrink-0 rounded-lg sm:w-24"
              />
            )}
            <div className="min-w-0 flex-1">
              <h2 id="card-info-title" className="text-xl leading-tight font-bold">
                {card.title}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                {facts.join(" · ")}
                {card.rating ? (
                  <span className="inline-flex items-center gap-1 text-star">
                    <Star className="size-3.5 fill-current" />
                    {formatScore(Math.round(card.rating * 10) / 10)}
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {card.origin === "list" ? "From your list" : "Suggested for this movie night"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Close"
              className="-mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>

          {card.genres.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {card.genres.map((genre) => (
                <li key={genre} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                  {genre}
                </li>
              ))}
            </ul>
          )}

          {card.overview ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{card.overview}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No description yet.</p>
          )}

          {card.trailerKey && (
            <Trailer
              youtubeKey={card.trailerKey}
              title={card.title}
              backdrop={tmdbImage(card.backdropPath, "w780")}
            />
          )}

          {titlePage && (
            <a
              href={`/app/media/${card.mediaType}/${card.tmdbId}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 self-start text-sm text-primary underline-offset-2 hover:underline"
            >
              Open the title page
              <ExternalLink className="size-4" />
            </a>
          )}
        </div>
      )}
    </dialog>
  );
}
