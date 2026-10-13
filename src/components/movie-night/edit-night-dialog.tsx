"use client";

import { editNight, type NightEditInfo } from "@/app/app/movie-night/actions";
import { WatchedTogetherModal } from "@/components/watched-together-modal";
import { ownRaters } from "@/lib/movie-night";

/**
 * "Who watched?" for a night that is over, to put right someone who was left out (or ticked by mistake) and the day.
 * It starts from the night as it is now (`info`, read when it was opened) and hands that back with the changes, so the
 * database can refuse if someone else changed the night in the meantime. People who rated the title themselves can't be
 * unticked here: only they can take themselves off it. Show it only while it is wanted (and drop it from `onClose`).
 */
export function EditNightDialog({
  nightId,
  title,
  groupName,
  info,
  meId,
  onSaved,
  onFailed,
  onClose,
}: {
  nightId: string;
  title: string;
  groupName: string;
  info: NightEditInfo;
  meId: string;
  /** It worked. */
  onSaved: () => void;
  /** It didn't, e.g. someone else changed the night first: the room should look at it again. */
  onFailed: () => void;
  onClose: () => void;
}) {
  const rated = ownRaters(info.ratings);
  const locked = Object.fromEntries(
    info.viewerIds
      .filter((id) => rated.has(id))
      .map((id) => [id, "Rated it or left a note, so only they can take themselves off it."]),
  );
  return (
    <WatchedTogetherModal
      title={title}
      intro={
        <>
          This changes who watched {title} and when for {groupName}. Anyone you take off it loses it from their My list.
        </>
      }
      submitLabel="Save changes"
      members={info.members}
      initialChecked={info.viewerIds}
      initialDate={info.watchedOn}
      locked={locked}
      noScoreFor={info.viewerIds}
      ratings={info.ratings}
      currentUserId={meId}
      onSubmit={async (input) => {
        const res = await editNight({
          nightId,
          ...input,
          expectedOn: info.watchedOn,
          expectedViewers: info.viewerIds,
        });
        if (res.error) onFailed();
        else onSaved();
        return res;
      }}
      onClose={onClose}
    />
  );
}
