"use client";

import { ChevronDown, Eye, Heart, Info, Loader2, Plus, Sparkles, Star, ThumbsDown, ThumbsUp, Users } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { MediaPoster } from "@/components/media-poster";
import { CardInfoSheet } from "@/components/movie-night/card-info-sheet";
import { Button } from "@/components/ui/button";
import { formatScore } from "@/lib/format";
import {
  candidateToCard,
  groupVotes,
  type DeckCard,
  type NightCandidate,
  type NightState,
  type ResultRow,
  type Vote,
} from "@/lib/movie-night";
import { cn } from "@/lib/utils";

const VOTES: Record<Vote, { label: string; hint: string; Icon: typeof Heart; tone: string }> = {
  love: { label: "Love", hint: "Loved it", Icon: Heart, tone: "text-pink-500" },
  yes: { label: "Yes", hint: "Yes", Icon: ThumbsUp, tone: "text-like" },
  seen: { label: "Seen it", hint: "Seen it, and would watch it again", Icon: Eye, tone: "text-muted-foreground" },
  nope: { label: "Nope", hint: "Nope", Icon: ThumbsDown, tone: "text-dislike" },
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] leading-4 text-muted-foreground">
      {children}
    </span>
  );
}

function Stat({ vote, count }: { vote: Vote; count: number }) {
  const { hint, Icon, tone } = VOTES[vote];
  return (
    <span className="inline-flex items-center gap-0.5" title={hint}>
      <Icon className={cn("size-3.5", tone)} aria-hidden /> {count}
      <span className="sr-only"> {hint}</span>
    </span>
  );
}

/** What can be done with a title, and what is going on right now (`busy` names it; the other buttons wait). */
export interface RowActions {
  familyName: string;
  /** "We watched this": only while the night is open. */
  onPick?: (candidateId: string) => void;
  onAdd?: (candidateId: string, target: "family" | "mine") => void;
  onMoreLike?: (candidateId: string) => void;
  busy: string | null;
}

function Row({
  row,
  card,
  meId,
  open,
  onToggle,
  onDetails,
  actions,
}: {
  row: ResultRow;
  card: NightCandidate;
  meId: string;
  open: boolean;
  onToggle: () => void;
  onDetails: () => void;
  actions: RowActions;
}) {
  const { familyName, onPick, onAdd, onMoreLike, busy } = actions;
  const working = (key: string) => busy === key;
  const panelId = useId();
  const groups = groupVotes(row.votes, meId);
  return (
    <li className="rounded-xl border border-border bg-card">
      {/* The title button stretches over the whole header, so a tap anywhere on it opens the row. */}
      <div className="relative flex items-start gap-3 rounded-xl p-2.5 hover:bg-muted/40">
        <span className="mt-1 w-5 shrink-0 text-center text-sm font-semibold text-muted-foreground sm:w-7">
          {row.rank}
        </span>
        <MediaPoster path={card.poster_path} alt="" size="w92" sizes="48px" className="w-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggle}
              className="line-clamp-2 min-w-0 flex-1 text-left font-medium after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {card.title}
            </button>
            <span className="pointer-events-none shrink-0 rounded-full bg-primary/15 px-2.5 py-0.5 text-sm font-semibold text-primary">
              {row.points} {Math.abs(row.points) === 1 ? "pt" : "pts"}
            </span>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {card.year ? <span>{card.year}</span> : null}
            {card.rating ? (
              <span className="inline-flex items-center gap-0.5 text-star">
                <Star className="size-3 fill-current" aria-hidden />
                {formatScore(Math.round(card.rating * 10) / 10)}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <Stat vote="love" count={row.loves} />
            <Stat vote="yes" count={row.yes} />
            <Stat vote="seen" count={row.seen} />
            <Stat vote="nope" count={row.nopes} />
          </p>
          {(row.on_family_list || row.on_my_list) && (
            <p className="mt-1 flex flex-wrap gap-1.5">
              {row.on_family_list && <Chip>On family list</Chip>}
              {row.on_my_list && <Chip>On My list</Chip>}
            </p>
          )}
        </div>
        <ChevronDown
          aria-hidden
          className={cn("pointer-events-none mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </div>

      {open && (
        <div id={panelId} className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <dl className="flex flex-col gap-1.5 text-sm">
            {groups.map(({ vote, names }) => {
              const { label, hint, Icon, tone } = VOTES[vote];
              return (
                <div key={vote} className="flex items-start gap-2">
                  <dt className="flex w-24 shrink-0 items-center gap-1.5" title={hint}>
                    <Icon className={cn("size-4", tone)} aria-hidden />
                    {label}
                  </dt>
                  <dd className="min-w-0 flex-1 text-muted-foreground">{names.join(", ")}</dd>
                </div>
              );
            })}
          </dl>
          <div className="flex flex-wrap gap-2">
            {onPick && (
              <Button size="sm" onClick={() => onPick(row.candidate_id)} disabled={busy !== null}>
                <Users className="size-3.5" />
                We watched this
              </Button>
            )}
            {onAdd && !row.on_family_list && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAdd(row.candidate_id, "family")}
                disabled={busy !== null}
                className="h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal"
              >
                {working(`add:${row.candidate_id}:family`) ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Add to {familyName} list
              </Button>
            )}
            {onAdd && !row.on_my_list && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAdd(row.candidate_id, "mine")}
                disabled={busy !== null}
              >
                {working(`add:${row.candidate_id}:mine`) ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Add to My list
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onDetails}>
              <Info className="size-3.5" />
              Details
            </Button>
            {onMoreLike && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onMoreLike(row.candidate_id)}
                disabled={busy !== null}
              >
                {working(`more:${row.candidate_id}`) ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                More like this
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * The ranked titles of a night, as far as the viewer may see them. Tap a row to see who voted what and what can be
 * done with the title (`actions`; a button is only there when its action is).
 */
export function Leaderboard({ state, actions }: { state: NightState; actions: RowActions }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [info, setInfo] = useState<DeckCard | null>(null);
  const cards = useMemo(() => new Map(state.candidates.map((c) => [c.id, c])), [state.candidates]);

  return (
    <>
      <ol className="flex flex-col gap-2">
        {state.results.map((row) => {
          const card = cards.get(row.candidate_id);
          if (!card) return null;
          return (
            <Row
              key={row.candidate_id}
              row={row}
              card={card}
              meId={state.me}
              open={openId === row.candidate_id}
              onToggle={() => setOpenId((id) => (id === row.candidate_id ? null : row.candidate_id))}
              onDetails={() => setInfo(candidateToCard(card))}
              actions={actions}
            />
          );
        })}
      </ol>
      <CardInfoSheet card={info} onClose={() => setInfo(null)} />
    </>
  );
}
