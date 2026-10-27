import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { narrationMetadata } from "../scripts/assets.mjs";
import { compositionHash, validate } from "../scripts/validate.mjs";
import { TOOL_ROOT, loadProject, profileHash, run, sha, writeJson } from "../scripts/lib.mjs";

test("changed profiles or audio cannot reuse a verified narration manifest", () => {
  const directory = mkdtempSync(join(tmpdir(), "brag-stale-"));
  const project = loadProject(join(TOOL_ROOT, "fixtures/famflix-reference/project.json"));
  project.paths.generated = directory;
  const audio = Buffer.from("synthetic unit-test bytes, not a deliverable");
  writeFileSync(join(directory, "narration.wav"), audio);
  writeJson(join(directory, "narration.json"), {
    profileHash: profileHash(project), audioHash: sha(audio),
    cues: project.captions.map((text) => ({ text })),
  });
  try {
    assert.equal(narrationMetadata(project).cues.length, 12);
    assert.throws(() => narrationMetadata({ ...project, voice: { ...project.voice, speed: 1 } }), /profile changed/);
    writeFileSync(join(directory, "narration.wav"), "changed");
    assert.throws(() => narrationMetadata(project), /audio changed/);
  } finally { rmSync(directory, { recursive: true }); }
});

test("composition fingerprints change with authored or generated assets, not unrelated hidden reports", () => {
  const directory = mkdtempSync(join(tmpdir(), "brag-hash-"));
  try {
    writeFileSync(join(directory, "index.html"), "first");
    const first = compositionHash(directory);
    mkdirSync(join(directory, ".checks"));
    writeFileSync(join(directory, ".checks/note.json"), "{}");
    assert.equal(compositionHash(directory), first);
    writeFileSync(join(directory, "index.html"), "second");
    assert.notEqual(compositionHash(directory), first);
  } finally { rmSync(directory, { recursive: true }); }
});

test("a missing prerequisite gives an actionable failure rather than a replacement", () => {
  assert.throws(() => run("brag-polished-nonexistent-prerequisite", [], { capture: true }), /Missing .*Install it or add it to PATH/);
});

test("a failed validation replaces a stale success report with an explicit failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "brag-failed-report-"));
  const project = loadProject(join(TOOL_ROOT, "fixtures/famflix-reference/project.json"));
  project.paths.workspace = directory;
  project.paths.composition = join(directory, "missing-composition");
  writeJson(join(directory, "validation.json"), { automated: "passed" });
  try {
    await assert.rejects(() => validate(project), /Missing composition file/);
    const report = JSON.parse(readFileSync(join(directory, "validation.json"), "utf8"));
    assert.equal(report.automated, "failed");
    assert.match(report.error, /Missing composition file/);
  } finally { rmSync(directory, { recursive: true }); }
});
