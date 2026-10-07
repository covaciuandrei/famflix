import { ArrowLeft, Crown } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Avatar } from "@/components/avatar";
import {
  LeaveFamilyButton,
  NewCodeButton,
  RemoveMemberButton,
  RenameForm,
} from "@/components/family-settings";
import { InviteCode } from "@/components/invite-code";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getGroupWithMembers, getSessionProfile } from "@/lib/data";

export default async function FamilySettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const data = await getGroupWithMembers(groupId);
  if (!data) notFound();
  const { group, members } = data;

  const isOwner = members.some(
    (m) => m.user_id === user.id && m.role === "owner",
  );
  const others = members.filter((m) => m.user_id !== user.id);
  const nextOwner = others[0]?.profiles?.display_name ?? "the next member";
  const leaveWarning =
    others.length === 0
      ? "You're the only member, so leaving deletes this family and its list for good."
      : isOwner
        ? `${nextOwner} will become the owner. You can rejoin later with an invite code.`
        : "You can rejoin later with an invite code.";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Link
        href={`/app/family/${group.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to {group.name}
      </Link>
      <h1 className="text-2xl font-bold">Family settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Name</CardTitle>
        </CardHeader>
        <CardContent>
          {isOwner ? (
            <RenameForm groupId={group.id} name={group.name} />
          ) : (
            <p className="text-sm">
              {group.name}{" "}
              <span className="text-muted-foreground">
                (only the owner can rename it)
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invite code</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <InviteCode code={group.invite_code} />
          {isOwner && <NewCodeButton groupId={group.id} />}
          <p className="w-full text-sm text-muted-foreground">
            Share this code with family members so they can join.
            {isOwner && " Make a new one if it got into the wrong hands."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {members.map((m) => {
              const name = m.profiles?.display_name ?? "Member";
              return (
                <li key={m.user_id} className="flex items-center gap-3">
                  <Avatar
                    name={name}
                    url={m.profiles?.avatar_url}
                    className="size-8"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {name}
                    {m.user_id === user.id && (
                      <span className="text-muted-foreground"> (you)</span>
                    )}
                  </span>
                  {m.role === "owner" && (
                    <span className="inline-flex items-center gap-1 text-xs text-star">
                      <Crown className="size-3.5" />
                      Owner
                    </span>
                  )}
                  {isOwner && m.user_id !== user.id && (
                    <RemoveMemberButton
                      groupId={group.id}
                      userId={m.user_id}
                      name={name}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leave this family</CardTitle>
        </CardHeader>
        <CardContent>
          <LeaveFamilyButton groupId={group.id} warning={leaveWarning} />
        </CardContent>
      </Card>
    </div>
  );
}
