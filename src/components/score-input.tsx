"use client";

import { Minus, Plus, Star, X } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const MIN = 1;
const MAX = 10;
const TICKS = Array.from({ length: 10 }, (_, i) => i + 1);

function clampScore(n: number): number {
  return Math.min(MAX, Math.max(MIN, Math.round(n * 10) / 10));
}

/** Score from 1.0 to 10.0 in steps of 0.1: slider, ±0.1 buttons, an editable number and whole-number shortcuts. */
export function ScoreInput({
  value,
  onChange,
  label = "Score",
  compact = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label?: string;
  compact?: boolean;
}) {
  // What the user is typing; null when the box isn't being edited.
  const [draft, setDraft] = useState<string | null>(null);
  const empty = value === null;
  const position = value ?? 5.5;
  const shown = draft ?? (empty ? "" : value.toFixed(1));

  function commitDraft() {
    if (draft === null) return;
    const text = draft.trim().replace(",", ".");
    setDraft(null);
    if (text === "") onChange(null);
    else if (Number.isFinite(Number(text))) onChange(clampScore(Number(text)));
  }

  function nudge(delta: number) {
    if (value !== null) onChange(clampScore(value + delta));
  }

  const number = (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      placeholder="–"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commitDraft}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      aria-label={`${label}, 1 to 10`}
      className={cn(
        "rounded-md bg-transparent px-1 font-semibold tabular-nums outline-none transition-colors placeholder:text-muted-foreground hover:bg-muted focus:bg-muted",
        compact
          ? "h-8 w-12 text-center text-base"
          : "h-10 w-[4.5rem] text-3xl [field-sizing:content] supports-[field-sizing:content]:w-auto",
      )}
    />
  );

  const slider = (
    <div className="flex flex-1 items-center gap-2">
      <NudgeButton
        onClick={() => nudge(-0.1)}
        disabled={empty || value <= MIN}
        label="0.1 lower"
      >
        <Minus className="size-3.5" />
      </NudgeButton>
      <input
        type="range"
        min={MIN}
        max={MAX}
        step={0.1}
        value={position}
        onChange={(e) => onChange(clampScore(e.currentTarget.valueAsNumber))}
        // A tap right on the resting thumb doesn't fire onChange.
        onClick={(e) => {
          if (empty) onChange(clampScore(e.currentTarget.valueAsNumber));
        }}
        aria-label={label}
        aria-valuetext={empty ? "No score" : `${value.toFixed(1)} out of 10`}
        data-empty={empty ? "" : undefined}
        style={{ "--fill": (position - MIN) / (MAX - MIN) } as CSSProperties}
        className="score-slider min-w-0 flex-1"
      />
      <NudgeButton
        onClick={() => nudge(0.1)}
        disabled={empty || value >= MAX}
        label="0.1 higher"
      >
        <Plus className="size-3.5" />
      </NudgeButton>
    </div>
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {slider}
        {number}
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="No score"
          className={cn(
            "rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            empty && "invisible",
          )}
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Star
          className={cn(
            "size-6 transition-colors",
            empty ? "text-muted-foreground" : "fill-star text-star",
          )}
        />
        {number}
        <span className="text-sm text-muted-foreground">
          {empty ? "Slide or type a score" : "/ 10"}
        </span>
        {!empty && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      {slider}
      {/* Whole-number shortcuts, lined up under the slider (between the ± buttons). */}
      <div className="relative mx-9 h-5 pointer-coarse:mx-11 pointer-coarse:h-8">
        {TICKS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} out of 10`}
            style={{
              left: `calc(var(--score-thumb) / 2 + (100% - var(--score-thumb)) * ${(n - 1) / 9})`,
            }}
            className={cn(
              "absolute inline-flex h-5 min-w-5 -translate-x-1/2 items-center justify-center rounded text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-foreground pointer-coarse:h-8 pointer-coarse:text-xs",
              value !== null &&
                Math.floor(value) === n &&
                "font-semibold text-star",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function NudgeButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-9"
    >
      {children}
    </button>
  );
}
