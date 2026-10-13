import { type AddTarget } from "@/components/add-to-list-button";
import { Carousel } from "@/components/carousel";
import { MediaCard } from "@/components/media-card";
import { libraryKey } from "@/lib/constants";
import type { TmdbItem } from "@/lib/tmdb";
import type { LibraryIndex } from "@/lib/types";

export function MediaRow({
  title,
  items,
  targets,
  library,
}: {
  title: string;
  items: TmdbItem[];
  targets: AddTarget[];
  library?: LibraryIndex;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Carousel label={title} arrowClassName="top-24 sm:top-[6.75rem]">
        {items.map((item) => (
          <li
            key={`${item.mediaType}-${item.tmdbId}`}
            className="w-32 shrink-0 sm:w-36"
          >
            <MediaCard
              item={item}
              targets={targets}
              library={library?.[libraryKey(item.mediaType, item.tmdbId)]}
            />
          </li>
        ))}
      </Carousel>
    </section>
  );
}
