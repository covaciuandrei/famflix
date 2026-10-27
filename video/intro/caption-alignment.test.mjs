import assert from "node:assert/strict";
import test from "node:test";

import { alignCaptions } from "./caption-alignment.mjs";

function chunks(text) {
  return text.split(" ").map((word, index) => ({
    text: word,
    timestamp: [index * 0.4, (index + 1) * 0.4],
  }));
}

test("captions keep the script wording and follow actual speech timings", () => {
  const result = alignCaptions(["Your own list.", "Watch together."], chunks("Your own list Watch together"), 0.25, 2);
  assert.deepEqual(result.cues, [
    { id: "caption-1", start: 0.25, end: 1.45, text: "Your own list." },
    { id: "caption-2", start: 1.45, end: 2.25, text: "Watch together." },
  ]);
  assert.equal(result.mismatchRatio, 0);
});

test("brand spelling and a recognizer's joined brand word do not shift following captions", () => {
  const result = alignCaptions(
    ["Meet FamFlix, your personal watchlist.", "Add movies and series."],
    chunks("Meet Famflix your personal watchlist Add movies and series"),
    0,
    4,
  );
  assert.equal(result.cues[0].text, "Meet FamFlix, your personal watchlist.");
  assert.equal(result.cues[1].start, 2);
  assert.equal(result.cues[1].text, "Add movies and series.");
});

test("unrelated or missing speech is rejected rather than given plausible timings", () => {
  assert.throws(() => alignCaptions(["Add to your watchlist."], [], 0, 3), /recognized speech/);
  assert.throws(() => alignCaptions(["Add movies to your personal watchlist."], chunks("Completely unrelated words were spoken instead"), 0, 3), /differs too much/);
});

test("invalid timestamps are surfaced", () => {
  assert.throws(
    () => alignCaptions(["Hello."], [{ text: "Hello", timestamp: [-1, 0.5] }], 0, 2),
    /invalid word timings/,
  );
});
