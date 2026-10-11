import { ArrowLeft, Clock, Star } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AddToListButton } from "@/components/add-to-list-button";
import { ListBadges, SeenBy } from "@/components/library-badges";
import { MarkWatchedButton } from "@/components/mark-watched-button";
import { MediaPoster } from "@/components/media-poster";
import { MediaRow } from "@/components/media-row";
import { WatchAgain } from "@/components/rewatch/watch-again";
import { WatchedBefore } from "@/components/rewatch/watched-before";
import { EpisodeTracker } from "@/components/series/episode-tracker";
import { AgeBadge } from "@/components/title/age-badge";
import { CastRow } from "@/components/title/cast-row";
import { CrewLine } from "@/components/title/crew-line";
import { Trailer } from "@/components/trailer";
import { Badge } from "@/components/ui/badge";
import { libraryKey, mediaTypeLabel } from "@/lib/constants";
import {
  getEpisodeHistory,
  getEpisodeLogs,
  getLibraryIndex,
  getMyGroups,
  getMyRating,
  getMyViewings,
  getSessionProfile,
} from "@/lib/data";
import { tmdbImage } from "@/lib/images";
import { myViewings } from "@/lib/rewatch";
import { episodeKey, seasonToOpen } from "@/lib/series";
import { getCollection, getMediaDetails, getSeasonEpisodes, TmdbError } from "@/lib/tmdb";
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
  const index = await getLibraryIndex(user.id, groups, { seenBy: true });
  const library = index[libraryKey(mediaType, id)];
  const onMyList = library?.lists.find((l) => l.listId === null);
  const [myRating, viewings] = await Promise.all([
    onMyList ? getMyRating(onMyList.itemId, user.id) : null,
    getMyViewings({
      userId: user.id,
      mediaType,
      tmdbId: id,
      item: onMyList ? { id: onMyList.itemId, watched: onMyList.watched } : null,
    }),
  ]);

  // Only a TMDB 404 means "no such title"; anything else goes to the error page.
  const details = await getMediaDetails(mediaType, id, { extras: true }).catch((e) => {
    if (e instanceof TmdbError && e.status === 404) return null;
    throw e;
  });
  if (!details) notFound();
  const { extras } = details;

  // The other films of the collection a film belongs to; a collection TMDB can't give just hides the row.
  const collection = extras.collection ? await getCollection(extras.collection.id).catch(() => null) : null;
  const otherFilms = collection?.items.filter((film) => film.tmdbId !== id) ?? [];

  // A series is watched again by episode (its tracker below), so only a movie, or a series without episodes, gets this.
  const again = details.series ? null : myViewings(viewings.current, viewings.earlier);

  const backdrop = tmdbImage(details.backdropPath, "w1280");

  // A series' seasons and episodes, to tick: where the person is, and the season to show open first.
  let episodes: React.ReactNode = null;
  if (details.series) {
    const entry = onMyList
      ? {
          id: onMyList.itemId,
          watched: onMyList.watched,
          score: myRating?.score ?? null,
          comment: myRating?.comment ?? null,
        }
      : null;
    const [ticks, history] = entry
      ? await Promise.all([getEpisodeLogs(entry.id), getEpisodeHistory(entry.id)])
      : [[], []];
    const season = seasonToOpen(
      details.series,
      new Set(ticks.map((t) => episodeKey(t.s, t.e))),
      entry?.watched ?? false,
    );
    episodes = (
      <EpisodeTracker
        tmdbId={id}
        title={details.title}
        series={details.series}
        item={entry}
        ticks={ticks}
        history={history}
        watchedOn={viewings.current}
        initial={{ season, episodes: await getSeasonEpisodes(id, season).catch(() => null) }}
      />
    );
  }

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
          <div className="relative w-32 shrink-0 sm:w-44">
            <MediaPoster
              path={details.posterPath}
              alt={details.title}
              size="w500"
              className="w-full"
            />
            <ListBadges lists={library?.lists} />
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
                <AgeBadge certification={extras.certification} />
              </div>
              <div className="mt-2">
                <CrewLine credit={extras.credit} />
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
              <MarkWatchedButton
                tmdbId={details.tmdbId}
                mediaType={mediaType}
                title={details.title}
                mine={
                  onMyList
                    ? {
                        itemId: onMyList.itemId,
                        watched: onMyList.watched,
                        score: myRating?.score ?? null,
                        comment: myRating?.comment ?? null,
                      }
                    : null
                }
              />
              {onMyList?.watched && !details.series && (
                <WatchAgain
                  itemId={onMyList.itemId}
                  title={details.title}
                  mine={{ score: myRating?.score ?? null, comment: myRating?.comment ?? null }}
                  size="default"
                />
              )}
              <AddToListButton
                tmdbId={details.tmdbId}
                mediaType={mediaType}
                title={details.title}
                targets={targets}
                alreadyOn={library?.lists}
                size="default"
              />
              <SeenBy names={library?.seenBy} />
            </div>
            {again?.chip && <WatchedBefore chip={again.chip} lines={again.lines} />}
          </div>
        </div>
      </div>

      {episodes}

      {details.trailerKey && (
        <Trailer
          youtubeKey={details.trailerKey}
          title={details.title}
          backdrop={tmdbImage(details.backdropPath, "w780")}
        />
      )}

      <CastRow cast={extras.cast} />

      {collection && (
        <MediaRow
          title={`Other films in the ${collection.name || "collection"}`}
          items={otherFilms}
          targets={targets}
          library={index}
        />
      )}

      <MediaRow title="More like this" items={extras.similar} targets={targets} library={index} />
    </div>
  );
}
