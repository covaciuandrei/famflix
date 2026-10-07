import { Star } from "lucide-react";
import Link from "next/link";

import {
  AddToListButton,
  type AddTarget,
} from "@/components/add-to-list-button";
import { LibraryBadges } from "@/components/library-badges";
import { MediaPoster } from "@/components/media-poster";
import { mediaTypeLabel } from "@/lib/constants";
import type { TmdbItem } from "@/lib/tmdb";
import type { LibraryEntry } from "@/lib/types";

export function MediaCard({
  item,
  targets,
  library,
}: {
  item: TmdbItem;
  targets: AddTarget[];
  library?: LibraryEntry;
}) {
  const href = `/app/media/${item.mediaType}/${item.tmdbId}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Link href={href}>
          <MediaPoster path={item.posterPath} alt={item.title} />
        </Link>
        {item.voteAverage > 0 && (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-md bg-background/80 px-1.5 py-0.5 text-xs backdrop-blur">
            <Star className="size-3 fill-star text-star" />
            {item.voteAverage.toFixed(1)}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <Link
          href={href}
          className="line-clamp-1 text-sm font-medium hover:underline"
        >
          {item.title}
        </Link>
        <p className="text-xs text-muted-foreground">
          {mediaTypeLabel(item.mediaType)}
          {item.year ? ` · ${item.year}` : ""}
        </p>
        <LibraryBadges entry={library} />
      </div>
      <AddToListButton
        tmdbId={item.tmdbId}
        mediaType={item.mediaType}
        title={item.title}
        targets={targets}
        alreadyOn={library?.lists.map((l) => l.listId)}
        className="w-full"
      />
    </div>
  );
}
