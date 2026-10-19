"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { familyGuests, setGuestScore } from "@/app/app/movie-night/attendance-actions";
import { Avatar } from "@/components/avatar";
import { ScoreInput } from "@/components/score-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatScore } from "@/lib/format";
import type { FamilyGuest, GuestRating } from "@/lib/types";

export function GuestScoreRow({ rating, itemId }: { rating: GuestRating; itemId: string }) {
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState<number | null>(rating.score);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = rating.guest?.name ?? "Guest";
  function save() {
    setError(null);
    start(async () => {
      const res = await setGuestScore(itemId, rating.guest_id, score);
      if (res.error) setError(res.error); else setEditing(false);
    });
  }
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span aria-hidden><Avatar name={name} /></span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{name} <span className="text-xs font-normal text-muted-foreground">(Guest)</span></p>
          <p className="text-xs text-muted-foreground">Entered by {rating.entered_by?.display_name ?? "a family member"}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-star">{formatScore(rating.score)}/10</span>
        <Button size="sm" variant="ghost" onClick={() => { setScore(rating.score); setEditing((v) => !v); }} aria-label={`Edit score for ${name}`}>Edit</Button>
      </div>
      {editing && (
        <div className="mt-3">
          <ScoreInput value={score} onChange={setScore} label={`Score for guest ${name}`} />
          <p className="mt-1 text-xs text-muted-foreground">One score for this guest and movie, shared across their viewings.</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" disabled={pending} onClick={save}>{pending && <Loader2 className="size-3 animate-spin" />}Save score</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </li>
  );
}

export function GuestScoreEntry({ groupId, itemId }: { groupId: string; itemId: string }) {
  const [query, setQuery] = useState("");
  const [guests, setGuests] = useState<FamilyGuest[]>([]);
  const [guestId, setGuestId] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let stopped = false;
    const timer = window.setTimeout(() => {
      void familyGuests(groupId, query).then((res) => {
        if (stopped) return;
        if (res.error) setError(res.error); else { setError(null); setGuests(res.guests ?? []); }
      }, (problem: unknown) => {
        if (stopped) return;
        console.error("Could not load guests for scoring:", problem);
        setError("Couldn't load guests. Check your connection and try again.");
      });
    }, query ? 200 : 0);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [groupId, query, reload]);
  function save() {
    setSaved(false); setError(null);
    start(async () => {
      const res = await setGuestScore(itemId, guestId, score);
      if (res.error) setError(res.error); else setSaved(true);
    });
  }
  return (
    <details className="border-t border-border pt-3">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Record a guest score</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">Guest scores count in this family&apos;s average, once per person and movie. They do not cast votes or likes/dislikes.</p>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a guest" aria-label="Find a guest to rate" />
        <select aria-label="Guest to rate" value={guestId} onChange={(e) => { setGuestId(e.target.value); setSaved(false); }} className="h-10 rounded-md border border-border bg-card px-2 text-sm">
          <option value="">Select a saved guest</option>
          {guests.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <ScoreInput value={score} onChange={(value) => { setScore(value); setSaved(false); }} label="Guest score" />
        <Button size="sm" disabled={pending || !guestId || score === null} onClick={save}>{pending && <Loader2 className="size-3 animate-spin" />}Save guest score</Button>
        {error && <p role="alert" className="text-xs text-destructive">{error} <button type="button" className="underline" onClick={() => setReload((n) => n + 1)}>Try again</button></p>}
        {saved && <p role="status" className="text-xs text-like">Guest score saved.</p>}
      </div>
    </details>
  );
}
