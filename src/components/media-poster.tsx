import { Film } from "lucide-react";
import Image from "next/image";

import { tmdbImage, type PosterSize } from "@/lib/images";
import { cn } from "@/lib/utils";

export function MediaPoster({
  path,
  alt,
  size = "w342",
  sizes = "(max-width: 640px) 33vw, 200px",
  className,
}: {
  path: string | null | undefined;
  alt: string;
  size?: PosterSize;
  sizes?: string;
  className?: string;
}) {
  const src = tmdbImage(path, size);
  return (
    <div
      className={cn(
        "relative aspect-[2/3] overflow-hidden rounded-lg bg-muted",
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className="object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Film className="size-8" />
        </div>
      )}
    </div>
  );
}
