import { notFound, redirect } from "next/navigation";

import { Room } from "@/components/movie-night/room";
import { getMovieNightState, getSessionProfile } from "@/lib/data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A family's movie night: swipe a stack, then see how everyone voted. Not found for anyone outside the family. */
export default async function NightPage({ params }: { params: Promise<{ nightId: string }> }) {
  const { nightId } = await params;
  if (!UUID.test(nightId)) notFound();
  const { user } = await getSessionProfile();
  if (!user) redirect("/login");

  const state = await getMovieNightState(nightId, true);
  if (!state) notFound();
  return <Room initial={state} />;
}
