import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { checkPronunciations, checkTokenBudget, guardTokenizer, spokenScript } from "../scripts/phonemes.mjs";
import { TOOL_ROOT, loadProject } from "../scripts/lib.mjs";

test("the local golden reference keeps one FAM-flicks word", async () => {
  const project = loadProject(join(TOOL_ROOT, "fixtures/famflix-reference/project.json"));
  const report = await checkPronunciations(project);
  assert.equal(report[0].phones, "f\u02c8\u00e6mfl\u026aks");
  assert.equal((report[0].phones.match(/\u02c8/g) ?? []).length, 1);
  assert.equal(project.voice.id, "af_bella");
  assert.equal(project.voice.precision, "fp32");
});

test("aliases are per-project, literal and do not replace parts of another name", () => {
  assert.equal(spokenScript(["Try A+B and A+BPro."], [{ canonical: "A+B", spoken: "A plus B" }]), "Try A plus B and A+BPro.");
  assert.equal(spokenScript(["Meet Another Product."], []), "Meet Another Product.");
});

test("the token budget is checked before accepting a truncated take", () => {
  assert.equal(checkTokenBudget({ dims: [1, 512] }), 512);
  assert.throws(() => checkTokenBudget({ dims: [1, 513] }), /will not be silently truncated/);
  let observed;
  let count;
  const tokenizer = (input, options) => { observed = { input, options }; return { input_ids: { dims: [1, 123] } }; };
  const guarded = guardTokenizer(tokenizer, (value) => { count = value; });
  guarded("actual SDK-normalized phones", { truncation: true });
  assert.equal(observed.options.truncation, false);
  assert.equal(observed.input, "actual SDK-normalized phones");
  assert.equal(count, 123);
});
