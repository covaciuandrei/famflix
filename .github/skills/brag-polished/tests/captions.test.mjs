import assert from "node:assert/strict";
import test from "node:test";

import { alignCaptions } from "../scripts/caption-alignment.mjs";
import { canonicalVtt } from "../scripts/assets.mjs";

const chunks = (text) => text.split(" ").map((word, index) => ({ text: word, timestamp: [index * 0.4, (index + 1) * 0.4] }));

test("canonical text uses actual measured timings", () => {
  const result = alignCaptions(["Your own list.", "Watch together."], chunks("Your own list Watch together"), 0.12, 2);
  assert.deepEqual(result.cues, [
    { id: "caption-1", start: 0.12, end: 1.32, text: "Your own list." },
    { id: "caption-2", start: 1.32, end: 2.12, text: "Watch together." },
  ]);
  assert.equal(result.mismatchRatio, 0);
});

test("multi-word recognized brand aliases normalize without rewriting display copy", () => {
  const aliases = [{ canonical: "BrightBox", spoken: "Brightbox", recognitionAliases: ["Bright Box"] }];
  const result = alignCaptions(["Meet BrightBox.", "Save your ideas."], chunks("Meet Bright Box Save your ideas"), 0, 3, aliases);
  assert.equal(result.cues[0].text, "Meet BrightBox.");
  assert.equal(result.cues[1].start, 1.2);
  assert.equal(result.mismatchRatio, 0);
});

test("missing speech, unrelated speech and invalid timing fail explicitly", () => {
  assert.throws(() => alignCaptions(["Your own list."], [], 0, 3), /recognized speech/);
  assert.throws(() => alignCaptions(["Save everything you want to watch."], chunks("Nothing matches this narration at all"), 0, 3), /disagreement/);
  assert.throws(() => alignCaptions(["Hello."], [{ text: "Hello", timestamp: [-1, 0.5] }], 0, 2), /invalid word timings/);
});

test("delivery captions have exact measured bounds and cannot run outside the video", () => {
  const project = { output: { duration: 25 } };
  const narration = { cues: [{ id: "one", start: 0.12, end: 2, text: "Approved text." }] };
  assert.equal(canonicalVtt(project, narration), "WEBVTT\n\n00:00:00.120 --> 00:00:02.000\nApproved text.\n");
  narration.cues[0].end = 25.1;
  assert.throws(() => canonicalVtt(project, narration), /Caption timing is invalid/);
});
