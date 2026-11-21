"use client";

import { CircleCheck, Loader2, Undo2 } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";

import { CardInfoSheet } from "@/components/movie-night/card-info-sheet";
import { SwipeCardFace } from "@/components/movie-night/swipe-card";
import { VoteButtons } from "@/components/movie-night/vote-buttons";
import { Button } from "@/components/ui/button";
import { tmdbImage } from "@/lib/images";
import type { DeckCard, Vote } from "@/lib/movie-night";
import { cn } from "@/lib/utils";

// How a drag turns into a vote. Named so they can be tuned on a real phone.
/** Past this share of the card's width, letting go is a vote... */
const SWIPE_FRACTION = 0.3;
const SWIPE_MIN_PX = 70;
/** ...or a quick flick (pixels per millisecond) that went at least this far. */
const SWIPE_VELOCITY = 0.45;
const SWIPE_FAST_MIN_PX = 30;
/** Less movement than this is a tap, which opens the card's details. */
const TAP_SLOP_PX = 8;

const EXIT_MS = 240;
/** After the last card the "done" note waits this long (so it can still be undone), then moves on. */
const FINISH_DELAY_MS = 4000;
const REST_TRANSITION = "transform 200ms ease-out";
const BEHIND_CARDS = 2;
// Each card behind is a little smaller and lower, so its edge peeks out under the one on top.
const BEHIND_TRANSFORMS = ["none", "scale(0.94) translateY(26px)", "scale(0.88) translateY(50px)"];
// The card is as wide as the screen allows (up to 24 rem) and as tall as fits between the app's header and bottom bar on
// a phone (and under the header on a computer): what is left of the screen after everything else on this page.
const STACK_HEIGHT = "h-[clamp(18rem,calc(100dvh-19.7rem-var(--ui-preview-height,0px)),38rem)] sm:h-[clamp(22rem,calc(100dvh-19.4rem-var(--ui-preview-height,0px)),38rem)]";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

interface DragState {
  id: number;
  startX: number;
  startY: number;
  startTime: number;
  dx: number;
  moved: boolean;
}

const VOTE_WORDS: Record<Vote, string> = {
  nope: "Nope",
  yes: "Yes",
  love: "Loved",
  seen: "Seen it",
};

/** Where a card flies when it is voted on. */
function exitStyle(vote: Vote): { transform: string; opacity: string } {
  switch (vote) {
    case "nope":
      return { transform: `translate3d(${-window.innerWidth}px, 0, 0) rotate(-22deg)`, opacity: "0" };
    case "yes":
      return { transform: `translate3d(${window.innerWidth}px, 0, 0) rotate(22deg)`, opacity: "0" };
    case "love":
      return { transform: `translate3d(0, ${-window.innerHeight}px, 0) scale(1.1)`, opacity: "0" };
    case "seen":
      return { transform: "scale(0.85)", opacity: "0" };
  }
}

/**
 * The swipe stack. Swipe a card right for yes and left for nope, or use the buttons and keys: ✓ yes, ✕ nope, ♥ love
 * (a button only), 👁 seen it, ↶ undo. It only reports what happens (`onVote`, `onUndo`, `onFinish`); the caller
 * keeps the votes, so the same stack works on its own and inside a family's movie night.
 */
export function SwipeDeck({
  cards,
  startAt = 0,
  lovesLeft,
  onVote,
  onUndo,
  onFinish,
  onSkip,
  note,
  finishText,
  finishButton,
  autoFinish = true,
  finishExtra,
  heightClass = STACK_HEIGHT,
  guest = false,
}: {
  /** In the order they should be shown. */
  cards: DeckCard[];
  /** The card to start on, when picking up where someone left off. */
  startAt?: number;
  /** Loves still available in this stack (the caller counts them, undo included), or null for no limit. */
  lovesLeft: number | null;
  onVote: (card: DeckCard, vote: Vote) => void;
  onUndo: (card: DeckCard) => void;
  /** A few seconds after the last card, or right away from the done note's button. */
  onFinish: () => void;
  /** Adds a "Skip the rest" link (family nights). */
  onSkip?: () => void;
  /** A short live note at the end of the counter row, such as how many were picked so far. */
  note?: string;
  finishText: string;
  finishButton: string;
  /**
   * Whether the done note moves on by itself a few seconds after the last card (it can be undone meanwhile). Without
   * it the note is a plain "all done", for when there is nothing left to save or wait for.
   */
  autoFinish?: boolean;
  /** More to offer on the done note, next to Undo and the finish button. */
  finishExtra?: ReactNode;
  /** The stack's height; the default leaves room for the app's header and bottom bar plus one line above the stack. */
  heightClass?: string;
  /** A guest of a night, who has no list and no app to open a title in. */
  guest?: boolean;
}) {
  const [index, setIndex] = useState(() => Math.min(Math.max(startAt, 0), cards.length));
  const [history, setHistory] = useState<number[]>([]);
  const [info, setInfo] = useState<DeckCard | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [restored, setRestored] = useState(false);
  const busy = useRef(false);
  const drag = useRef<DragState | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const reducedMotion = usePrefersReducedMotion();

  const current = cards[index] ?? null;
  const done = index >= cards.length;

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  // The next few posters load before they're needed.
  useEffect(() => {
    for (const card of cards.slice(index + BEHIND_CARDS + 1, index + BEHIND_CARDS + 3)) {
      const src = tmdbImage(card.posterPath, "w500");
      if (src) new window.Image().src = src;
    }
  }, [cards, index]);

  function later(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, ms));
  }

  function vote(kind: Vote) {
    if (busy.current || !current) return;
    if (kind === "love" && lovesLeft !== null && lovesLeft <= 0) return;
    busy.current = true;
    setRestored(false);
    onVote(current, kind);
    setHistory((h) => [...h, index]);
    setAnnouncement(`${VOTE_WORDS[kind]}: ${current.title}`);
    try {
      navigator.vibrate?.(8);
    } catch {}

    const el = topRef.current;
    const advance = () => {
      busy.current = false;
      setIndex((i) => i + 1);
    };
    if (!el) return advance();

    // Stamp the card, then send it on its way.
    el.style.setProperty("--dx", kind === "yes" ? "1" : kind === "nope" ? "-1" : "0");
    el.style.setProperty("--love", kind === "love" ? "1" : "0");
    el.style.setProperty("--seen", kind === "seen" ? "1" : "0");
    if (reducedMotion) {
      el.style.transition = "opacity 120ms linear";
      el.style.opacity = "0";
      later(120, advance);
      return;
    }
    const { transform, opacity } = exitStyle(kind);
    el.style.transition = `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`;
    el.style.transform = transform;
    el.style.opacity = opacity;
    later(EXIT_MS, advance);
  }

  function undo() {
    if (busy.current || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setRestored(true);
    setIndex(last);
    onUndo(cards[last]);
  }

  // --- Dragging -----------------------------------------------------------------------------------------------

  function settle(el: HTMLElement) {
    el.style.transition = REST_TRANSITION;
    el.style.transform = "none";
    el.style.setProperty("--dx", "0");
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (busy.current || !e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // The ⓘ button inside the card is just a button.
    if ((e.target as HTMLElement).closest("button, a")) return;
    const el = e.currentTarget;
    drag.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      dx: 0,
      moved: false,
    };
    el.setPointerCapture(e.pointerId);
    el.style.transition = "none";
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    d.dx = dx;
    if (!d.moved && Math.hypot(dx, dy) > TAP_SLOP_PX) d.moved = true;
    if (!d.moved) return;
    const el = e.currentTarget;
    const width = el.offsetWidth;
    el.style.transform = `translate3d(${dx}px, ${dy * 0.15}px, 0) rotate(${(dx / width) * 18}deg)`;
    el.style.setProperty("--dx", String(Math.max(-1, Math.min(1, dx / (width * 0.35)))));
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const el = e.currentTarget;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (!d.moved) {
      settle(el);
      if (current) setInfo(current);
      return;
    }
    const elapsed = Math.max(performance.now() - d.startTime, 1);
    const far = Math.abs(d.dx) > Math.max(SWIPE_MIN_PX, el.offsetWidth * SWIPE_FRACTION);
    const fast = Math.abs(d.dx / elapsed) > SWIPE_VELOCITY && Math.abs(d.dx) > SWIPE_FAST_MIN_PX;
    if (far || fast) vote(d.dx > 0 ? "yes" : "nope");
    else settle(el);
  }

  function onPointerCancel(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    settle(e.currentTarget);
  }

  // --- Keyboard -----------------------------------------------------------------------------------------------

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    // A popup is open (the card's details, or something else): leave the keys to it.
    if (document.querySelector("dialog[open]")) return;
    const key = e.key.toLowerCase();
    let handled = true;
    if (key === "arrowleft") vote("nope");
    else if (key === "arrowright") vote("yes");
    else if (key === "arrowup" || key === "l") vote("love");
    else if (key === "s") vote("seen");
    else if (key === "z" || key === "backspace") undo();
    else if (key === "i" && current) setInfo(current);
    else handled = false;
    if (handled) e.preventDefault();
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // --- After the last card ------------------------------------------------------------------------------------

  const finish = useEffectEvent(() => onFinish());
  useEffect(() => {
    if (!done || !autoFinish) return;
    const timer = window.setTimeout(() => finish(), FINISH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [done, autoFinish]);

  const shown = cards.slice(index, index + 1 + BEHIND_CARDS);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex w-full max-w-sm items-center gap-3 text-sm text-muted-foreground">
        <span className="shrink-0 tabular-nums">
          {Math.min(index + 1, cards.length)} / {cards.length}
        </span>
        <div
          role="progressbar"
          aria-label="Cards voted on"
          aria-valuemin={0}
          aria-valuemax={cards.length}
          aria-valuenow={index}
          className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${(index / Math.max(cards.length, 1)) * 100}%` }}
          />
        </div>
        {onSkip && !done && (
          <button type="button" onClick={onSkip} className="shrink-0 underline underline-offset-2 hover:text-foreground">
            Skip the rest
          </button>
        )}
        {note && (
          <span className="shrink-0" aria-live="polite">
            {note}
          </span>
        )}
      </div>

      {done ? (
        <div
          className={cn(
            "flex w-full max-w-sm flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card p-6 text-center",
            heightClass,
          )}
        >
          {autoFinish ? (
            <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
          ) : (
            <CircleCheck className="size-7 text-like" aria-hidden />
          )}
          <p className="text-lg font-semibold">{finishText}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={undo} disabled={history.length === 0}>
              <Undo2 className="size-4" />
              Undo
            </Button>
            <Button onClick={() => onFinish()}>{finishButton}</Button>
            {finishExtra}
          </div>
        </div>
      ) : (
        // The bottom margin leaves room for the cards behind to peek out below the top one.
        <div className={cn("relative mb-5 w-full max-w-sm", heightClass)}>
          {shown.map((card, pos) => {
            const top = pos === 0;
            const style: CSSProperties = {
              zIndex: 10 - pos,
              transform: BEHIND_TRANSFORMS[pos],
              transition: REST_TRANSITION,
              ...(top && { touchAction: "pan-y" }),
            };
            return (
              <div
                key={card.id}
                ref={top ? topRef : undefined}
                role={top ? "group" : undefined}
                aria-roledescription={top ? "card" : undefined}
                aria-label={top ? `${card.title}, ${index + 1} of ${cards.length}` : undefined}
                aria-hidden={top ? undefined : true}
                inert={top ? undefined : true}
                onPointerDown={top ? onPointerDown : undefined}
                onPointerMove={top ? onPointerMove : undefined}
                onPointerUp={top ? onPointerUp : undefined}
                onPointerCancel={top ? onPointerCancel : undefined}
                className={cn(
                  "swipe-card absolute inset-0 overflow-hidden rounded-2xl border border-border bg-card shadow-xl select-none",
                  top && "cursor-grab active:cursor-grabbing",
                  top && restored && "fade-in",
                )}
                style={style}
              >
                <SwipeCardFace
                  card={card}
                  priority={pos < 2}
                  onInfo={top ? () => setInfo(card) : undefined}
                  listLabel={guest ? "From the family's list" : undefined}
                />
              </div>
            );
          })}
        </div>
      )}

      <VoteButtons
        onVote={vote}
        onUndo={undo}
        canUndo={history.length > 0}
        lovesLeft={lovesLeft}
        disabled={done}
      />
      <p className="hidden text-xs text-muted-foreground sm:block">
        ← nope · ↑ love · → yes · S seen it · Z undo · I details
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <CardInfoSheet card={info} onClose={() => setInfo(null)} titlePage={!guest} />
    </div>
  );
}
