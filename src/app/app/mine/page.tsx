import { redirect } from "next/navigation";

import { RemovedItems } from "@/components/removed-items";
import { Watchlist } from "@/components/watchlist";
import { getListCards, getRemovedItems, getSessionProfile } from "@/lib/data";

export default async function MinePage() {
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const [cards, removed] = await Promise.all([
    getListCards({ groupId: null, userId: user.id }),
    getRemovedItems({ groupId: null, userId: user.id, memberNames: {} }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">My list</h1>
        <p className="text-muted-foreground">
          Your personal watchlist — only you can see this.
        </p>
      </div>
      <Watchlist cards={cards} currentUserId={user.id} />
      <RemovedItems items={removed} />
    </div>
  );
}
