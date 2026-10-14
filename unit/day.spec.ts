import { expect, test } from "@playwright/test";

import { dayOf, isDay, isTooLate, localDay, readPickedDay, watchedAtFor } from "../src/lib/day";

test.describe("days", () => {
  test("a day is a real calendar day written YYYY-MM-DD", () => {
    expect(isDay("2026-10-15")).toBe(true);
    expect(isDay("2024-02-29")).toBe(true);
    for (const bad of ["2026-13-01", "2026-02-30", "2025-02-29", "26-10-15", "2026-10-15T10:00:00Z", "", null, undefined, 20261015]) {
      expect(isDay(bad), String(bad)).toBe(false);
    }
  });

  test("today in the person's own time is a day", () => {
    expect(isDay(localDay())).toBe(true);
    // Late evening in UTC-8 is already tomorrow in UTC: it is the local day that counts.
    expect(localDay(new Date(2026, 9, 15, 23, 30))).toBe("2026-10-15");
    expect(localDay(new Date(2026, 9, 15, 0, 5))).toBe("2026-10-15");
  });

  test("a day is saved as noon UTC, so it reads the same in every time zone", () => {
    expect(watchedAtFor("2026-10-15")).toBe("2026-10-15T12:00:00.000Z");
    expect(dayOf(watchedAtFor("2026-10-15"))).toBe("2026-10-15");
    // Whatever the offset, noon UTC is that same calendar day from UTC-11 to UTC+11.
    for (const offset of [-11, -5, 0, 5, 11]) {
      const local = new Date(Date.parse(watchedAtFor("2026-10-15")) + offset * 3_600_000);
      expect(local.toISOString().slice(0, 10)).toBe("2026-10-15");
    }
  });

  test("a moment stands for its day, and no moment for no day", () => {
    expect(dayOf("2026-10-15T08:30:00+00:00")).toBe("2026-10-15");
    expect(dayOf(null)).toBeNull();
    expect(dayOf(undefined)).toBeNull();
    expect(dayOf("")).toBeNull();
  });

  test("tomorrow still passes, anywhere after that is too late", () => {
    const now = Date.parse("2026-10-15T10:00:00Z");
    expect(isTooLate("2026-10-14", now)).toBe(false);
    expect(isTooLate("2026-10-15", now)).toBe(false);
    expect(isTooLate("2026-10-16", now)).toBe(false);
    expect(isTooLate("2026-10-17", now)).toBe(true);
    expect(isTooLate("2030-01-01", now)).toBe(true);
  });

  test("what a person picked: a day, none at all, or something that can't be saved", () => {
    expect(readPickedDay(null)).toEqual({ day: null });
    expect(readPickedDay("2020-01-01")).toEqual({ day: "2020-01-01" });
    expect(readPickedDay("2020-13-01")).toEqual({ error: "That day isn't valid." });
    expect(readPickedDay("yesterday")).toEqual({ error: "That day isn't valid." });
    expect(readPickedDay(undefined)).toEqual({ error: "That day isn't valid." });
    expect(readPickedDay("2999-01-01")).toEqual({ error: "Pick a day that is not in the future." });
  });
});
