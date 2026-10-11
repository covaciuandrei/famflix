import { Check, X } from "lucide-react";

import { Avatar } from "@/components/avatar";
import { whoWatched, type MemberProgress, type StackInfo } from "@/lib/movie-night";
import { cn } from "@/lib/utils";

/** What to say about one person: how far they are with the stacks that are still open for voting. Never what they voted. */
function statusOf(member: MemberProgress, stacks: StackInfo[]): { text: string; done: boolean } {
  if (!member.joined) return { text: "hasn't joined", done: false };
  const open = stacks.filter((s) => !s.revealed);
  if (open.length === 0) return { text: "results shown", done: true };
  const todo = open
    .map((s) => ({ stack: s, mine: member.stacks.find((m) => m.stack_id === s.id) }))
    .filter((x) => !x.mine?.finished);
  if (todo.length === 0) return { text: "done", done: true };
  const first = todo[0];
  const label = `${first.mine?.voted ?? 0}/${first.stack.total}`;
  return { text: stacks.length > 1 ? `stack ${first.stack.position}: ${label}` : label, done: false };
}

/**
 * Who is in the night and how far along they are: the family first, then the guests (marked Guest). With
 * `onRemoveGuest` a guest has a button to take them out of the night.
 */
export function ProgressStrip({
  members,
  stacks,
  meId,
  onRemoveGuest,
}: {
  members: MemberProgress[];
  stacks: StackInfo[];
  meId: string;
  onRemoveGuest?: (guest: MemberProgress) => void;
}) {
  const people = [...members].sort((a, b) => Number(a.guest) - Number(b.guest));
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Who is taking part">
      {people.map((member) => {
        const status = statusOf(member, stacks);
        return (
          <li
            key={member.user_id}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-sm",
              !member.joined && "opacity-60",
              member.guest && onRemoveGuest && "pr-1",
            )}
          >
            <Avatar name={member.name} url={member.avatar_url} className="size-6" />
            <span className="max-w-28 truncate font-medium">
              {member.user_id === meId ? "You" : member.name}
            </span>
            {member.guest && (
              <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4 text-muted-foreground">Guest</span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {status.done && <Check className="size-3.5 text-like" aria-hidden />}
              {status.text}
            </span>
            {member.guest && onRemoveGuest && (
              <button
                type="button"
                onClick={() => onRemoveGuest(member)}
                aria-label={`Take ${member.name} out of this movie night`}
                title="Take out of this movie night"
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Who watched the title a night ended with: the family members its picker ticked, and the night's guests, who can't be
 * ticked (they have no account) but were there, marked Guest.
 */
export function WatchedBy({ members, meId }: { members: MemberProgress[]; meId: string }) {
  const people = whoWatched(members);
  if (people.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Who watched it">
      <li className="text-sm text-muted-foreground">Watched by</li>
      {people.map((member) => (
        <li
          key={member.user_id}
          className="flex items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-sm"
        >
          <Avatar name={member.name} url={member.avatar_url} className="size-6" />
          <span className="max-w-28 truncate font-medium">{member.user_id === meId ? "You" : member.name}</span>
          {member.guest && (
            <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4 text-muted-foreground">Guest</span>
          )}
        </li>
      ))}
    </ul>
  );
}
