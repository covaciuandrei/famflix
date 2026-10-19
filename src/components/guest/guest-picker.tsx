"use client";

import { Loader2, Plus, Search } from "lucide-react";
import { useEffect, useEffectEvent, useState, useTransition } from "react";

import { familyGuests, saveFamilyGuest } from "@/app/app/movie-night/attendance-actions";
import { ScoreInput } from "@/components/score-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FamilyGuest, GuestSelection } from "@/lib/types";

export function GuestPicker({
  groupId, value, onChange, onReady, scores = false,
}: {
  groupId: string;
  value: GuestSelection[];
  onChange: (guests: GuestSelection[]) => void;
  onReady: (ready: boolean) => void;
  scores?: boolean;
}) {
  const [guests, setGuests] = useState<FamilyGuest[]>([]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, startCreating] = useTransition();
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const load = useEffectEvent(async (query: string) => {
    onReady(false);
    const res = await familyGuests(groupId, query, value.map((g) => g.guestId));
    return res;
  });
  const ready = useEffectEvent(onReady);

  useEffect(() => {
    let stopped = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void load(search).then((res) => {
        if (stopped) return;
        if (res.error) setError(res.error);
        else {
          setError(null);
          setGuests(res.guests ?? []);
          setHasMore(Boolean(res.hasMore));
          ready(true);
        }
        setLoading(false);
      }, (problem: unknown) => {
        if (stopped) return;
        console.error("Could not load guest participants:", problem);
        setError("Couldn't load guests. Check your connection and try again.");
        setLoading(false);
        ready(false);
      });
    }, search ? 200 : 0);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [groupId, search, retry]);

  async function add() {
    onReady(false);
    setError(null);
    const res = await saveFamilyGuest(groupId, name);
    if (res.error || !res.id) setError(res.error ?? "The guest couldn't be saved.");
    else {
      onChange([...value, { guestId: res.id, score: null }]);
      setGuests((prev) => [...prev, { id: res.id!, group_id: groupId, name: name.trim(), account_id: null }]);
      setName("");
    }
    onReady(!loading);
  }

  return (
    <section aria-label="Guest participants" className="mt-5 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">Guests</h3>
      <p className="mt-1 text-xs text-muted-foreground">Select who actually watched, even if they never joined with a link.</p>
      {scores && <p className="mt-1 text-xs text-muted-foreground">Optional guest scores count once per movie. Leave a score blank to keep any existing score.</p>}
      <label className="relative mt-3 block">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input aria-label="Find a saved guest" placeholder="Find a saved guest" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </label>
      {loading ? (
        <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading guests…</p>
      ) : (
        <ul className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {guests.map((g) => {
            const selected = value.find((v) => v.guestId === g.id);
            return (
              <li key={g.id} className="rounded-lg border border-border px-3 py-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={Boolean(selected)}
                    disabled={!selected && value.length >= 10}
                    onChange={() => onChange(selected ? value.filter((v) => v.guestId !== g.id) : [...value, { guestId: g.id, score: null }])} />
                  <span className="min-w-0 break-words">{g.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Guest</span>
                </label>
                {selected && scores && (
                  <div className="mt-2">
                    <ScoreInput compact value={selected.score} label={`Guest score for ${g.name}`} onChange={(score) =>
                      onChange(value.map((v) => v.guestId === g.id ? { ...v, score } : v))} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && guests.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No saved guests found. Add one below.</p>}
      {hasMore && <p className="mt-2 text-xs text-muted-foreground">Search by name to find more saved guests.</p>}
      <div className="mt-3 flex gap-2">
        <Input aria-label="New guest name" placeholder="New guest name" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" variant="outline" disabled={creating || !name.trim() || value.length >= 10} onClick={() => startCreating(add)}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
        </Button>
      </div>
      {error && <div role="alert" className="mt-2 text-xs text-destructive">{error} <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>Try again</button></div>}
    </section>
  );
}
