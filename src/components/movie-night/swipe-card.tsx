import { Film, Info, Star } from "lucide-react";
import Image from "next/image";

import { formatRuntime, formatScore } from "@/lib/format";
import { tmdbImage } from "@/lib/images";
import type { DeckCard } from "@/lib/movie-night";

// The stamps fade in with the drag. The deck sets --dx (-1 to 1) while dragging, and --love and --seen (0 or 1)
// when a button or key votes, so nothing re-renders while a finger moves.
const stamp =
  "pointer-events-none absolute rounded-md border-4 bg-black/45 px-3 py-1 text-2xl font-extrabold tracking-wider";

/**
 * What one card shows, like a title you'd browse on Netflix: the poster on top and, below it on a panel of its own
 * (so the picture isn't covered), the name, a line of facts, genres and a blurb of up to four lines. How much of the
 * text shows depends on the card's height (see .swipe-card in globals.css), so the poster never shrinks to a sliver.
 */
export function SwipeCardFace({
  card,
  priority,
  onInfo,
  listLabel = "From your list",
}: {
  card: DeckCard;
  /** The top card's poster loads first, and the next one with it so it is ready after a swipe. */
  priority: boolean;
  onInfo?: () => void;
  /** What a card from a list says (a guest has no list of their own). */
  listLabel?: string;
}) {
  const poster = tmdbImage(card.posterPath, "w500");
  const facts = [
    card.year ? String(card.year) : null,
    card.mediaType === "tv" ? "Series" : card.runtime ? formatRuntime(card.runtime) : null,
  ].filter(Boolean);

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="relative min-h-0 flex-1 bg-muted">
          {poster ? (
            <Image
              src={poster}
              alt=""
              fill
              priority={priority}
              draggable={false}
              sizes="(max-width: 640px) 92vw, 380px"
              className="pointer-events-none object-cover object-[center_25%]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Film className="size-12" />
            </div>
          )}
          {/* The picture fades into the panel under it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card to-transparent"
          />
        </div>

        <div className="flex min-h-[9.5rem] shrink-0 flex-col gap-1.5 px-4 pt-0.5 pb-4">
          <h2 className="line-clamp-2 text-xl leading-tight font-bold text-foreground">{card.title}</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {facts.join(" · ")}
            {card.rating ? (
              <span className="inline-flex items-center gap-1 text-star">
                <Star className="size-3.5 fill-current" />
                {formatScore(Math.round(card.rating * 10) / 10)}
              </span>
            ) : null}
          </p>
          {card.genres.length > 0 && (
            <ul className="swipe-chips flex flex-wrap gap-1.5">
              {card.genres.slice(0, 3).map((genre) => (
                <li key={genre} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {genre}
                </li>
              ))}
            </ul>
          )}
          {card.overview && <p className="swipe-blurb text-sm leading-snug text-foreground/80">{card.overview}</p>}
        </div>
      </div>

      <span className="absolute top-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white">
        {card.origin === "list" ? listLabel : "Suggested"}
      </span>
      {onInfo && (
        <button
          type="button"
          onClick={onInfo}
          aria-label={`More about ${card.title}`}
          className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <Info className="size-5" />
        </button>
      )}

      <div
        aria-hidden
        className={`${stamp} top-14 left-4 -rotate-12 border-like text-like`}
        style={{ opacity: "clamp(0, calc(var(--dx, 0) * 1.6), 1)" }}
      >
        YES
      </div>
      <div
        aria-hidden
        className={`${stamp} top-14 right-4 rotate-12 border-dislike text-dislike`}
        style={{ opacity: "clamp(0, calc(var(--dx, 0) * -1.6), 1)" }}
      >
        NOPE
      </div>
      <div
        aria-hidden
        className={`${stamp} top-1/3 left-1/2 -translate-x-1/2 border-pink-400 text-pink-400`}
        style={{ opacity: "var(--love, 0)" }}
      >
        LOVE
      </div>
      <div
        aria-hidden
        className={`${stamp} top-1/3 left-1/2 -translate-x-1/2 border-sky-300 text-sky-300`}
        style={{ opacity: "var(--seen, 0)" }}
      >
        SEEN IT
      </div>
    </>
  );
}
