import { ChevronRight, EyeOff } from "lucide-react";
import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";

export interface FamilyPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  owner: boolean;
}

/**
 * The people of a family, each with a way to their My list: a link when they share it, a note when they have switched
 * that off, and for yourself a link to your own list. `sharing` says who has it switched off (anyone it doesn't
 * mention shares).
 */
export function MemberLists({
  groupId,
  people,
  meId,
  sharing,
}: {
  groupId: string;
  people: FamilyPerson[];
  meId: string;
  sharing: ReadonlyMap<string, boolean>;
}) {
  const row = "flex items-center gap-3 px-4 py-3";
  return (
    <section aria-label="Members" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        The people in a family can see each other&apos;s My list: the titles, whether they watched them, when, and their
        score. Never notes. Anyone can switch that off in Settings.
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {people.map((person) => {
          const mine = person.id === meId;
          const shared = sharing.get(person.id) !== false;
          const who = (
            <>
              <Avatar name={person.name} url={person.avatarUrl} className="size-9" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-medium">{person.name}</span>
                  {mine && <Badge>You</Badge>}
                  {person.owner && <Badge>Owner</Badge>}
                </span>
              </span>
            </>
          );
          return (
            <li key={person.id}>
              {mine || shared ? (
                <Link
                  href={mine ? "/app/mine" : `/app/family/${groupId}/members/${person.id}`}
                  aria-label={mine ? "My list" : `${person.name}'s list`}
                  className={`${row} transition-colors hover:bg-muted/50`}
                >
                  {who}
                  <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                    {mine ? "My list" : "See list"}
                    <ChevronRight className="size-4" aria-hidden />
                  </span>
                </Link>
              ) : (
                <div className={row}>
                  {who}
                  <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                    <EyeOff className="size-4" aria-hidden />
                    Not sharing their list
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
