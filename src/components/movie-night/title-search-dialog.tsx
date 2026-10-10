"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { MediaPoster } from "@/components/media-poster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mediaTypeLabel } from "@/lib/constants";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import type { TmdbItem } from "@/lib/tmdb";

/**
 * "Pick something else": a window to search for any movie, not only the ones the night showed. It opens as
 * soon as it is shown, so show it only while it is wanted (and drop it from `onClose`). Choosing a result hands the
 * title to `onSelect`.
 */
export function TitleSearchDialog({
  onSelect,
  onClose,
}: {
  onSelect: (item: TmdbItem) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState<TmdbItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openModal(dialogRef.current);
    inputRef.current?.focus();
  }, []);

  async function search(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) {
      setResults(null);
      return;
    }
    // Closes the phone keyboard so the results aren't hidden behind it.
    inputRef.current?.blur();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=movie`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Search failed. Please try again.");
      setResults(data.results as TmdbItem[]);
      setSearched(query);
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "You seem to be offline. Check your connection and try again."
          : (err as Error).message,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      {...closeOnBackdrop}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto max-h-[85vh] w-[min(28rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl outline-none backdrop:bg-black/60"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        Pick something else
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Decided on a movie that wasn&apos;t in the stack? Search for any movie. Picking it ends the movie night, like
        picking one from the leaderboard.
      </p>

      <form onSubmit={search} className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search movies…"
            aria-label="Search for a movie"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : "Search"}
        </Button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {results &&
        (results.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {results.map((item) => (
              <li key={`${item.mediaType}-${item.tmdbId}`}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  aria-label={`Pick ${item.title}${item.year ? ` (${item.year})` : ""}`}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-2 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <MediaPoster path={item.posterPath} alt="" size="w92" sizes="40px" className="w-10 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-sm font-medium">{item.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {mediaTypeLabel(item.mediaType)}
                      {item.year ? ` · ${item.year}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No results for “{searched}”.</p>
        ))}

      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
