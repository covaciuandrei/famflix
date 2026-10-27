import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { TOOL_ROOT } from "../scripts/lib.mjs";

test("skill discovery metadata and relative references are valid", () => {
  const skill = readFileSync(join(TOOL_ROOT, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: brag-polished\n/);
  const description = skill.match(/^description: '(.*)'$/m)?.[1];
  assert.ok(description && description.length <= 1024);
  assert.ok(skill.split("\n").length < 500);
  for (const match of skill.matchAll(/\]\((\.{1,2}\/[^)]+)\)/g)) assert.ok(existsSync(join(TOOL_ROOT, match[1])), match[1]);
});

test("upstream license and attribution travel with a self-contained skill copy", () => {
  const license = readFileSync(join(TOOL_ROOT, "LICENSE"), "utf8");
  assert.match(license, /^MIT License\n/);
  assert.match(license, /Copyright \(c\) 2026 Shunit Haviv Hakimi/);
  const notices = readFileSync(join(TOOL_ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
  assert.match(notices, /\[LICENSE\]\(\.\/LICENSE\)/);
});

test("the reusable core has no app-specific identifiers or machine/session paths", () => {
  for (const file of readdirSync(join(TOOL_ROOT, "scripts")).filter((file) => file.endsWith(".mjs"))) {
    const source = readFileSync(join(TOOL_ROOT, "scripts", file), "utf8");
    assert.doesNotMatch(source, /FamFlix|FAMFLIX_AUDIO_LEVELS|\/Users\/|movie-tracker/, file);
  }
});
