import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TOOL_ROOT, inside, loadProject, profileHash, readJson } from "../scripts/lib.mjs";

const fixture = join(TOOL_ROOT, "fixtures/famflix-reference");

function profile(change, verify) {
  const directory = mkdtempSync(join(tmpdir(), "brag-profile-"));
  const value = readJson(join(fixture, "project.json"));
  value.sourceRoot = fixture;
  value.voice ??= {};
  change(value);
  const file = join(directory, "project.json");
  writeFileSync(file, JSON.stringify(value));
  try { verify(file); } finally { rmSync(directory, { recursive: true }); }
}

test("the approved narrator and default output are explicit, not app-runtime dependencies", () => {
  profile((value) => { delete value.output; }, (file) => {
    const project = loadProject(file);
    assert.deepEqual(project.voice, { id: "af_bella", precision: "fp32", speed: 1.06, start: 0.12, language: "en-us" });
    assert.equal(project.output.duration, 25);
    assert.equal(project.output.width, 1920);
    assert.equal(project.output.height, 1080);
    assert.equal(project.output.fps, 30);
  });
});

test("source evidence must actually exist", () => {
  profile((value) => { value.facts[0].evidence = "An unsupported product claim."; }, (file) => {
    assert.throws(() => loadProject(file), /Evidence was not found/);
  });
  profile((value) => { value.facts[0].source = "missing.md"; }, (file) => {
    assert.throws(() => loadProject(file), /Fact source is missing/);
  });
});

test("invalid or misspelled settings cannot quietly fall back", () => {
  for (const [change, message] of [
    [(value) => { value.output.width = 1919; }, /must be even/],
    [(value) => { value.voice.precison = "q8"; }, /Unknown voice field/],
    [(value) => { value.voice.language = "fr"; }, /English/],
    [(value) => { value.voice.enabled = false; }, /Unknown voice field/],
    [(value) => { value.brand.palette.primary = "red;display:none"; }, /six-digit hex/],
    [(value) => { value.stateContracts[0].samples[0].assertions[0].visble = true; }, /Unknown assertion field/],
    [(value) => { value.stateContracts[0].samples[0].assertions[0] = { selector: "#missing", count: 0, visible: true }; }, /contradictory/],
    [(value) => { value.stateContracts[0].samples[0].assertions[0].contains = 42; }, /contains must be text/],
    [(value) => { value.draft = true; }, /Complete the draft/],
  ]) profile(change, (file) => assert.throws(() => loadProject(file), message));
});

test("profile hashes include pronunciation, voice and output changes", () => {
  const project = loadProject(join(fixture, "project.json"));
  const before = profileHash(project);
  assert.notEqual(profileHash({ ...project, voice: { ...project.voice, speed: 1 } }), before);
  assert.notEqual(profileHash({ ...project, pronunciations: [] }), before);
  assert.notEqual(profileHash({ ...project, output: { ...project.output, duration: 24 } }), before);
});

test("composition paths cannot escape their root", () => {
  assert.throws(() => inside(fixture, "../unrelated-product/product.md"), /leaves the composition/);
  assert.throws(() => inside(fixture, "/etc/hosts"), /leaves the composition/);
});
