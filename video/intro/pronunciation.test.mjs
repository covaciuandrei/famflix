import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { phonemize } from "phonemizer";

const script = JSON.parse(readFileSync(new URL("./narration.json", import.meta.url), "utf8"));

test("FamFlix is one FAM-flicks word with one primary stress and a short i", async () => {
  const phonemes = (await phonemize(script.spokenBrand, "en-us")).join(" ");
  assert.equal(phonemes, "f\u02c8\u00e6mfl\u026aks");
  assert.equal((phonemes.match(/\u02c8/g) ?? []).length, 1);
});

test("the concise cut preserves the approved text and narrator", () => {
  assert.equal(script.duration, 25);
  assert.equal(script.voice, "af_bella");
  assert.equal(script.precision, "fp32");
  assert.deepEqual(script.captions, [
    "Meet FamFlix, a home for everything you want to watch.",
    "Find movies and series,",
    "save them to your own list,",
    "and mark them watched when you're done.",
    "You can also share a list with family and friends,",
    "so everyone's ideas are in one place.",
    "For movie night, swipe and vote together",
    "to find a favourite.",
    "Afterwards, add your ratings",
    "and keep track of who watched with you.",
    "FamFlix. Less choosing. More watching.",
    "Get started for free.",
  ]);
});
