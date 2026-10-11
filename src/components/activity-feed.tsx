import type { ReactNode } from "react";

import { Avatar } from "@/components/avatar";
import { LocalTime } from "@/components/movie-night/local-time";
import { formatScore, timeAgo } from "@/lib/format";
import { findGenre } from "@/lib/genres";
import type { ActivityEvent } from "@/lib/types";

/** " for Sat, Oct 18" from the moment a plan was for (the feed's detail), in the viewer's own time zone; nothing when there is none. */
function plannedFor(detail: string | null): ReactNode {
  if (!detail || !/^\d{4}-\d{2}-\d{2}T/.test(detail)) return null;
  return (
    <>
      {" for "}
      <strong>
        <LocalTime iso={detail} kind="day" />
      </strong>
    </>
  );
}

function describe(e: ActivityEvent, currentUserId: string): ReactNode {
  const isMe = e.actor_id === currentUserId;
  const who = <strong>{isMe ? "You" : (e.actor_name ?? "Someone")}</strong>;
  const title = <strong>{e.media_title ?? "a title"}</strong>;
  const subject =
    e.subject_id === currentUserId ? "you" : (e.subject_name ?? "someone");

  switch (e.kind) {
    case "created":
      return <>{who} created the family</>;
    case "joined":
      return <>{who} joined the family</>;
    case "left":
      return <>{who} left the family</>;
    case "removed_member":
      return (
        <>
          {who} removed {subject} from the family
        </>
      );
    case "new_owner":
      return (
        <>
          <strong>{subject === "you" ? "You are" : `${subject} is`}</strong> now
          the family owner
        </>
      );
    case "renamed":
      return (
        <>
          {who} renamed the family to “{e.detail}”
        </>
      );
    case "new_code":
      return <>{who} made a new invite code</>;
    case "added":
      return (
        <>
          {who} added {title}
        </>
      );
    case "watched":
      return (
        <>
          {who} marked {title} as watched
        </>
      );
    case "watched_together":
      return (
        <>
          {who} logged {title}: watched together by {e.detail}
        </>
      );
    case "watch_again":
      return (
        <>
          {who} put {title} back on the list to watch again
        </>
      );
    case "rated": {
      const forWhom =
        e.subject_id && e.subject_id !== e.actor_id ? ` for ${subject}` : "";
      const note = e.detail ? <> — “{e.detail}”</> : null;
      return e.score === null ? (
        <>
          {who} left a note on {title}
          {forWhom}
          {note}
        </>
      ) : (
        <>
          {who} rated {title} {formatScore(e.score)}/10{forWhom}
          {note}
        </>
      );
    }
    case "removed":
      return (
        <>
          {who} removed {title}
        </>
      );
    case "restored":
      return (
        <>
          {who} restored {title}
        </>
      );
    case "movie_night_started": {
      // The detail is the mood's category slugs ("comedy, family"), if it had one.
      const mood = e.detail?.split(", ").map((slug) => findGenre(slug)?.label ?? slug).join(", ");
      return (
        <>
          {who} started a movie night{mood ? ` (${mood})` : ""}
        </>
      );
    }
    case "movie_night_cancelled":
      return <>{who} cancelled the movie night</>;
    case "movie_night_planned": {
      // The detail is the moment it is planned for; each person sees it in their own time zone.
      const when = plannedFor(e.detail);
      return (
        <>
          {who} planned a movie night{when}
        </>
      );
    }
    case "movie_night_plan_cancelled": {
      const when = plannedFor(e.detail);
      return (
        <>
          {who} cancelled the movie night planned{when ?? ""}
        </>
      );
    }
    case "movie_night_added": {
      const count = Number(e.detail);
      return (
        <>
          {who} added {count === 1 ? "1 title" : `${count} titles`} from the movie night
        </>
      );
    }
    default:
      return <>{who} made a change</>;
  }
}

/** Server-rendered family feed ("Ana added Dune", "Bogdan rated it 8/10"). */
export function ActivityFeed({
  events,
  currentUserId,
  showFamily = false,
}: {
  events: ActivityEvent[];
  currentUserId: string;
  showFamily?: boolean;
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing here yet. Add a title or log a movie night to get things going.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 py-2.5 text-sm">
          <Avatar name={e.actor_name} className="size-7" />
          <div className="min-w-0 flex-1">
            <p className="text-pretty">{describe(e, currentUserId)}</p>
            <p className="text-xs text-muted-foreground">
              {timeAgo(e.created_at)}
              {showFamily && e.groups ? ` · ${e.groups.name}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
