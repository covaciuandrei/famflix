import { User } from "lucide-react";
import Image from "next/image";

import { tmdbImage } from "@/lib/images";
import type { CastMember } from "@/lib/title-details";

/** The top-billed cast of a title: a row of faces with their names and the parts they play. Hidden when TMDB lists none. */
export function CastRow({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) return null;
  return (
    <section aria-labelledby="cast-title" className="flex flex-col gap-3">
      <h2 id="cast-title" className="text-lg font-semibold">
        Cast
      </h2>
      <ul className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {cast.map((person) => {
          const photo = tmdbImage(person.profilePath, "w185");
          return (
            <li key={person.id} className="w-24 shrink-0 text-center sm:w-28">
              <div className="relative mx-auto size-20 overflow-hidden rounded-full bg-muted sm:size-24">
                {photo ? (
                  // The name under it says who it is.
                  <Image src={photo} alt="" fill sizes="96px" className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <User className="size-8" aria-hidden />
                  </div>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-medium">{person.name}</p>
              {person.character && (
                <p className="line-clamp-2 text-xs text-muted-foreground">{person.character}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
