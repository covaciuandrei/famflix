"use client";

import { Check, Loader2, Users } from "lucide-react";
import { useState, useTransition } from "react";

import { logWatchTogether } from "@/app/app/actions";
import { currentViewing } from "@/app/app/movie-night/attendance-actions";
import { EditNightDialog } from "@/components/movie-night/edit-night-dialog";
import { Button } from "@/components/ui/button";
import { WatchedTogetherModal } from "@/components/watched-together-modal";
import type { MemberSummary, RatingWithProfile, ViewingDetails, Watch } from "@/lib/types";

/** "Watched together": pick which family members watched it, and optionally fill in their scores. */
export function WatchedTogetherDialog({
  itemId,
  groupId,
  title,
  members,
  viewers,
  ratings,
  currentUserId,
  done,
}: {
  itemId: string;
  groupId: string;
  title: string;
  members: MemberSummary[];
  viewers: Watch[];
  ratings: RatingWithProfile[];
  currentUserId: string;
  /** Already logged as watched together: the button shows a tick, like Watched. */
  done: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<ViewingDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function show() {
    setError(null);
    if (!done) { setOpen(true); return; }
    start(async () => {
      const res = await currentViewing(itemId);
      if (res.error || !res.info) setError(res.error ?? "Couldn't open this viewing.");
      else setInfo(res.info);
    });
  }

  return (
    <>
      <Button variant={done ? "secondary" : "outline"} size="sm" onClick={show} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : done ? <Check className="size-4 text-like" /> : <Users className="size-4" />}
        Watched together
      </Button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {info && <EditNightDialog title={title} groupName="the family" info={info} meId={currentUserId}
        onSaved={() => {}} onFailed={() => {}} onClose={() => setInfo(null)} />}

      {open && (
        <WatchedTogetherModal
          title={title}
          groupId={groupId}
          members={members}
          initialChecked={[currentUserId, ...viewers.map((v) => v.user_id)]}
          ratings={ratings}
          currentUserId={currentUserId}
          onSubmit={(input) => logWatchTogether({ itemId, ...input })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
