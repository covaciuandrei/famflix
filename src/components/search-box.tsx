"use client";

import { Loader2, Search } from "lucide-react";
import { useState, type FormEvent } from "react";

import { type AddTarget } from "@/components/add-to-list-button";
import { MediaCard } from "@/components/media-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { libraryKey } from "@/lib/constants";
import type { TmdbItem } from "@/lib/tmdb";
import type { LibraryIndex } from "@/lib/types";

export function SearchBox({
  targets,
  library,
}: {
  targets: AddTarget[];
  library?: LibraryIndex;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TmdbItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) {
      setResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data.results as TmdbItem[]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search movies & series…"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : "Search"}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results &&
        (results.length > 0 ? (
          <div>
            <h2 className="mb-3 text-lg font-semibold">Search results</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {results.map((item) => (
                <MediaCard
                  key={`${item.mediaType}-${item.tmdbId}`}
                  item={item}
                  targets={targets}
                  library={library?.[libraryKey(item.mediaType, item.tmdbId)]}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No results for “{q}”.</p>
        ))}
    </div>
  );
}
