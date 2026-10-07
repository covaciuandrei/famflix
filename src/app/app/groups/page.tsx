import { Users } from "lucide-react";
import Link from "next/link";

import { GroupForms } from "@/components/group-forms";
import { InviteCode } from "@/components/invite-code";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMyGroups } from "@/lib/data";

export default async function GroupsPage() {
  const groups = await getMyGroups();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Families</h1>
        <p className="text-muted-foreground">
          Shared watchlists you can create or join.
        </p>
      </div>

      <GroupForms />

      {groups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Your families</h2>
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <Card key={g.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Users className="size-5" />
                    </span>
                    <div>
                      <p className="font-semibold">{g.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
                      Invite:
                      <InviteCode code={g.invite_code} />
                    </div>
                    <Link
                      href={`/app/family/${g.id}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Open
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
