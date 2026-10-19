"use client";

import { ChevronDown, Star, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Avatar } from "@/components/avatar";
import { GuestScoreRow } from "@/components/guest/guest-score";
import { Button } from "@/components/ui/button";
import { closeOnBackdrop, openModal } from "@/lib/dialog";
import { formatScore } from "@/lib/format";
import type { ListItemCard, MemberSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type FeedbackKind = "ratings" | "reactions";

type FeedbackProps = {
  card: ListItemCard;
  currentUserId: string;
  members?: MemberSummary[];
  kind: FeedbackKind;
};

export function FamilyFeedbackButton({
  card,
  currentUserId,
  members,
  kind,
  children,
  className,
}: FeedbackProps & { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const label =
    kind === "ratings"
      ? `View family ratings for ${card.media.title}: ${formatScore(card.avgScore)} out of 10 from ${card.ratingCount} ${card.ratingCount === 1 ? "rating" : "ratings"}`
      : `View family reactions for ${card.media.title}: ${card.likeCount} ${card.likeCount === 1 ? "like" : "likes"}, ${card.dislikeCount} ${card.dislikeCount === 1 ? "dislike" : "dislikes"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        className={cn(
          "inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {children}
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </button>
      {open && (
        <FamilyFeedbackDialog
          id={dialogId}
          card={card}
          currentUserId={currentUserId}
          members={members}
          kind={kind}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FeedbackPerson({
  person,
  userId,
  currentUserId,
  children,
}: {
  person: MemberSummary | null;
  userId: string;
  currentUserId: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden className="shrink-0">
        <Avatar name={person?.display_name} url={person?.avatar_url} />
      </span>
      <div className="min-w-0">
        <p className="break-words text-sm font-medium">
          {person?.display_name ?? "Family member"}
          {userId === currentUserId && (
            <span className="text-xs font-normal text-muted-foreground">
              {" (You)"}
            </span>
          )}
        </p>
        {children}
      </div>
    </div>
  );
}

function FamilyFeedbackDialog({
  id,
  card,
  currentUserId,
  members,
  kind,
  onClose,
}: FeedbackProps & { id: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  const people = new Map((members ?? []).map((m) => [m.id, m]));
  for (const entry of [...card.ratings, ...card.reactions]) {
    if (entry.profiles) people.set(entry.user_id, entry.profiles);
  }
  const nameOf = (userId: string) =>
    people.get(userId)?.display_name ?? "Family member";
  const byName = (a: { user_id: string }, b: { user_id: string }) =>
    nameOf(a.user_id).localeCompare(nameOf(b.user_id));
  const ratings = card.ratings.filter((r) => r.score !== null).sort(byName);

  useEffect(() => {
    openModal(ref.current);
  }, []);

  return (
    <dialog
      id={id}
      ref={ref}
      tabIndex={-1}
      {...closeOnBackdrop}
      onClose={onClose}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      className="m-auto max-h-[85dvh] w-[min(28rem,calc(100%-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-5 text-foreground shadow-xl outline-none backdrop:bg-black/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold">
            {kind === "ratings" ? "Family ratings" : "Family reactions"}
          </h2>
          <p id={descriptionId} className="mt-1 break-words text-sm text-muted-foreground">
            {card.media.title}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close"
          className="-mr-2 -mt-2 shrink-0"
          onClick={() => ref.current?.close()}
        >
          <X className="size-5" aria-hidden />
        </Button>
      </div>

      {kind === "ratings" ? (
        <div className="mt-4">
          {ratings.length + card.guestRatings.length > 0 ? (
            <>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Star className="size-4 fill-star text-star" aria-hidden />
                <span className="font-semibold text-foreground">
                  {formatScore(card.avgScore)}/10
                </span>
                average from {card.ratingCount} {card.ratingCount === 1 ? "rating" : "ratings"}
              </p>
              <ul className="mt-2 divide-y divide-border">
                {ratings.map((rating) => (
                  <li key={rating.id} className="flex items-center justify-between gap-3 py-3">
                    <FeedbackPerson
                      person={people.get(rating.user_id) ?? null}
                      userId={rating.user_id}
                      currentUserId={currentUserId}
                    >
                      {rating.rated_by && rating.rated_by !== rating.user_id && (
                        <p className="mt-0.5 break-words text-xs text-muted-foreground">
                          Filled in by {people.get(rating.rated_by)?.display_name ?? "a family member"}
                        </p>
                      )}
                    </FeedbackPerson>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-star">
                      {formatScore(rating.score)}/10
                    </span>
                  </li>
                ))}
                {card.guestRatings.map((rating) => <GuestScoreRow key={rating.id} rating={rating} itemId={card.item.id} />)}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No ratings yet.</p>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {(["like", "dislike"] as const).map((value) => {
            const reactions = card.reactions.filter((r) => r.value === value).sort(byName);
            const Icon = value === "like" ? ThumbsUp : ThumbsDown;
            return (
              <section key={value} aria-label={value === "like" ? "Liked" : "Disliked"}>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Icon
                    className={cn("size-4", value === "like" ? "text-like" : "text-dislike")}
                    aria-hidden
                  />
                  {value === "like" ? "Liked" : "Disliked"} ({reactions.length})
                </h3>
                {reactions.length > 0 ? (
                  <ul className="mt-1 divide-y divide-border">
                    {reactions.map((reaction) => (
                      <li key={reaction.id} className="py-3">
                        <FeedbackPerson
                          person={people.get(reaction.user_id) ?? null}
                          userId={reaction.user_id}
                          currentUserId={currentUserId}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {value === "like" ? "No likes yet." : "No dislikes yet."}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </dialog>
  );
}
