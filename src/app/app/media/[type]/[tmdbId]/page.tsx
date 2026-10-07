import { ArrowLeft, Clock, Star } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AddToListButton } from "@/components/add-to-list-button";
import { LibraryBadges } from "@/components/library-badges";
import { MediaPoster } from "@/components/media-poster";
import { Badge } from "@/components/ui/badge";
import { libraryKey, mediaTypeLabel } from "@/lib/constants";
import { getLibraryIndex, getMyGroups, getSessionProfile } from "@/lib/data";
import { tmdbImage } from "@/lib/images";
import { getMediaDetails, TmdbError } from "@/lib/tmdb";
import type { MediaType } from "@/lib/types";

export default async function MediaDetailPage({
  params,
}: {
  params: Promise<{ type: string; tmdbId: string }>;
}) {
  const { type, tmdbId } = await params;
  if (type !== "movie" && type !== "tv") notFound();
  const mediaType = type as MediaType;
  const id = Number(tmdbId);
  if (!Number.isFinite(id)) notFound();

  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const groups = await getMyGroups();
  const targets = [
    { id: null, label: "My list" },
    ...groups.map((g) => ({ id: g.id, label: g.name })),
  ];
  const library = (await getLibraryIndex(user.id, groups))[
    libraryKey(mediaType, id)
  ];

  // Only a TMDB 404 means "no such title"; anything else goes to the error page.
  const details = await getMediaDetails(mediaType, id).catch((e) => {
    if (e instanceof TmdbError && e.status === 404) return null;
    throw e;
  });
  if (!details) notFound();

  const backdrop = tmdbImage(details.backdropPath, "w1280");

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/app/browse"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to browse
      </Link>

      <div className="relative overflow-hidden rounded-2xl border border-border">
        {backdrop && (
          <div className="absolute inset-0 -z-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={backdrop}
              alt=""
              className="h-full w-full object-cover opacity-20"
            />
          </div>
        )}
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:p-6">
          <div className="w-32 shrink-0 sm:w-44">
            <MediaPoster
              path={details.posterPath}
              alt={details.title}
              size="w500"
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">{details.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge>{mediaTypeLabel(mediaType)}</Badge>
                {details.year && <span>{details.year}</span>}
                {details.runtime ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" />
                    {details.runtime} min
                  </span>
                ) : null}
                {details.voteAverage > 0 && (
                  <span className="inline-flex items-center gap-1 text-star">
                    <Star className="size-3.5 fill-current" />
                    {details.voteAverage.toFixed(1)}/10
                  </span>
                )}
              </div>
            </div>

            {details.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {details.genres.map((g) => (
                  <Badge key={g}>{g}</Badge>
                ))}
              </div>
            )}

            {details.overview && (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {details.overview}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <AddToListButton
                tmdbId={details.tmdbId}
                mediaType={mediaType}
                title={details.title}
                targets={targets}
                alreadyOn={library?.lists.map((l) => l.listId)}
                size="default"
              />
              <LibraryBadges entry={library} />
            </div>
          </div>
        </div>
      </div>

      {details.trailerKey && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Trailer</h2>
          <div className="aspect-video overflow-hidden rounded-xl border border-border">
            <iframe
              className="h-full w-full"
              src={`https://www.youtube.com/embed/${details.trailerKey}`}
              title={`${details.title} trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </section>
      )}

      {details.watchProviders.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Where to watch</h2>
          <p className="-mt-1 text-xs text-muted-foreground">
            Streaming availability (US) via JustWatch / TMDB.
          </p>
          <div className="flex flex-wrap gap-3">
            {details.watchProviders.map((p) => (
              <div
                key={p.providerId}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                {p.logoPath && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tmdbImage(p.logoPath, "w92") ?? ""}
                    alt=""
                    className="size-6 rounded"
                  />
                )}
                {p.providerName}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
