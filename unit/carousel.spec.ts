import { expect, test } from "@playwright/test";

import { nearEnd, pageTarget, scrollReach } from "../src/lib/carousel";

// A desktop row: about a thousand pixels wide, cards 144px wide with a 12px gap.
const pitch = 156;
const row = (scrollLeft: number, scrollWidth = 3500, clientWidth = 984) => ({ scrollLeft, clientWidth, scrollWidth });

test("a row that fits has nothing to scroll to", () => {
  expect(scrollReach(row(0, 984))).toEqual({ back: false, forward: false });
  expect(scrollReach(row(0, 500))).toEqual({ back: false, forward: false });
});

test("at the start you can only go forward, at the end only back, in between both", () => {
  expect(scrollReach(row(0))).toEqual({ back: false, forward: true });
  expect(scrollReach(row(1000))).toEqual({ back: true, forward: true });
  expect(scrollReach(row(3500 - 984))).toEqual({ back: true, forward: false });
});

test("a pixel of rounding on a scaled screen still counts as the edge", () => {
  expect(scrollReach(row(0.6))).toEqual({ back: false, forward: true });
  expect(scrollReach(row(3500 - 984 - 0.6))).toEqual({ back: true, forward: false });
  // Further than that is real room to scroll.
  expect(scrollReach(row(1.5)).back).toBe(true);
  expect(scrollReach(row(3500 - 984 - 1.5)).forward).toBe(true);
});

test("one click moves a page of whole cards", () => {
  // 984 / 156 = 6 cards fit, so a page is 6 × 156 = 936.
  expect(pageTarget(row(0), 1, pitch)).toBe(936);
  expect(pageTarget(row(936), 1, pitch)).toBe(1872);
  expect(pageTarget(row(1872), -1, pitch)).toBe(936);
  expect(pageTarget(row(936), -1, pitch)).toBe(0);
});

test("a click lines the first card up again after a free scroll", () => {
  // Dragged to 100px, a click forward lands on a card edge (a multiple of 156), not at 1036.
  expect(pageTarget(row(100), 1, pitch)).toBe(7 * pitch);
  expect(pageTarget(row(1000), -1, pitch) % pitch).toBe(0);
});

test("a click never scrolls past either end", () => {
  const max = 3500 - 984;
  expect(pageTarget(row(max - 100), 1, pitch)).toBe(max);
  expect(pageTarget(row(max), 1, pitch)).toBe(max);
  expect(pageTarget(row(100), -1, pitch)).toBe(0);
  expect(pageTarget(row(0), -1, pitch)).toBe(0);
  // Nothing to scroll: stay put.
  expect(pageTarget(row(0, 500), 1, pitch)).toBe(0);
});

test("when the card size is unknown a click moves most of the visible width", () => {
  expect(pageTarget(row(0), 1, 0)).toBeCloseTo(984 * 0.8);
  // A card wider than the row cannot be paged by whole cards either.
  expect(pageTarget(row(0), 1, 2000)).toBeCloseTo(984 * 0.8);
  expect(pageTarget(row(1000), -1, 0)).toBeCloseTo(1000 - 984 * 0.8);
});

test("every click gets somewhere while there is room, from any position", () => {
  const max = 3500 - 984;
  for (let at = 0; at <= max; at += 7) {
    if (at < max) expect(pageTarget(row(at), 1, pitch), `forward from ${at}`).toBeGreaterThan(at);
    if (at > 0) expect(pageTarget(row(at), -1, pitch), `back from ${at}`).toBeLessThan(at);
  }
});

test("the same holds in a narrow window", () => {
  const narrow = (scrollLeft: number) => row(scrollLeft, 2800, 300);
  // Only 2 cards fit in 300px (128px cards + 12px gap = 140).
  expect(pageTarget(narrow(0), 1, 140)).toBe(280);
  for (let at = 0; at <= 2500; at += 11) {
    if (at < 2500) expect(pageTarget(narrow(at), 1, 140)).toBeGreaterThan(at);
    if (at > 0) expect(pageTarget(narrow(at), -1, 140)).toBeLessThan(at);
  }
});

test("more titles are asked for once less than a page and a half is left to scroll", () => {
  // 3500 wide in a 984 window: 3500 − 984 = 2516 to scroll in all; the limit is 1.5 × 984 = 1476 from the end.
  expect(nearEnd(row(0))).toBe(false);
  expect(nearEnd(row(1000))).toBe(false);
  expect(nearEnd(row(1040))).toBe(true);
  expect(nearEnd(row(1100))).toBe(true);
  expect(nearEnd(row(3500 - 984))).toBe(true);
  // Right on the limit counts.
  expect(nearEnd(row(2516 - 1476))).toBe(true);
  expect(nearEnd(row(2516 - 1476 - 1))).toBe(false);
});

test("a row that fits is at its end, so what follows is asked for at once", () => {
  expect(nearEnd(row(0, 984))).toBe(true);
  expect(nearEnd(row(0, 500))).toBe(true);
  // Even a short row of cards a screen and a bit wide.
  expect(nearEnd(row(0, 1500))).toBe(true);
});

test("a row that is not on screen is never near its end, or hidden rows would load for ever", () => {
  expect(nearEnd({ scrollLeft: 0, clientWidth: 0, scrollWidth: 0 })).toBe(false);
  expect(nearEnd({ scrollLeft: 0, clientWidth: 0, scrollWidth: 3000 })).toBe(false);
  expect(nearEnd({ scrollLeft: 0, clientWidth: 0, scrollWidth: 3000 }, { engaged: true, pitch })).toBe(false);
});

test("a row nobody has scrolled yet waits until it has to, however many cards it keeps ahead later", () => {
  // Twelve thousand pixels of cards: far more than a first page, so a row that is only looked at is nowhere near its end.
  const long = (scrollLeft: number) => row(scrollLeft, 12_000);
  expect(nearEnd(long(0), { engaged: false, pitch })).toBe(false);
  expect(nearEnd(long(0), { pitch })).toBe(false);
  // The pitch alone changes nothing: the same 1.5 windows as before, 12000 − 984 − 1476 = 9540.
  expect(nearEnd(long(9539), { pitch })).toBe(false);
  expect(nearEnd(long(9540), { pitch })).toBe(true);
});

test("once somebody has scrolled a row it keeps forty cards ahead of them, so a quick run of clicks doesn't catch up", () => {
  // 40 cards of 156 are 6240; 12000 − 984 − 6240 = 4776 from the start is where the next page is asked for.
  const long = (scrollLeft: number) => row(scrollLeft, 12_000);
  expect(nearEnd(long(0), { engaged: true, pitch })).toBe(false);
  expect(nearEnd(long(4775), { engaged: true, pitch })).toBe(false);
  expect(nearEnd(long(4776), { engaged: true, pitch })).toBe(true);
  expect(nearEnd(long(12_000 - 984), { engaged: true, pitch })).toBe(true);
  // A first page of twenty cards is already inside that, so the first scroll asks for the next at once; before that, a row
  // that is only looked at asks for nothing.
  expect(nearEnd(row(0, 20 * pitch), { engaged: true, pitch })).toBe(true);
  expect(nearEnd(row(0, 20 * pitch), { engaged: false, pitch })).toBe(false);
  // On a phone (a narrow window, cards still a card wide) it is the same forty cards, not forty windows.
  const phone = (scrollLeft: number) => ({ scrollLeft, clientWidth: 390, scrollWidth: 12_000 });
  expect(nearEnd(phone(12_000 - 390 - 40 * 152 - 1), { engaged: true, pitch: 152 })).toBe(false);
  expect(nearEnd(phone(12_000 - 390 - 40 * 152), { engaged: true, pitch: 152 })).toBe(true);
});

test("without a pitch to count cards with (fewer than two of them) a scrolled row looks ahead by windows like any other", () => {
  const long = (scrollLeft: number) => row(scrollLeft, 12_000);
  expect(nearEnd(long(9539), { engaged: true })).toBe(false);
  expect(nearEnd(long(9540), { engaged: true })).toBe(true);
  expect(nearEnd(long(9539), { engaged: true, pitch: 0 })).toBe(false);
  // And a screen wide enough for forty cards at once never looks ahead less than it did.
  expect(nearEnd(long(9539), { engaged: true, pitch: 1 })).toBe(false);
  expect(nearEnd(long(9540), { engaged: true, pitch: 1 })).toBe(true);
});
