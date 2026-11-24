import { expect, test } from "@playwright/test";

import { familyScoreSummary, localReturnPath, validGuestSelections } from "../src/lib/attendance";
import { groupEarlier, myViewings } from "../src/lib/rewatch";
import { viewingsOf } from "../src/lib/export-csv";

test("guest scores count once alongside members, and converted identities do not count twice", () => {
  const guest = { id: "daria", name: "Daria", account_id: null };
  expect(familyScoreSummary([{ score: 8 }, { score: null }], [{ score: 6, guest }])).toEqual({ average: 7, count: 2 });
  expect(familyScoreSummary([{ score: 8 }, { score: 9 }], [{ score: 6, guest: { ...guest, account_id: "account" } }])).toEqual({ average: 8.5, count: 2 });
  expect(familyScoreSummary([], [])).toEqual({ average: null, count: 0 });
});

test("guest selections enforce the exact shape, unique identities, score range and ten-person boundary", () => {
  const guests = Array.from({ length: 11 }, (_, i) => ({ guestId: `77777777-0000-4000-8000-${String(i).padStart(12, "0")}`, score: null }));
  expect(validGuestSelections(guests.slice(0, 10))).toBe(true);
  expect(validGuestSelections(guests)).toBe(false);
  for (const value of [null, {}, [null], [{}], [guests[0], guests[0]], [{ ...guests[0], score: undefined }], [{ ...guests[0], score: 0 }], [{ ...guests[0], score: 10.1 }], [{ ...guests[0], score: NaN }]]) {
    expect(validGuestSelections(value)).toBe(false);
  }
});

test("unknown family viewings group by viewing identity, never by attendee or by a shared null", () => {
  const earlier = groupEarlier([
    { user_id: "ana", watched_on: null, viewing_id: "first" },
    { user_id: "ben", watched_on: null, viewing_id: "first" },
    { user_id: "ana", watched_on: null, viewing_id: "second" },
  ]);
  expect(earlier).toEqual([
    { on: null, userIds: ["ana", "ben"], viewingId: "first" },
    { on: null, userIds: ["ana"], viewingId: "second" },
  ]);
  expect(myViewings({ on: null, viewingId: "second" }, earlier).lines).toHaveLength(2);
});

test("an account invitation continues only to a local path after login", () => {
  const path = "/guest/account/" + "a".repeat(64);
  expect(localReturnPath(path)).toBe(path);
  for (const value of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/\n/evil.example", null, ["x"]]) {
    expect(localReturnPath(value)).toBe("/app/browse");
  }
});

test("export merges the same undated family viewing across lists without losing separate viewings", () => {
  const title = { title: "Dune", type: "movie" as const, tmdb_id: 438631, year: 2021 };
  const rows = viewingsOf({
    my_list: [{ ...title, status: "watched", watched_at: null, viewing_id: "first", my_score: 8, my_note: null, watched_with: null }],
    family_viewings: [
      { ...title, viewing_id: "first", watched_on: null, family: "Cinema", people: ["Daria (guest)"], score: 8, note: null },
      { ...title, viewing_id: "second", watched_on: null, family: "Cinema", people: [], score: 8, note: null },
    ],
    watch_history: [{ ...title, viewing_id: "first", watched_on: null, family: "Cinema" }],
  });
  expect(rows).toHaveLength(2);
  expect(rows[0].with).toEqual(["Daria (guest)"]);
});
