"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import {
  cancelNight,
  finishStack,
  joinNight,
  revealNight,
} from "@/app/app/movie-night/actions";
import { Leaderboard } from "@/components/movie-night/leaderboard";
import { NightHeader } from "@/components/movie-night/night-header";
import { ProgressStrip } from "@/components/movie-night/progress-strip";
import { SwipeDeck } from "@/components/movie-night/swipe-deck";
import { useNightState } from "@/components/movie-night/use-night-state";
import { useVoteQueue } from "@/components/movie-night/use-vote-queue";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import {
  candidateToCard,
  deckOrder,
  LOVES_PER_STACK,
  type MemberProgress,
  type NightState,
} from "@/lib/movie-night";

/** How often a room checks in with the server while it is open. */
const POLL_MS = 6000;

// The swipe stack's height, a little shorter than a solo stack's: the room has a title above it.
const ROOM_STACK_HEIGHT =
  "h-[clamp(20rem,calc(100dvh-23rem),36rem)] sm:h-[clamp(22rem,calc(100dvh-20.5rem),36rem)]";

/** Done with every stack that is still open for voting. */
function isDone(member: MemberProgress, state: NightState): boolean {
  if (!member.joined) return false;
  return state.stacks
    .filter((s) => !s.revealed)
    .every((s) => member.stacks.find((m) => m.stack_id === s.id)?.finished);
}

/** One night, for one person: swipe a stack, then see how the family is voting. */
export function Room({ initial }: { initial: NightState }) {
  const router = useRouter();
  const { state, refresh, gone } = useNightState(initial, POLL_MS);
  const { night, stacks, members, me } = state;
  const isOpen = night.status === "open";

  // Which stack I'm swiping (null: looking at the leaderboard). Starts on the first one I haven't finished.
  const [swipingId, setSwipingId] = useState<string | null>(
    () => initial.stacks.find((s) => !s.my_finished && !s.revealed)?.id ?? null,
  );
  const [finishing, setFinishing] = useState(false);
  const finishingNow = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  const swipingStack = isOpen
    ? (stacks.find((s) => s.id === swipingId && !s.my_finished && !s.revealed) ?? null)
    : null;
  const { votes, setVote, flush, problem } = useVoteQueue(swipingStack?.id ?? null, initial.my_votes);

  // Taking part: someone who opens the night is on its list, even before the first swipe.
  const join = useEffectEvent(() => {
    if (isOpen && !members.find((m) => m.user_id === me)?.joined) void joinNight(night.id);
  });
  useEffect(() => {
    join();
  }, []);

  const cards = useMemo(() => {
    if (!swipingStack) return [];
    const ofStack = state.candidates
      .filter((c) => c.stack_id === swipingStack.id)
      .sort((a, b) => a.position - b.position);
    return deckOrder(me, swipingStack.id, ofStack).map(candidateToCard);
  }, [state.candidates, swipingStack, me]);
  // Picks up where someone left off: the first card in their own order they haven't voted on.
  const startAt = useMemo(() => {
    const first = cards.findIndex((card) => !(card.id in initial.my_votes));
    return first === -1 ? cards.length : first;
    // Only the first load matters (the stack remounts with its own key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swipingStack?.id]);
  const lovesUsed = cards.filter((card) => votes[card.id] === "love").length;

  async function finish() {
    if (finishingNow.current || !swipingStack) return;
    finishingNow.current = true;
    setFinishing(true);
    setMessage(null);
    const stackId = swipingStack.id;
    const stop = () => {
      finishingNow.current = false;
      setFinishing(false);
    };
    if (!(await flush())) return stop(); // the problem is shown; the button tries again
    const res = await finishStack(stackId);
    if (res.error) {
      setMessage(res.error);
      return stop();
    }
    // The leaderboard opens with the results already in it.
    if (!(await refresh(true))) {
      setMessage("Your votes are saved, but the leaderboard didn't load. Check your connection and try again.");
      return stop();
    }
    setSwipingId(null);
    stop();
  }

  async function reveal() {
    const waiting = members.filter((m) => !isDone(m, state)).map((m) => (m.user_id === me ? "You" : m.name));
    const who = waiting.length > 0 ? ` ${waiting.join(", ")} haven't finished, and the cards they haven't swiped count as no vote.` : "";
    if (!window.confirm(`Show the results now?${who}`)) return;
    setMessage(null);
    await flush();
    const res = await revealNight(night.id);
    if (res.error) setMessage(res.error);
    else await refresh(true);
  }

  async function cancel() {
    if (!window.confirm("Cancel this movie night for everyone? Its votes stay in the history.")) return;
    setMessage(null);
    await flush();
    const res = await cancelNight(night.id);
    if (res.error) {
      setMessage(res.error);
      return;
    }
    await refresh(true);
    router.refresh();
  }

  if (gone) {
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <TriangleAlert className="size-10 text-destructive" />
        <div>
          <h1 className="text-xl font-semibold">This movie night isn&apos;t available</h1>
          <p className="mt-1 text-sm text-muted-foreground">It may be gone, or you may have left the family.</p>
        </div>
        <Link href="/app/movie-night" className={buttonVariants()}>
          Back to Movie night
        </Link>
      </div>
    );
  }

  // A stack someone added that I haven't swiped.
  const waiting = isOpen ? stacks.find((s) => !s.my_finished && !s.revealed && s.id !== swipingStack?.id) : undefined;
  const resultsShownOnMe = isOpen && swipingId !== null && !swipingStack;

  const ended =
    night.status === "closed" ? (
      <p>
        <strong>{night.ended_by_name ?? "Someone"}</strong> picked <strong>{night.picked_title ?? "a title"}</strong> on{" "}
        {formatDay(night.happened_on)}.
      </p>
    ) : night.status === "cancelled" ? (
      <p>
        <strong>{night.ended_by_name ?? "Someone"}</strong> cancelled this movie night.
      </p>
    ) : night.status === "expired" ? (
      <p>This movie night ended after 12 hours with nobody voting.</p>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <NightHeader night={night} canAct={isOpen} onReveal={reveal} onCancel={cancel} />

      {ended && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          {ended}
          <Link href={`/app/movie-night?who=${night.group_id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
            Back to Movie night
          </Link>
        </div>
      )}
      {resultsShownOnMe && (
        <p role="status" className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
          The results were shown, so voting on this stack is over. The cards you didn&apos;t swipe count as no vote.
        </p>
      )}
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      {swipingStack ? (
        <div className="flex flex-col items-center">
          <SwipeDeck
            key={swipingStack.id}
            cards={cards}
            startAt={startAt}
            lovesLeft={Math.max(0, LOVES_PER_STACK - lovesUsed)}
            onVote={(card, vote) => setVote(card.id, vote)}
            onUndo={(card) => setVote(card.id, null)}
            onFinish={finish}
            onSkip={finish}
            finishText={finishing ? "Saving your votes…" : "That was the last one."}
            finishButton="See the leaderboard"
            heightClass={ROOM_STACK_HEIGHT}
          />
          {problem && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {problem} Your votes are kept, and we&apos;ll keep trying.
            </p>
          )}
          {finishing && <Loader2 className="mt-2 size-5 animate-spin text-muted-foreground" aria-label="Saving" />}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ProgressStrip members={members} stacks={stacks} meId={me} />
          {waiting && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/50 bg-primary/10 px-4 py-3 text-sm">
              <p>
                <strong>{waiting.created_by_name ?? "Someone"}</strong> added {waiting.total} more suggestions.
              </p>
              <Button size="sm" onClick={() => setSwipingId(waiting.id)}>
                Swipe them
              </Button>
            </div>
          )}
          <section aria-labelledby="board-title" className="flex flex-col gap-3">
            <h2 id="board-title" className="text-lg font-semibold">
              Leaderboard
            </h2>
            {state.results.length > 0 ? (
              <Leaderboard state={state} />
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {stacks.some((s) => s.can_see_results)
                  ? "Nobody has voted yet."
                  : "Finish swiping to see how the family is voting."}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
