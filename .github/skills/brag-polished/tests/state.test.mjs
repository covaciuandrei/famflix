import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import test from "node:test";

import { prepareRuntime } from "../scripts/assets.mjs";
import { initialize } from "../scripts/init.mjs";
import { TOOL_ROOT, loadProject } from "../scripts/lib.mjs";
import { checkStates } from "../scripts/state-check.mjs";

function referenceWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), "brag-reference-"));
  const fixture = join(TOOL_ROOT, "fixtures/famflix-reference");
  const sourceRoot = join(fixture, "composition");
  cpSync(sourceRoot, join(directory, "composition"), {
    recursive: true,
    filter: (source) => !relative(sourceRoot, source).split(sep).some((part) => ["generated", ".hyperframes", ".thumbnails"].includes(part)),
  });
  const project = loadProject(join(fixture, "project.json"));
  project.paths.workspace = directory;
  project.paths.composition = join(directory, "composition");
  project.paths.generated = join(directory, "composition/assets/generated");
  return { directory, project };
}

test("the approved reference preserves neutral selection, watched counts and optional rating forwards and backwards", async () => {
  const { directory, project } = referenceWorkspace();
  try {
    prepareRuntime(project);
    const results = await checkStates(project, { screenshots: false });
    assert.equal(results.length, 10);
    assert.equal(results.filter((result) => result.pass === "backward").length, 5);
  } finally { rmSync(directory, { recursive: true }); }
});

test("the unrelated product is scaffolded and state-tested by the same core", async () => {
  const parent = mkdtempSync(join(tmpdir(), "brag-other-product-"));
  const destination = join(parent, "video");
  try {
    initialize(join(TOOL_ROOT, "fixtures/unrelated-product/profile-source.json"), destination);
    const project = loadProject(join(destination, "project.json"));
    assert.equal(project.output.duration, 20);
    assert.equal(project.output.width, project.output.height);
    assert.equal(project.brand.font.family, "Fraunces");
    prepareRuntime(project);
    const results = await checkStates(project, { screenshots: false });
    assert.equal(results.length, 6);
    assert.throws(() => initialize(join(TOOL_ROOT, "fixtures/unrelated-product/profile-source.json"), destination), /already exists/);
  } finally { rmSync(parent, { recursive: true }); }
});

test("an inaccurate state assertion fails instead of producing a success report", async () => {
  const { directory, project } = referenceWorkspace();
  try {
    project.stateContracts[0].samples[0].assertions[1].text = "Already checked";
    prepareRuntime(project);
    await assert.rejects(() => checkStates(project, { screenshots: false }), /expected "Already checked"/);
  } finally { rmSync(directory, { recursive: true }); }
});
