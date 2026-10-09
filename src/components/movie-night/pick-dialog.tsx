"use client";

import { pickCard } from "@/app/app/movie-night/actions";
import { WatchedTogetherModal } from "@/components/watched-together-modal";
import type { MemberProgress, NightCandidate } from "@/lib/movie-night";

/**
 * "We watched this" on the leaderboard: the Watched together window for one title of the night. The people who took
 * part start ticked. Nothing changes until Save, which puts the title on the family list if it isn't there, logs the
 * watch and ends the night (the best titles join the list too).
 */
export function PickDialog({
  nightId,
  groupName,
  card,
  members,
  meId,
  onPicked,
  onFailed,
  onClose,
}: {
  nightId: string;
  groupName: string;
  card: NightCandidate;
  members: MemberProgress[];
  meId: string;
  /** It worked. */
  onPicked: () => void;
  /** It didn't, e.g. someone else picked first: the room should look at the night again. */
  onFailed: () => void;
  onClose: () => void;
}) {
  return (
    <WatchedTogetherModal
      title={card.title}
      intro={
        <>
          Saving adds {card.title} to {groupName}&apos;s list if it isn&apos;t there yet, marks it watched together and
          ends this movie night.
        </>
      }
      members={members.map((m) => ({ id: m.user_id, display_name: m.name, avatar_url: m.avatar_url }))}
      initialChecked={[meId, ...members.filter((m) => m.joined).map((m) => m.user_id)]}
      ratings={[]}
      currentUserId={meId}
      onSubmit={async (input) => {
        const res = await pickCard({ nightId, candidateId: card.id, ...input });
        if (res.error) onFailed();
        else onPicked();
        return res;
      }}
      onClose={onClose}
    />
  );
}
