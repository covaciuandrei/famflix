"use client";

import { Check, Copy, Loader2, Pencil, Plus, Share2, UserPlus } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { familyGuests, guestInvitation, mergeFamilyGuests, revokeGuestInvitations, saveFamilyGuest } from "@/app/app/movie-night/attendance-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FamilyGuest } from "@/lib/types";

export function FamilyGuests({ groupId, nightId }: { groupId: string; nightId?: string }) {
  const [guests, setGuests] = useState<FamilyGuest[]>([]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editedName, setEditedName] = useState("");
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [busy, start] = useTransition();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [invitation, setInvitation] = useState<{ guestId: string; name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stopped = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void familyGuests(groupId, search).then((res) => {
        if (stopped) return;
        if (res.error) setError(res.error);
        else { setGuests(res.guests ?? []); setHasMore(Boolean(res.hasMore)); setError(null); }
        setLoading(false);
      }, (problem: unknown) => {
        if (stopped) return;
        console.error("Could not load saved guests:", problem);
        setError("Couldn't load saved guests. Check your connection and try again.");
        setLoading(false);
      });
    }, search ? 200 : 0);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [groupId, search, reload]);

  async function save(guestId?: string) {
    setError(null);
    const res = await saveFamilyGuest(groupId, guestId ? editedName : name, guestId);
    if (res.error) setError(res.error);
    else { setEditing(null); setName(""); setReload((n) => n + 1); }
  }

  async function invite(guest: FamilyGuest) {
    setError(null); setCopied(false);
    const res = await guestInvitation(guest.id, nightId);
    if (res.error || !res.path) setError(res.error ?? "Couldn't create the invitation.");
    else setInvitation({ guestId: guest.id, name: guest.name, url: `${window.location.origin}${res.path}` });
  }

  async function copy() {
    if (!invitation) return;
    try { await navigator.clipboard.writeText(invitation.url); setCopied(true); }
    catch { setError("Couldn't copy automatically. Select and copy the invitation link below."); }
  }

  async function share() {
    if (!invitation) return;
    try { await navigator.share({ title: "FamFlix invitation", text: `An invitation for ${invitation.name}`, url: invitation.url }); }
    catch (problem) { if (!(problem instanceof DOMException && problem.name === "AbortError")) setError("Couldn't share. Copy the link instead."); }
  }

  async function revoke() {
    if (!invitation) return;
    const res = await revokeGuestInvitations(invitation.guestId, nightId);
    if (res.error) setError(res.error); else setInvitation(null);
  }

  async function merge() {
    if (!window.confirm("Combine these saved guests? Their attendance is combined, existing destination scores are kept, and voting records are preserved. Only do this if they are the same person.")) return;
    const res = await mergeFamilyGuests(mergeFrom, mergeInto);
    if (res.error) setError(res.error);
    else { setMergeFrom(""); setMergeInto(""); setReload((n) => n + 1); }
  }

  return (
    <section aria-label={nightId ? "Invite a returning guest" : "Saved guests"} className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{nightId ? "Invite a returning guest" : "Saved guests"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {nightId ? "Choose a person to make an invitation linked to their existing guest profile." : "People without accounts who watched with this family. Names are shared across their past nights; registered members control their own account names."}
        </p>
      </div>
      <Input aria-label="Search saved guests" placeholder="Search saved guests" value={search} onChange={(e) => setSearch(e.target.value)} />
      {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading guests…</p> : (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {guests.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 p-3">
              {editing === g.id ? (
                <>
                  <Input aria-label={`Name for ${g.name}`} value={editedName} onChange={(e) => setEditedName(e.target.value)} maxLength={30} className="min-w-0 flex-1" />
                  <Button size="sm" onClick={() => start(() => save(g.id))} disabled={busy || !editedName.trim()}>Save name</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 break-words text-sm font-medium">{g.name}</span>
                  <Button variant="ghost" size="sm" aria-label={`Rename ${g.name}`} onClick={() => { setEditing(g.id); setEditedName(g.name); }}><Pencil className="size-3.5" /></Button>
                  <Button variant="outline" size="sm" onClick={() => start(() => invite(g))} disabled={busy}>
                    <UserPlus className="size-3.5" /> {nightId ? "Invite to this night" : "Invite to FamFlix"}
                  </Button>
                </>
              )}
            </li>
          ))}
          {!guests.length && <li className="p-3 text-sm text-muted-foreground">No saved guests found.</li>}
        </ul>
      )}
      {hasMore && <p className="text-xs text-muted-foreground">Search by name to find more guests.</p>}
      <div className="flex gap-2">
        <Input aria-label="Save a guest name" placeholder="New guest name" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="outline" size="sm" disabled={busy || !name.trim()} onClick={() => start(() => save())}><Plus className="size-4" /> Save guest</Button>
      </div>
      {invitation && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3" aria-label={`Invitation for ${invitation.name}`}>
          <p className="text-sm font-medium">{invitation.name}: {nightId ? "join this movie night" : "create or link an account"}</p>
          <p className="text-xs text-muted-foreground">{nightId ? "Only this night is accessible. Joining does not mark them as having watched." : "After Google sign-in and confirmation, they join this family and import missing history and scores. Their existing account data is kept. Share this private link only with that person."}</p>
          <Input readOnly value={invitation.url} aria-label="Personal invitation link" onFocus={(e) => e.currentTarget.select()} className="text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void copy()}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "Copied" : "Copy"}</Button>
            {typeof navigator !== "undefined" && typeof navigator.share === "function" && <Button size="sm" variant="outline" onClick={() => void share()}><Share2 className="size-3.5" /> Share</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(revoke)}>Revoke these invitations</Button>
          </div>
          <p className="text-xs text-muted-foreground">This invitation expires after 24 hours{nightId ? " or when the night ends" : " and can be accepted only once"}.</p>
        </div>
      )}
      {!nightId && guests.length > 1 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Connect duplicate past guest records</summary>
          <p className="mt-2">Only combine records you know belong to the same person. Similar names alone do not establish identity.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <select aria-label="Guest record to combine" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} className="min-h-9 rounded border border-border bg-card px-2">
              <option value="">From guest…</option>{guests.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select aria-label="Guest profile to keep" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="min-h-9 rounded border border-border bg-card px-2">
              <option value="">Keep guest…</option>{guests.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={busy || !mergeFrom || !mergeInto || mergeFrom === mergeInto} onClick={() => start(merge)}>Combine records</Button>
          </div>
        </details>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error} <button type="button" className="underline" onClick={() => setReload((n) => n + 1)}>Try again</button></p>}
    </section>
  );
}
