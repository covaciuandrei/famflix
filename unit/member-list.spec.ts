import { expect, test } from "@playwright/test";

import { memberTab, splitMemberList, watchedDay } from "../src/lib/member-list";
import type { MemberTitle } from "../src/lib/types";

const title = (id: number, over: Partial<MemberTitle> = {}): MemberTitle => ({
  tmdb_id: id,
  media_type: "movie",
  title: `Title ${id}`,
  release_year: 2000 + id,
  poster_path: null,
  tmdb_rating: null,
  status: "want",
  watched_at: null,
  added_at: "2026-01-01T00:00:00Z",
  score: null,
  ...over,
});
const watched = (id: number, watched_at: string | null) => title(id, { status: "watched", watched_at });
const ids = (list: MemberTitle[]) => list.map((t) => t.tmdb_id);

test("the day a title was watched is the day of the moment it was marked", () => {
  expect(watchedDay(watched(1, "2026-03-01T12:00:00+00:00"))).toBe("2026-03-01");
  expect(watchedDay(watched(1, "2026-03-01T23:59:59.999Z"))).toBe("2026-03-01");
});

test("a title that is not watched, or has no known day, has no day", () => {
  expect(watchedDay(title(1))).toBeNull();
  expect(watchedDay(watched(1, null))).toBeNull();
  // A moment left on a title that is back on To watch is not a day it was watched.
  expect(watchedDay(title(1, { status: "want", watched_at: "2026-03-01T12:00:00Z" }))).toBeNull();
});

test("the tabs: what is still to watch as the list gives it, and what is watched, latest first", () => {
  const list = [
    title(1),
    watched(2, "2026-01-05T12:00:00Z"),
    title(3),
    watched(4, "2026-03-09T12:00:00Z"),
    watched(5, "2026-02-01T12:00:00Z"),
  ];
  const tabs = splitMemberList(list);
  expect(ids(tabs.toWatch)).toEqual([1, 3]);
  expect(ids(tabs.watched)).toEqual([4, 5, 2]);
});

test("watched titles with no known day come after the others, in the order the list gave them", () => {
  const list = [watched(1, null), watched(2, "2026-01-05T12:00:00Z"), watched(3, null), watched(4, "2026-01-05T09:00:00Z")];
  expect(ids(splitMemberList(list).watched)).toEqual([2, 4, 1, 3]);
});

test("watched on the same day keeps the order of the list", () => {
  const list = [watched(1, "2026-05-05T08:00:00Z"), watched(2, "2026-05-05T20:00:00Z"), watched(3, "2026-05-05T12:00:00Z")];
  expect(ids(splitMemberList(list).watched)).toEqual([1, 2, 3]);
});

test("nothing in, nothing out, and the list itself is left as it was", () => {
  expect(splitMemberList([])).toEqual({ toWatch: [], watched: [] });
  const list = [watched(2, "2026-01-05T12:00:00Z"), watched(1, "2026-03-05T12:00:00Z")];
  splitMemberList(list);
  expect(ids(list)).toEqual([2, 1]);
});

test("the address picks the Watched tab or else To watch", () => {
  expect(memberTab("watched")).toBe("watched");
  expect(memberTab("want")).toBe("want");
  expect(memberTab(undefined)).toBe("want");
  expect(memberTab("anything else")).toBe("want");
  expect(memberTab(["watched", "want"])).toBe("want");
  expect(memberTab("")).toBe("want");
});
