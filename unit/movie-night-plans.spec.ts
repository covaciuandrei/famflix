import { expect, test } from "@playwright/test";

import {
  defaultPlanTime,
  endedLabel,
  formatPlanTime,
  inPopupWindow,
  inReminderWindow,
  localInputToIso,
  parseDuePlans,
  parsePlans,
  peopleByAnswer,
  planBounds,
  planTimeProblem,
  planToInvite,
  plansInWindow,
  readShownPlans,
  rememberShownPlan,
  rsvpSummary,
  tally,
  timeHasCome,
  toLocalInput,
  whenWords,
  type DuePlan,
  type PlanPerson,
} from "../src/lib/movie-night-plans";

const ME = "me";
const person = (user_id: string, name: string, answer: PlanPerson["answer"]): PlanPerson => ({ user_id, name, answer });
const at = (iso: string) => Date.parse(iso);

test.describe("answers", () => {
  test("are counted and worded without the ones nobody gave", () => {
    const answers = [person("a", "Ana", "going"), person("b", "Ben", "going"), person("c", "Cara", "maybe"), person("d", "Dan", "no")];
    expect(tally(answers)).toEqual({ going: 2, maybe: 1, no: 1 });
    expect(rsvpSummary(answers)).toBe("2 going · 1 maybe · 1 can't");
    expect(rsvpSummary([person("a", "Ana", "going")])).toBe("1 going");
    expect(rsvpSummary([person("a", "Ana", "maybe"), person("b", "Ben", "no")])).toBe("1 maybe · 1 can't");
    expect(rsvpSummary([])).toBe("No answers yet");
    expect(tally([])).toEqual({ going: 0, maybe: 0, no: 0 });
  });

  test("are listed by answer, Going first, with you as You and first, the others by name", () => {
    const answers = [
      person("d", "Dan", "going"),
      person(ME, "Me Myself", "going"),
      person("a", "Ana", "going"),
      person("z", "Zed", "no"),
      person("c", "Cara", "maybe"),
    ];
    expect(peopleByAnswer(answers, ME)).toEqual([
      { answer: "going", names: ["You", "Ana", "Dan"] },
      { answer: "maybe", names: ["Cara"] },
      { answer: "no", names: ["Zed"] },
    ]);
    expect(peopleByAnswer([], ME)).toEqual([]);
    expect(peopleByAnswer([person("a", "Ana", "no")], ME)).toEqual([{ answer: "no", names: ["Ana"] }]);
  });
});

test.describe("what the database says", () => {
  const row = {
    id: "p1",
    starts_at: "2026-10-18T17:00:00+00:00",
    note: "Pizza",
    genres: ["comedy", "family"],
    status: "planned",
    created_by: "a",
    created_by_name: "Ana",
    ended_at: null,
    my_answer: "going",
    answers: [{ user_id: "a", name: "Ana", answer: "going" }],
  };

  test("a plan is read as it is", () => {
    expect(parsePlans([row])).toEqual([row]);
  });

  test("what isn't a plan is left out, and what is missing is filled in", () => {
    expect(parsePlans(null)).toEqual([]);
    expect(parsePlans({})).toEqual([]);
    expect(parsePlans([null, 3, "x", [], { id: "no time" }, { ...row, starts_at: "not a time" }, { ...row, status: "weird" }, { ...row, id: "" }])).toEqual([]);
    const [plan] = parsePlans([{ id: "p2", starts_at: row.starts_at, status: "cancelled", ended_at: "2026-10-01T10:00:00Z", answers: "nope", genres: [1, "drama", null] }]);
    expect(plan).toEqual({
      id: "p2",
      starts_at: row.starts_at,
      note: null,
      genres: ["drama"],
      status: "cancelled",
      created_by: null,
      created_by_name: null,
      ended_at: "2026-10-01T10:00:00Z",
      my_answer: null,
      answers: [],
    });
  });

  test("an answer it doesn't know is not counted", () => {
    const [plan] = parsePlans([
      {
        ...row,
        my_answer: "definitely",
        answers: [{ user_id: "a", name: "Ana", answer: "going" }, { user_id: "b", name: "Ben", answer: "yes" }, { user_id: "", answer: "going" }, { name: "x", answer: "no" }, { user_id: "c", answer: "maybe" }],
      },
    ]);
    expect(plan.my_answer).toBeNull();
    expect(plan.answers.map((a) => `${a.user_id}:${a.name}:${a.answer}`)).toEqual(["a:Ana:going", "c:Someone:maybe"]);
  });

  test("a reminder is read as it is, and what isn't one is left out", () => {
    const due = { id: "p1", group_id: "g1", group_name: "Fam", starts_at: "2026-10-18T17:00:00Z", note: null, my_answer: "maybe", going: 3 };
    expect(parseDuePlans([due])).toEqual([due]);
    expect(parseDuePlans([{ ...due, group_name: 3, going: "many", my_answer: "x" }])).toEqual([{ ...due, group_name: "your family", going: 0, my_answer: null }]);
    expect(parseDuePlans([{ ...due, group_id: "" }, { ...due, starts_at: "soon" }, null, 7])).toEqual([]);
    expect(parseDuePlans("nope")).toEqual([]);
  });
});

test.describe("the windows", () => {
  const start = "2026-10-18T17:00:00Z";
  const minutes = (n: number) => at(start) + n * 60_000;

  test("the time has come at the planned time, not before", () => {
    expect(timeHasCome(start, minutes(-1))).toBe(false);
    expect(timeHasCome(start, minutes(0))).toBe(true);
    expect(timeHasCome(start, minutes(500))).toBe(true);
  });

  test("the dot and the banner are there from an hour before to three hours after, both ends in", () => {
    expect(inReminderWindow(start, minutes(-61))).toBe(false);
    expect(inReminderWindow(start, minutes(-60))).toBe(true);
    expect(inReminderWindow(start, minutes(0))).toBe(true);
    expect(inReminderWindow(start, minutes(180))).toBe(true);
    expect(inReminderWindow(start, minutes(181))).toBe(false);
    expect(inReminderWindow("not a time", minutes(0))).toBe(false);
  });

  test("the invite window may open from 15 minutes before to three hours after", () => {
    expect(inPopupWindow(start, minutes(-16))).toBe(false);
    expect(inPopupWindow(start, minutes(-15))).toBe(true);
    expect(inPopupWindow(start, minutes(180))).toBe(true);
    expect(inPopupWindow(start, minutes(181))).toBe(false);
    expect(inPopupWindow("not a time", minutes(0))).toBe(false);
  });

  test("a plan that is over says how", () => {
    expect(endedLabel("cancelled")).toBe("Cancelled");
    expect(endedLabel("expired")).toBe("Passed");
    expect(endedLabel("planned")).toBeNull();
    expect(endedLabel("started")).toBeNull();
  });
});

test.describe("the reminders", () => {
  const start = "2026-10-18T17:00:00Z";
  const minutes = (n: number, from = start) => at(from) + n * 60_000;
  const plan = (id: string, startsAt: string, my_answer: DuePlan["my_answer"] = null): DuePlan => ({
    id,
    group_id: "g",
    group_name: "Fam",
    starts_at: startsAt,
    note: null,
    my_answer,
    going: 0,
  });

  test("say when it is in words", () => {
    expect(whenWords(start, minutes(-25))).toBe("Starts in 25 minutes");
    expect(whenWords(start, minutes(-1))).toBe("Starts in 1 minute");
    expect(whenWords(start, minutes(-60))).toBe("Starts in 1 h");
    expect(whenWords(start, minutes(-90))).toBe("Starts in 1 h 30 min");
    expect(whenWords(start, minutes(0))).toBe("Starting now");
    expect(whenWords(start, minutes(0) + 20_000)).toBe("Starting now");
    expect(whenWords(start, minutes(20))).toBe("Started 20 minutes ago");
    expect(whenWords(start, minutes(1))).toBe("Started 1 minute ago");
    expect(whenWords(start, minutes(150))).toBe("Started 2 h 30 min ago");
    expect(whenWords("not a time", minutes(0))).toBe("Starting now");
  });

  test("are for the plans in their window that the person can come to, soonest first", () => {
    const now = minutes(0);
    const plans = [
      plan("late", "2026-10-18T14:30:00Z"),
      plan("soon", "2026-10-18T17:30:00Z"),
      plan("later", "2026-10-18T19:00:00Z"),
      plan("too-late", "2026-10-18T13:59:00Z"),
      plan("cant", "2026-10-18T17:10:00Z", "no"),
      plan("maybe", "2026-10-18T17:20:00Z", "maybe"),
      plan("going", "2026-10-18T17:20:00Z", "going"),
    ];
    // "later" is 2 hours off, beyond the hour before; "too-late" is over 3 hours back; "cant" is one they can't come to.
    expect(plansInWindow(plans, now).map((p) => p.id)).toEqual(["late", "going", "maybe", "soon"]);
    expect(plansInWindow([], now)).toEqual([]);
    expect(plansInWindow(plans, now - 3 * 3_600_000).map((p) => p.id)).toEqual(["too-late", "late"]);
  });

  test("open an invite from 15 minutes before, once for each plan", () => {
    const soon = plan("soon", "2026-10-18T17:30:00Z");
    const near = plan("near", "2026-10-18T17:10:00Z");
    const now = minutes(0);
    // 30 minutes off: the dot and the banner, not yet the invite. 10 minutes off: the invite too.
    expect(planToInvite([soon], now, new Set())).toBeNull();
    expect(planToInvite([soon, near], now, new Set())?.id).toBe("near");
    expect(planToInvite([soon, near], now, new Set(["near"]))).toBeNull();
    expect(planToInvite([soon, near], minutes(16, "2026-10-18T17:00:00Z"), new Set(["near"]))?.id).toBe("soon");
    expect(planToInvite([near], now, new Set(["other"]))?.id).toBe("near");
    // Not for one they can't come to, nor once the window after the time is over.
    expect(planToInvite([plan("no", "2026-10-18T17:10:00Z", "no")], now, new Set())).toBeNull();
    expect(planToInvite([near], at("2026-10-18T20:11:00Z"), new Set())).toBeNull();
    expect(planToInvite([near], at("2026-10-18T20:09:00Z"), new Set())?.id).toBe("near");
  });

  test("are remembered by the browser, a few dozen at most, whatever it has kept", () => {
    expect([...readShownPlans(null)]).toEqual([]);
    expect([...readShownPlans("not json")]).toEqual([]);
    expect([...readShownPlans('{"a": 1}')]).toEqual([]);
    expect([...readShownPlans('["a", 3, null, "b", ""]')]).toEqual(["a", "b"]);
    const once = rememberShownPlan(null, "a");
    expect(once).toBe('["a"]');
    expect(rememberShownPlan(once, "b")).toBe('["a","b"]');
    // Remembering one again doesn't repeat it, and puts it last.
    expect(rememberShownPlan('["a","b"]', "a")).toBe('["b","a"]');
    expect(rememberShownPlan("garbage", "z")).toBe('["z"]');
    let stored: string | null = null;
    for (let i = 0; i < 60; i++) stored = rememberShownPlan(stored, `p${i}`);
    const kept = [...readShownPlans(stored)];
    expect(kept).toHaveLength(50);
    expect(kept[0]).toBe("p10");
    expect(kept[49]).toBe("p59");
  });
});

test.describe("the time someone types", () => {
  test("is written for a date field in the person's own time, and read back as the same moment", () => {
    const evening = new Date(2026, 9, 18, 20, 5);
    expect(toLocalInput(evening)).toBe("2026-10-18T20:05");
    expect(toLocalInput(new Date(2026, 0, 3, 9, 7))).toBe("2026-01-03T09:07");
    const iso = localInputToIso("2026-10-18T20:05");
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getTime()).toBe(evening.getTime());
    expect(iso).toMatch(/Z$/);
  });

  test("nothing that isn't a time is one", () => {
    for (const value of ["", "tomorrow", "2026-10-18", "2026-10-18 20:00", "2026-13-18T20:00", "2026-10-18T25:00", "2026-10-18T20:00:00Z"]) {
      expect(localInputToIso(value), value).toBeNull();
    }
  });

  test("a new plan starts this evening at eight, or tomorrow's when that is under two hours away", () => {
    expect(toLocalInput(defaultPlanTime(new Date(2026, 9, 18, 9, 0)))).toBe("2026-10-18T20:00");
    expect(toLocalInput(defaultPlanTime(new Date(2026, 9, 18, 17, 59)))).toBe("2026-10-18T20:00");
    expect(toLocalInput(defaultPlanTime(new Date(2026, 9, 18, 18, 0)))).toBe("2026-10-18T20:00");
    expect(toLocalInput(defaultPlanTime(new Date(2026, 9, 18, 18, 1)))).toBe("2026-10-19T20:00");
    expect(toLocalInput(defaultPlanTime(new Date(2026, 9, 18, 23, 30)))).toBe("2026-10-19T20:00");
    expect(toLocalInput(defaultPlanTime(new Date(2026, 11, 31, 22, 0)))).toBe("2027-01-01T20:00");
  });

  test("can be now to a year from now", () => {
    const now = new Date(2026, 9, 18, 12, 30);
    expect(planBounds(now)).toEqual({ min: "2026-10-18T12:30", max: "2027-10-18T12:30" });
  });

  test("says what is wrong with it", () => {
    const now = at("2026-10-18T12:00:00Z");
    expect(planTimeProblem(null, now)).toBe("Pick a day and a time.");
    expect(planTimeProblem("2026-10-18T11:00:00Z", now)).toBe("Pick a time in the future.");
    expect(planTimeProblem("2026-10-18T12:00:00Z", now)).toBe("Pick a time in the future.");
    expect(planTimeProblem("2026-10-18T12:00:01Z", now)).toBeNull();
    expect(planTimeProblem("2027-10-01T12:00:00Z", now)).toBeNull();
    expect(planTimeProblem("2028-10-18T12:00:00Z", now)).toBe("Plan a movie night within the next year.");
  });

  test("is shown in the time zone and language of whoever looks at it", () => {
    const iso = "2026-10-18T17:00:00Z";
    expect(formatPlanTime(iso, { kind: "full", locale: "en-US", timeZone: "UTC" })).toBe("Sun, Oct 18, 5:00 PM");
    expect(formatPlanTime(iso, { kind: "full", locale: "en-US", timeZone: "Pacific/Auckland" })).toBe("Mon, Oct 19, 6:00 AM");
    expect(formatPlanTime(iso, { kind: "day", locale: "en-US", timeZone: "America/New_York" })).toBe("Sun, Oct 18");
    expect(formatPlanTime(iso, { kind: "full", locale: "en-GB", timeZone: "UTC" })).toBe("Sun 18 Oct, 17:00");
    expect(formatPlanTime("not a time", { kind: "full" })).toBe("");
  });
});
