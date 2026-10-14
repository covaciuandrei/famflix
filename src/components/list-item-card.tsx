"use client";

import { CalendarDays, MessageSquare, Star, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { removeListItem } from "@/app/app/actions";
import { AddToListButton, type AddTarget } from "@/components/add-to-list-button";
import { Avatar } from "@/components/avatar";
import { MediaPoster } from "@/components/media-poster";
import { RatingPanel } from "@/components/rating-panel";
import { ReactionButtons } from "@/components/reaction-buttons";
import { StartSeriesAgain } from "@/components/rewatch/start-series-again";
import { WatchAgain } from "@/components/rewatch/watch-again";
import { WatchedBefore } from "@/components/rewatch/watched-before";
import { SeriesCardLine } from "@/components/series/series-card-line";
import { Badge } from "@/components/ui/badge";
import { WatchedOnLine } from "@/components/watched-on-line";
import { WatchedToggle } from "@/components/watched-toggle";
import { WatchedTogetherDialog } from "@/components/watched-together-dialog";
import { mediaTypeLabel } from "@/lib/constants";
import { dayOf } from "@/lib/day";
import { formatDay, formatDayNumeric, formatScore } from "@/lib/format";
import { isWatchedTogether } from "@/lib/list-status";
import {
  canStartSeriesAgain,
  canWatchAgain,
  currentViewingLines,
  isEpisodeSeries,
  rewatchChip,
  viewingLines,
} from "@/lib/rewatch";
import type { ListItemCard as Card, MemberSummary } from "@/lib/types";

export function ListItemCard({
  card,
  currentUserId,
  members,
  share,
  onRemoved,
}: {
  card: Card;
  currentUserId: string;
  /** Only passed for family lists. */
  members?: MemberSummary[];
  /** On My list, for a person in at least one family: the families a title can be added to, and the ones that have it. */
  share?: { families: AddTarget[]; alreadyOn: { listId: string | null; itemId: string }[] };
  onRemoved?: (itemId: string, title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const { media, item } = card;
  const detailHref = `/app/media/${media.media_type}/${media.tmdb_id}`;
  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const answered = new Set(card.ratings.map((r) => r.user_id));
  const waitingFor = card.viewers.filter(
    (v) => !answered.has(v.user_id) && !v.skipped_at,
  );
  const chip = rewatchChip(card);
  const nameOf = (id: string) => memberById.get(id)?.display_name ?? "Someone";
  // When it was watched, as a line: on My list the person's own day, which they can change (not one a family's watch put
  // there, and not a series that has episodes ticked: its days are by episode); on a family list who was there, unless the
  // chip below lists every viewing anyway.
  const familyLines =
    item.group_id && isWatchedTogether(card) && !chip ? currentViewingLines(card, currentUserId, nameOf) : [];
  const ownDay =
    !item.group_id &&
    item.status === "watched" &&
    !card.watchedWith &&
    (!isEpisodeSeries(card) || card.series === null);

  function remove() {
    setRemoveError(null);
    start(async () => {
      const res = await removeListItem(item.id);
      if (res.error) setRemoveError(res.error);
      else onRemoved?.(item.id, media.title);
    });
  }

  return (
    <div
      className="rounded-xl border border-border bg-card p-3"
      data-pending={pending || undefined}
    >
      <div className="flex gap-4">
        <Link href={detailHref} className="w-20 shrink-0 sm:w-24">
          <MediaPoster
            path={media.poster_path}
            alt={media.title}
            className="w-full"
          />
        </Link>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={detailHref}
                className="line-clamp-1 font-semibold hover:underline"
              >
                {media.title}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <Badge>{mediaTypeLabel(media.media_type)}</Badge>
                {media.release_year && <span>{media.release_year}</span>}
                {card.avgScore !== null && (
                  <span className="inline-flex items-center gap-1 text-star">
                    <Star className="size-3.5 fill-current" />
                    {formatScore(card.avgScore)}/10
                    <span className="text-muted-foreground">
                      ({card.ratingCount})
                    </span>
                  </span>
                )}
              </div>
              {/* A title the family watched together, on a viewer's My list: with whom, and when. */}
              {card.watchedWith && item.status === "watched" && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    Watched
                    {card.watchedWith.names.length > 0
                      ? ` with ${card.watchedWith.names.join(", ")}`
                      : ""}
                    {card.watchedWith.on ? ` on ${formatDayNumeric(card.watchedWith.on)}` : ""}
                  </span>
                </p>
              )}
              {ownDay && (
                <div className="mt-1.5">
                  <WatchedOnLine itemId={item.id} title={media.title} day={dayOf(item.watched_at)} />
                </div>
              )}
              {familyLines.map((line, i) => (
                <p
                  key={line.on ?? `unknown-${i}`}
                  className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground"
                >
                  <CalendarDays className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    {line.on ? `Watched ${formatDayNumeric(line.on)}` : "Watched, date unknown"}
                    {line.who.length > 0 ? ` · ${line.who.join(", ")}` : ""}
                  </span>
                </p>
              ))}
              {chip && (
                <div className="mt-1.5">
                  <WatchedBefore chip={chip} lines={viewingLines(card, currentUserId, nameOf)} />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              aria-label="Remove from list"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          {removeError && (
            <p className="text-xs text-destructive">{removeError}</p>
          )}

          <SeriesCardLine card={card} />

          <div className="flex flex-wrap items-center gap-2">
            <WatchedToggle
              itemId={item.id}
              watched={item.status === "watched"}
              title={media.title}
              myScore={card.myScore}
              myComment={card.myComment}
              personal={!item.group_id}
            />
            {members && item.group_id && (
              <WatchedTogetherDialog
                itemId={item.id}
                title={media.title}
                members={members}
                viewers={card.viewers}
                ratings={card.ratings}
                currentUserId={currentUserId}
                done={isWatchedTogether(card)}
              />
            )}
            {canWatchAgain(card) && members && item.group_id && (
              <WatchAgain
                itemId={item.id}
                title={media.title}
                family={{ members, viewers: card.viewers, ratings: card.ratings, currentUserId }}
              />
            )}
            {canWatchAgain(card) && !item.group_id && (
              <WatchAgain
                itemId={item.id}
                title={media.title}
                mine={{ score: card.myScore, comment: card.myComment }}
              />
            )}
            {canStartSeriesAgain(card) && (
              <StartSeriesAgain itemId={item.id} title={media.title} pass={card.passes + 1} />
            )}
            {share && share.families.length > 0 && !item.group_id && (
              <AddToListButton
                tmdbId={media.tmdb_id}
                mediaType={media.media_type}
                title={media.title}
                targets={share.families}
                alreadyOn={share.alreadyOn}
                label="Add to family"
                variant="outline"
                addOnly
              />
            )}
            <ReactionButtons
              itemId={item.id}
              likeCount={card.likeCount}
              dislikeCount={card.dislikeCount}
              mine={card.myReaction}
            />
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              {card.myScore !== null ? (
                <>
                  <Star className="size-4 fill-star text-star" />
                  Your rating
                  <span className="font-semibold text-foreground">
                    {formatScore(card.myScore)}
                  </span>
                </>
              ) : card.myComment ? (
                <>
                  <MessageSquare className="size-4" />
                  Your note
                </>
              ) : (
                <>
                  <Star className="size-4" />
                  Rate / note
                </>
              )}
            </button>
            {card.addedBy && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <Avatar
                  name={card.addedBy.display_name}
                  url={card.addedBy.avatar_url}
                  className="size-5"
                />
                added
              </span>
            )}
          </div>

          {card.viewers.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Seen by</span>
              <div className="flex -space-x-1.5">
                {card.viewers.map((v) => {
                  const m = memberById.get(v.user_id);
                  return (
                    <span
                      key={v.user_id}
                      title={`${m?.display_name ?? "Family member"} · ${formatDay(v.watched_on)}`}
                    >
                      <Avatar
                        name={m?.display_name}
                        url={m?.avatar_url}
                        className="size-5 ring-2 ring-card"
                      />
                    </span>
                  );
                })}
              </div>
              {waitingFor.length > 0 && (
                <span>
                  · waiting for{" "}
                  {waitingFor
                    .map(
                      (v) =>
                        memberById.get(v.user_id)?.display_name ?? "someone",
                    )
                    .join(", ")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Full card width, so the score slider isn't squeezed beside the poster on phones. */}
      {open && (
        <div className="mt-3 rounded-lg border border-border bg-background/40 p-3">
          <RatingPanel
            itemId={item.id}
            myScore={card.myScore}
            myComment={card.myComment}
            ratings={card.ratings}
            currentUserId={currentUserId}
            members={members}
          />
        </div>
      )}
    </div>
  );
}
