"use client";

import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import {
  addNightTitle,
  addTopTitles,
  cancelNight,
  finishStack,
  joinNight,
  requestMoreStack,
  revealNight,
} from "@/app/app/movie-night/actions";
import { Leaderboard, type RowActions } from "@/components/movie-night/leaderboard";
import { NightHeader } from "@/components/movie-night/night-header";
import { PickDialog } from "@/components/movie-night/pick-dialog";
import { ProgressStrip } from "@/components/movie-night/progress-strip";
import { SharePick } from "@/components/movie-night/share-pick";
import { SwipeDeck } from "@/components/movie-night/swipe-deck";
import { useNightState } from "@/components/movie-night/use-night-state";
import { useVoteQueue } from "@/components/movie-night/use-vote-queue";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import {
  candidateToCard,
  deckOrder,
  LOVES_PER_STACK,
  MAX_STACKS,
  type MemberProgress,
  type NightState,
  TOP_TITLES,
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
  // What the room is doing for me besides swiping ("more", "more:<card>", "add:<card>:<list>", "top"): one at a time.
  const [busy, setBusy] = useState<string | null>(null);
  const busyNow = useRef(false);
  const [pickId, setPickId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const swipingStack = isOpen
    ? (stacks.find((s) => s.id === swipingId && !s.my_finished && !s.revealed) ?? null)
    : null;
  const { votes, setVote, flush, problem } = useVoteQueue(initial.my_votes);

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
    const first = cards.findIndex((card) => !(card.id in votes));
    return first === -1 ? cards.length : first;
    // Only when a stack opens (the deck remounts with its own key); not on every vote.
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

  /** Leaves the stack as it is (swiping it later picks up at the next card) to look at the leaderboard. */
  async function peekAtBoard() {
    await flush();
    setSwipingId(null);
  }

  /** Runs one of the room's actions on its own: nothing else starts while it is going. */
  async function work(key: string, run: () => Promise<void>) {
    if (busyNow.current) return;
    busyNow.current = true;
    setBusy(key);
    setMessage(null);
    setNotice(null);
    try {
      await run();
    } finally {
      busyNow.current = false;
      setBusy(null);
    }
  }

  /** Asks for another stack, in the night's mood or like one of its titles, and goes straight to swiping it. */
  function moreSuggestions(likeCandidateId?: string) {
    return work(likeCandidateId ? `more:${likeCandidateId}` : "more", async () => {
      const res = await requestMoreStack({ nightId: night.id, knownStacks: stacks.length, likeCandidateId });
      if (res.error) {
        setMessage(res.error);
      } else if (await refresh(true)) {
        if (res.stackId) setSwipingId(res.stackId);
      } else {
        setMessage("The new suggestions are ready but didn't load yet. They'll show up in a moment.");
      }
    });
  }

  /** Puts one of the night's titles on the family's list or on My list. */
  function addTitle(candidateId: string, target: "family" | "mine") {
    return work(`add:${candidateId}:${target}`, async () => {
      const res = await addNightTitle({ nightId: night.id, candidateId, target });
      const title = state.candidates.find((c) => c.id === candidateId)?.title ?? "That title";
      // Already there is what was asked for; the row's chip catches up below.
      if (res.error && !/already on this list/i.test(res.error)) setMessage(res.error);
      else setNotice(`${title} is on ${target === "family" ? `${night.group_name}'s list` : "My list"}.`);
      await refresh(true);
    });
  }

  /** For a night nobody picked from: the same best titles a pick would have added. */
  function addTop() {
    return work("top", async () => {
      const res = await addTopTitles(night.id);
      if (res.error) setMessage(res.error);
      else if (!res.added) setNotice(`The best titles are on ${night.group_name}'s list already.`);
      else setNotice(`Added ${res.added} ${res.added === 1 ? "title" : "titles"} to ${night.group_name}'s list.`);
      await refresh(true);
    });
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
  // Another stack can be asked for by anyone who sees the leaderboard, once they've swiped the ones already there.
  const canAddMore = isOpen && !waiting && stacks.length < MAX_STACKS && stacks.some((s) => s.can_see_results);
  const someoneStillSwiping = isOpen && members.some((m) => !isDone(m, state));
  const pickCandidate = isOpen && pickId ? state.candidates.find((c) => c.id === pickId) : undefined;
  const actions: RowActions = {
    familyName: night.group_name,
    onPick: isOpen ? setPickId : undefined,
    onAdd: addTitle,
    onMoreLike: canAddMore ? moreSuggestions : undefined,
    busy,
  };

  const ended =
    night.status === "closed" ? (
      <p>
        <strong>{night.ended_by_name ?? "Someone"}</strong> picked <strong>{night.picked_title ?? "a title"}</strong> on{" "}
        {formatDay(night.happened_on)}.
        {night.source === "swipe" && ` The best titles joined ${night.group_name}'s list.`}
      </p>
    ) : night.status === "cancelled" ? (
      <p>
        <strong>{night.ended_by_name ?? "Someone"}</strong> cancelled this movie night.
      </p>
    ) : night.status === "expired" ? (
      <p>This movie night ended after 12 hours with nobody voting.</p>
    ) : null;
  // Nobody picked, so nothing was added for the family: it can be done by hand.
  const canAddTop = (night.status === "cancelled" || night.status === "expired") && state.results.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <NightHeader
        night={night}
        canAct={isOpen}
        onBoard={swipingStack && stacks.some((s) => s.can_see_results) ? peekAtBoard : undefined}
        onReveal={reveal}
        onCancel={cancel}
      />

      {ended && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          {ended}
          <div className="flex flex-wrap items-center gap-2">
            {night.status === "closed" && night.picked_title && <SharePick title={night.picked_title} />}
            {canAddTop && (
              <Button size="sm" onClick={addTop} disabled={busy !== null}>
                {busy === "top" && <Loader2 className="size-3.5 animate-spin" />}
                Add the top {TOP_TITLES} to {night.group_name}&apos;s list
              </Button>
            )}
            <Link href={`/app/movie-night?who=${night.group_id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
              Back to Movie night
            </Link>
          </div>
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
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {swipingStack ? (
        <div className="flex flex-col items-center">
          <SwipeDeck
            key={swipingStack.id}
            cards={cards}
            startAt={startAt}
            lovesLeft={Math.max(0, LOVES_PER_STACK - lovesUsed)}
            onVote={(card, vote) => setVote(swipingStack.id, card.id, vote)}
            onUndo={(card) => setVote(swipingStack.id, card.id, null)}
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ProgressStrip members={members} stacks={stacks} meId={me} />
            {someoneStillSwiping && (
              <button
                type="button"
                onClick={reveal}
                className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Show results now
              </button>
            )}
          </div>
          {waiting && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/50 bg-primary/10 px-4 py-3 text-sm">
              <p>
                <strong>{waiting.created_by === me ? "You" : (waiting.created_by_name ?? "Someone")}</strong> added{" "}
                {waiting.total} more suggestions. Their results show up once you&apos;ve swiped them.
              </p>
              <Button size="sm" onClick={() => setSwipingId(waiting.id)}>
                Swipe them
              </Button>
            </div>
          )}
          <section aria-labelledby="board-title" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div>
                <h2 id="board-title" className="text-lg font-semibold">
                  Leaderboard
                </h2>
                {isOpen && (
                  <p className="text-xs text-muted-foreground">
                    When you pick one, the {TOP_TITLES} best titles join {night.group_name}&apos;s list.
                  </p>
                )}
              </div>
              {canAddMore && (
                <Button size="sm" variant="outline" onClick={() => moreSuggestions()} disabled={busy !== null}>
                  {busy === "more" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {busy === "more" ? "Finding titles…" : "More suggestions"}
                </Button>
              )}
            </div>
            {state.results.length > 0 ? (
              <Leaderboard state={state} actions={actions} />
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

      {pickCandidate && (
        <PickDialog
          nightId={night.id}
          groupName={night.group_name}
          card={pickCandidate}
          members={members}
          meId={me}
          onPicked={() => void refresh(true)}
          onFailed={() => void refresh(true)}
          onClose={() => setPickId(null)}
        />
      )}
    </div>
  );
}
