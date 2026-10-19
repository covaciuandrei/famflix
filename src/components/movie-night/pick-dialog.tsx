"use client";

import type { ActionResult } from "@/app/app/movie-night/actions";
import { WatchedTogetherModal, type WatchedTogetherInput } from "@/components/watched-together-modal";
import type { MemberProgress } from "@/lib/movie-night";

/**
 * "We watched this": the Watched together window for the title a night ended with, a card from the leaderboard or any
 * other title that was searched for. The people who took part start ticked. Nothing changes until Save, which puts the
 * title on the family list if it isn't there, logs the watch and ends the night (the best titles join the list too).
 */
export function PickDialog({
  groupName,
  groupId,
  title,
  members,
  meId,
  pick,
  onPicked,
  onFailed,
  onClose,
}: {
  groupName: string;
  groupId: string;
  title: string;
  members: MemberProgress[];
  meId: string;
  /** Saves the pick with what the window collected: for a card of the night, or for any other title. */
  pick: (input: WatchedTogetherInput) => Promise<ActionResult>;
  /** It worked. */
  onPicked: () => void;
  /** It didn't, e.g. someone else picked first: the room should look at the night again. */
  onFailed: () => void;
  onClose: () => void;
}) {
  const family = members.filter((m) => !m.guest);
  return (
    <WatchedTogetherModal
      title={title}
      groupId={groupId}
      intro={
        <>
          Saving adds {title} to {groupName}&apos;s list if it isn&apos;t there yet, marks it watched together and ends
          this movie night.
        </>
      }
      members={family.map((m) => ({ id: m.user_id, display_name: m.name, avatar_url: m.avatar_url }))}
      initialChecked={[meId, ...family.filter((m) => m.joined).map((m) => m.user_id)]}
      initialGuestIds={members.filter((m) => m.guest && m.joined && m.profile_id).map((m) => m.profile_id!)}
      ratings={[]}
      currentUserId={meId}
      onSubmit={async (input) => {
        const res = await pick(input);
        if (res.error) onFailed();
        else onPicked();
        return res;
      }}
      onClose={onClose}
    />
  );
}
