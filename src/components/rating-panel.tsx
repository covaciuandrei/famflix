"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { setRating } from "@/app/app/actions";
import { Avatar } from "@/components/avatar";
import { GuestScoreEntry } from "@/components/guest/guest-score";
import { ScoreInput, SCORE_REACTION_HINT } from "@/components/score-input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatScore } from "@/lib/format";
import type { MemberSummary, RatingWithProfile } from "@/lib/types";

export function RatingPanel({
  itemId,
  myScore,
  myComment,
  ratings,
  currentUserId,
  members,
  groupId,
}: {
  itemId: string;
  myScore: number | null;
  myComment: string | null;
  ratings: RatingWithProfile[];
  currentUserId: string;
  members?: MemberSummary[];
  groupId?: string;
}) {
  const [score, setScore] = useState<number | null>(myScore);
  const [comment, setComment] = useState(myComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const nameOf = (userId: string) =>
    members?.find((m) => m.id === userId)?.display_name ?? null;
  const mine = ratings.find((r) => r.user_id === currentUserId);
  const filledInBy =
    mine?.rated_by && mine.rated_by !== currentUserId ? mine.rated_by : null;

  const others = ratings.filter(
    (r) =>
      r.user_id !== currentUserId &&
      (r.score !== null || (r.comment && r.comment.trim())),
  );

  function save() {
    setError(null);
    start(async () => {
      const res = await setRating(itemId, score, comment);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {filledInBy && (
        <p className="text-xs text-muted-foreground">
          {nameOf(filledInBy) ?? "A family member"} filled in your score. Change
          it if it&apos;s wrong.
        </p>
      )}
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Your score
        </p>
        <ScoreInput value={score} onChange={setScore} label="Your score" />
        <p className="mt-1 text-xs text-muted-foreground">{SCORE_REACTION_HINT}</p>
      </div>

      <Textarea
        maxLength={250}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a note (optional)"
        rows={2}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>

      {others.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Family notes
          </p>
          {others.map((r) => (
            <div key={r.id} className="flex gap-2 text-sm">
              <Avatar
                name={r.profiles?.display_name}
                url={r.profiles?.avatar_url}
                className="size-6"
              />
              <div className="min-w-0">
                <span className="font-medium">
                  {r.profiles?.display_name ?? "Someone"}
                </span>
                {r.score !== null && (
                  <span className="ml-1.5 text-star">
                    ★ {formatScore(r.score)}/10
                  </span>
                )}
                {groupId && <GuestScoreEntry groupId={groupId} itemId={itemId} />}
                {r.rated_by && r.rated_by !== r.user_id && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    (filled in by {nameOf(r.rated_by) ?? "a family member"})
                  </span>
                )}
                {r.comment && (
                  <p className="text-muted-foreground">{r.comment}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
