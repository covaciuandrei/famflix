"use client";

import { MessageSquare, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { removeListItem } from "@/app/app/actions";
import { Avatar } from "@/components/avatar";
import { MediaPoster } from "@/components/media-poster";
import { RatingPanel } from "@/components/rating-panel";
import { ReactionButtons } from "@/components/reaction-buttons";
import { Badge } from "@/components/ui/badge";
import { WatchedToggle } from "@/components/watched-toggle";
import { WatchedTogetherDialog } from "@/components/watched-together-dialog";
import { mediaTypeLabel } from "@/lib/constants";
import { formatDay, formatScore } from "@/lib/format";
import type { ListItemCard as Card, MemberSummary } from "@/lib/types";

export function ListItemCard({
  card,
  currentUserId,
  members,
  onRemoved,
}: {
  card: Card;
  currentUserId: string;
  /** Only passed for family lists. */
  members?: MemberSummary[];
  onRemoved?: (itemId: string, title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const { media, item } = card;
  const detailHref = `/app/media/${media.media_type}/${media.tmdb_id}`;
  const hasMyNote = card.myScore !== null || Boolean(card.myComment);
  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const answered = new Set(card.ratings.map((r) => r.user_id));
  const waitingFor = card.viewers.filter(
    (v) => !answered.has(v.user_id) && !v.skipped_at,
  );

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
      className="flex gap-4 rounded-xl border border-border bg-card p-3"
      data-pending={pending || undefined}
    >
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

        <div className="flex flex-wrap items-center gap-2">
          <WatchedToggle itemId={item.id} watched={item.status === "watched"} />
          {members && item.group_id && (
            <WatchedTogetherDialog
              itemId={item.id}
              title={media.title}
              members={members}
              viewers={card.viewers}
              ratings={card.ratings}
              currentUserId={currentUserId}
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
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            <MessageSquare className="size-4" />
            {hasMyNote ? "Your note" : "Rate / note"}
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
                  .map((v) => memberById.get(v.user_id)?.display_name ?? "someone")
                  .join(", ")}
              </span>
            )}
          </div>
        )}

        {open && (
          <div className="mt-1 rounded-lg border border-border bg-background/40 p-3">
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
    </div>
  );
}
