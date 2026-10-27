import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reviewStatus, verifyAudio, verifyFaststart, verifyMediaContract } from "../scripts/validate.mjs";

const project = { output: { duration: 25, width: 1920, height: 1080, fps: 30 } };
const metadata = () => ({
  streams: [
    { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1920, height: 1080, r_frame_rate: "30/1", nb_frames: "750" },
    { codec_type: "audio", codec_name: "aac", duration: "25.000" },
  ],
  format: { duration: "25.000", size: "2600000" },
});

function atom(name) {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32BE(8, 0); bytes.write(name, 4);
  return bytes;
}

test("default and alternative contracts check actual dimensions, frames and durations", () => {
  assert.equal(verifyMediaContract(metadata(), project).frames, 750);
  const alternate = metadata();
  alternate.streams[0].width = 1080;
  alternate.streams[0].nb_frames = "600";
  alternate.streams[1].duration = "20";
  alternate.format.duration = "20";
  assert.equal(verifyMediaContract(alternate, { output: { duration: 20, width: 1080, height: 1080, fps: 30 } }).frames, 600);
  for (const mutate of [
    (value) => { value.streams[0].nb_frames = "749"; },
    (value) => { value.format.duration = undefined; },
    (value) => { value.streams[1].duration = undefined; },
    (value) => { value.streams[0].width = 1080; },
  ]) {
    const value = metadata(); mutate(value);
    assert.throws(() => verifyMediaContract(value, project), /does not match/);
  }
});

test("faststart is verified structurally, not by finding a moov substring", () => {
  assert.deepEqual(verifyFaststart(Buffer.concat([atom("ftyp"), atom("moov"), atom("mdat")])), ["ftyp", "moov", "mdat"]);
  assert.throws(() => verifyFaststart(Buffer.concat([atom("ftyp"), atom("mdat"), atom("moov")])), /not faststart/);
  assert.throws(() => verifyFaststart(Buffer.from("garbage moov data")), /Invalid MP4/);
});

test("silent or desynchronized speech cannot pass delivery checks", () => {
  const reference = Buffer.alloc(48000);
  for (let sample = 0; sample < 24000; sample++) reference.writeInt16LE(Math.round(Math.sin(sample * 0.1) * 4500), sample * 2);
  const cues = [{ id: "one", start: 0, end: 1 }];
  assert.equal(verifyAudio(reference, reference, cues).windows[0].correlation, 1);
  assert.throws(() => verifyAudio(reference, Buffer.alloc(reference.length), cues), /silent/);
  const wrong = Buffer.alloc(reference.length);
  for (let sample = 0; sample < 24000; sample++) wrong.writeInt16LE(Math.round(Math.sin(sample * 0.173) * 4500), sample * 2);
  assert.throws(() => verifyAudio(reference, wrong, cues), /missing, masked or out of sync/);
});

test("human review cannot be inferred from automated success", () => {
  const directory = mkdtempSync(join(tmpdir(), "brag-review-"));
  const file = join(directory, "review.json");
  try {
    assert.equal(reviewStatus(file).status, "required");
    writeFileSync(file, JSON.stringify({ scriptApproved: true }));
    assert.equal(reviewStatus(file).status, "required");
    writeFileSync(file, JSON.stringify({ scriptApproved: true, visualStatesChecked: true, captionReadabilityChecked: true, audioDeliveryChecked: true, licensesChecked: true, reviewer: "Test fixture", notes: "Synthetic approved-review schema test only." }));
    assert.equal(reviewStatus(file).status, "approved");
  } finally { rmSync(directory, { recursive: true }); }
});
