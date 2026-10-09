import { Check, Eye, Heart, Undo2, X } from "lucide-react";
import type { ReactNode } from "react";

import { LOVES_PER_STACK, type Vote } from "@/lib/movie-night";
import { cn } from "@/lib/utils";

const round =
  "relative flex items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

function Control({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      {children}
      <span className="text-[11px] text-muted-foreground">{caption}</span>
    </div>
  );
}

/**
 * The buttons that do what a swipe does (and more): ✕ nope, ♥ love, ✓ yes, plus undo and "seen it". The keyboard
 * does the same: ← nope, ↑ or L love, → yes, S seen it, Z undo.
 */
export function VoteButtons({
  onVote,
  onUndo,
  canUndo,
  lovesLeft,
  disabled,
}: {
  onVote: (vote: Vote) => void;
  onUndo: () => void;
  canUndo: boolean;
  lovesLeft: number;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-center gap-1 sm:gap-3">
      <Control caption="Undo">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo the last vote"
          title="Undo the last vote (Z)"
          className={cn(round, "mt-2 size-10 border border-border text-muted-foreground hover:bg-muted hover:text-foreground")}
        >
          <Undo2 className="size-5" />
        </button>
      </Control>
      <Control caption="Nope">
        <button
          type="button"
          onClick={() => onVote("nope")}
          disabled={disabled}
          aria-label="Nope"
          title="Nope (←)"
          className={cn(round, "size-14 border-2 border-dislike text-dislike hover:bg-dislike/10")}
        >
          <X className="size-7" strokeWidth={3} />
        </button>
      </Control>
      <Control caption={`Love · ${lovesLeft} left`}>
        <button
          type="button"
          onClick={() => onVote("love")}
          disabled={disabled || lovesLeft <= 0}
          aria-label={`Love it, ${lovesLeft} of ${LOVES_PER_STACK} loves left`}
          title={lovesLeft > 0 ? "Love it (↑ or L)" : "You've used your loves in this stack"}
          className={cn(round, "size-16 bg-pink-500 text-white shadow-lg hover:bg-pink-500/90")}
        >
          <Heart className="size-8 fill-current" />
        </button>
      </Control>
      <Control caption="Yes">
        <button
          type="button"
          onClick={() => onVote("yes")}
          disabled={disabled}
          aria-label="Yes"
          title="Yes (→)"
          className={cn(round, "size-14 border-2 border-like text-like hover:bg-like/10")}
        >
          <Check className="size-7" strokeWidth={3} />
        </button>
      </Control>
      <Control caption="Seen it">
        <button
          type="button"
          onClick={() => onVote("seen")}
          disabled={disabled}
          aria-label="Seen it, but I'd watch it again"
          title="Seen it, but I'd watch it again (S)"
          className={cn(round, "mt-2 size-10 border border-border text-muted-foreground hover:bg-muted hover:text-foreground")}
        >
          <Eye className="size-5" />
        </button>
      </Control>
    </div>
  );
}
