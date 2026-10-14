"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import type { AddTarget } from "@/components/add-to-list-button";
import { Carousel } from "@/components/carousel";
import { RowCard, RowCardSkeleton, RowNotice } from "@/components/row-card";
import { Button } from "@/components/ui/button";
import { type CardItem, type RowSource, loadNextTitles, rowSourceToParams } from "@/lib/browse-rows";
import { libraryKey } from "@/lib/constants";
import type { LibraryIndex } from "@/lib/types";

const UNAVAILABLE = "Couldn't load more titles right now.";

/** One page of the row, from the server. */
async function fetchPage(query: string, page: number, signal: AbortSignal) {
  const response = await fetch(`/api/browse/rows?${query}&page=${page}`, { signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : UNAVAILABLE);
  if (!Array.isArray(data?.items) || typeof data.hasMore !== "boolean") throw new Error(UNAVAILABLE);
  return data as { items: CardItem[]; hasMore: boolean };
}

type Status = "idle" | "loading" | "failed";

/**
 * A row of titles that has no last card until TMDB runs out: it shows the first page, which the server rendered
 * (`children`), and fetches the next page when scrolled near its end, by swiping, with the wheel or with the arrows.
 * Cards that are already on show are not shown twice. A page that fails to load stops the row asking until the person
 * says to try again.
 */
export function PagedRow({
  label,
  source,
  firstKeys,
  targets,
  library,
  arrowClassName,
  children,
}: {
  label: string;
  source: RowSource;
  /** The first page's titles (libraryKey), so none of them is shown again by a later page. */
  firstKeys: string[];
  targets: AddTarget[];
  library?: LibraryIndex;
  arrowClassName: string;
  /** The first page's cards, as list items. */
  children: ReactNode;
}) {
  const query = rowSourceToParams(source).toString();
  const [items, setItems] = useState<CardItem[]>([]);
  const [more, setMore] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [problem, setProblem] = useState(UNAVAILABLE);

  // What loading needs to know at once, without waiting for a render.
  const loading = useRef(false);
  const failed = useRef(false);
  const done = useRef(false);
  const lastPage = useRef(1);
  const seen = useRef<Set<string> | null>(null);
  const first = useRef(firstKeys);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    first.current = firstKeys;
  });
  // Leaving the page cancels a page that is on its way.
  useEffect(() => () => request.current?.abort(), []);

  async function loadMore(retry = false) {
    if (loading.current || done.current || (failed.current && !retry)) return;
    loading.current = true;
    failed.current = false;
    setStatus("loading");
    const controller = new AbortController();
    request.current = controller;
    try {
      const loaded = await loadNextTitles({
        fetchPage: (page) => fetchPage(query, page, controller.signal),
        afterPage: lastPage.current,
        seen: (seen.current ??= new Set(first.current)),
      });
      lastPage.current = loaded.page;
      done.current = !loaded.hasMore;
      setMore(loaded.hasMore);
      if (loaded.items.length > 0) setItems((now) => [...now, ...loaded.items]);
      setStatus("idle");
    } catch (error) {
      if (controller.signal.aborted) {
        // The row was taken off the page while a page was on its way.
        setStatus("idle");
        return;
      }
      failed.current = true;
      setProblem(
        error instanceof TypeError
          ? "You seem to be offline. Check your connection."
          : error instanceof Error
            ? error.message
            : UNAVAILABLE,
      );
      setStatus("failed");
    } finally {
      loading.current = false;
    }
  }

  // The page can be shown again with other first titles (after adding one to a list, say), so what a page loaded
  // that the first page now has is left out.
  const onShow = new Set(firstKeys);
  const loaded = items.filter((item) => !onShow.has(libraryKey(item.mediaType, item.tmdbId)));

  return (
    <>
      <Carousel
        label={label}
        arrowClassName={arrowClassName}
        // After a failure the only way on is the button: an arrow with nothing to scroll to would do nothing.
        more={more && status !== "failed"}
        onNearEnd={() => void loadMore()}
      >
        {children}
        {loaded.map((item) => {
          const key = libraryKey(item.mediaType, item.tmdbId);
          return <RowCard key={key} item={item} targets={targets} library={library?.[key]} />;
        })}
        {status === "loading" && [0, 1, 2, 3].map((n) => <RowCardSkeleton key={n} />)}
        {status === "failed" && (
          <RowNotice>
            <p>{problem}</p>
            <Button size="sm" variant="outline" onClick={() => void loadMore(true)}>
              Try again
            </Button>
          </RowNotice>
        )}
      </Carousel>
      <p role="status" className="sr-only">
        {status === "loading" ? "Loading more titles…" : status === "failed" ? problem : ""}
      </p>
    </>
  );
}
