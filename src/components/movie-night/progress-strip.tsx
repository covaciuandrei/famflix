import { Check } from "lucide-react";

import { Avatar } from "@/components/avatar";
import type { MemberProgress, StackInfo } from "@/lib/movie-night";
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

/** Who is in the night and how far along they are. */
export function ProgressStrip({
  members,
  stacks,
  meId,
}: {
  members: MemberProgress[];
  stacks: StackInfo[];
  meId: string;
}) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Who is taking part">
      {members.map((member) => {
        const status = statusOf(member, stacks);
        return (
          <li
            key={member.user_id}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-sm",
              !member.joined && "opacity-60",
            )}
          >
            <Avatar name={member.name} url={member.avatar_url} className="size-6" />
            <span className="max-w-28 truncate font-medium">
              {member.user_id === meId ? "You" : member.name}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {status.done && <Check className="size-3.5 text-like" aria-hidden />}
              {status.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Who watched the title a night ended with. */
export function WatchedBy({ members, meId }: { members: MemberProgress[]; meId: string }) {
  const people = members.filter((m) => m.watched);
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
        </li>
      ))}
    </ul>
  );
}
