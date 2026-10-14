import { type AddTarget } from "@/components/add-to-list-button";
import { Carousel } from "@/components/carousel";
import { PagedRow } from "@/components/paged-row";
import { RowCard } from "@/components/row-card";
import { type RowSource, rowSourceKey } from "@/lib/browse-rows";
import { libraryKey } from "@/lib/constants";
import type { TmdbItem } from "@/lib/tmdb";
import type { LibraryIndex } from "@/lib/types";

/** Level with the middle of the posters, where the arrows sit. */
const ARROW_TOP = "top-24 sm:top-[6.75rem]";

export function MediaRow({
  title,
  items,
  targets,
  library,
  source,
  hasMore = false,
}: {
  title: string;
  items: TmdbItem[];
  targets: AddTarget[];
  library?: LibraryIndex;
  /** With these, the row goes on loading the pages after `items` (the first one) as it is scrolled to its end. */
  source?: RowSource;
  hasMore?: boolean;
}) {
  if (items.length === 0) return null;
  const cards = items.map((item) => {
    const key = libraryKey(item.mediaType, item.tmdbId);
    return <RowCard key={key} item={item} targets={targets} library={library?.[key]} />;
  });
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {source && hasMore ? (
        <PagedRow
          key={rowSourceKey(source)}
          label={title}
          source={source}
          firstKeys={items.map((item) => libraryKey(item.mediaType, item.tmdbId))}
          targets={targets}
          library={library}
          arrowClassName={ARROW_TOP}
        >
          {cards}
        </PagedRow>
      ) : (
        <Carousel label={title} arrowClassName={ARROW_TOP}>
          {cards}
        </Carousel>
      )}
    </section>
  );
}
