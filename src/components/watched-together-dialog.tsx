"use client";

import { Check, Users } from "lucide-react";
import { useState } from "react";

import { logWatchTogether } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { WatchedTogetherModal } from "@/components/watched-together-modal";
import type { MemberSummary, RatingWithProfile, Watch } from "@/lib/types";

/** "Watched together": pick which family members watched it, and optionally fill in their scores. */
export function WatchedTogetherDialog({
  itemId,
  title,
  members,
  viewers,
  ratings,
  currentUserId,
  done,
}: {
  itemId: string;
  title: string;
  members: MemberSummary[];
  viewers: Watch[];
  ratings: RatingWithProfile[];
  currentUserId: string;
  /** Already logged as watched together: the button shows a tick, like Watched. */
  done: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={done ? "secondary" : "outline"} size="sm" onClick={() => setOpen(true)}>
        {done ? <Check className="size-4 text-like" /> : <Users className="size-4" />}
        Watched together
      </Button>

      {open && (
        <WatchedTogetherModal
          title={title}
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
