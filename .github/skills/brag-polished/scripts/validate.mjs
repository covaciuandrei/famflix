import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { canonicalVtt, narrationMetadata, checkCompositionContract } from "./assets.mjs";
import { checkStates } from "./state-check.mjs";
import { ENV, cli, loadProject, main, probe, profileArgument, profileHash, readJson, sha, writeJson } from "./lib.mjs";

export function compositionHash(root) {
  function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : entry.isFile() ? [{ file: relative(root, path), sha256: sha(readFileSync(path)) }] : [];
      });
  }
  return sha(JSON.stringify(files(root)));
}

export function verifyMediaContract(metadata, project) {
  const picture = metadata.streams.find((stream) => stream.codec_type === "video");
  const sound = metadata.streams.find((stream) => stream.codec_type === "audio");
  const rate = picture?.r_frame_rate?.split("/").map(Number);
  const duration = Number(metadata.format?.duration);
  const soundDuration = Number(sound?.duration);
  if (
    picture?.codec_name !== "h264" || picture?.pix_fmt !== "yuv420p" ||
    picture?.width !== project.output.width || picture?.height !== project.output.height ||
    !rate || rate[0] / rate[1] !== project.output.fps ||
    Number(picture?.nb_frames) !== project.output.duration * project.output.fps ||
    !Number.isFinite(duration) || Math.abs(duration - project.output.duration) > 0.001 ||
    !Number.isFinite(soundDuration) || Math.abs(soundDuration - project.output.duration) > 0.001 ||
    sound?.codec_name !== "aac"
  ) throw new Error("Delivered media does not match the exact duration/dimensions/fps/frame-count/H.264-yuv420p/AAC contract.");
  return { duration: Number(metadata.format.duration), width: picture.width, height: picture.height, fps: project.output.fps, frames: Number(picture.nb_frames), bytes: Number(metadata.format.size) };
}

export function verifyFaststart(bytes) {
  const atoms = [];
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error("Truncated MP4 atom header.");
    let size = bytes.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) throw new Error("Truncated extended MP4 atom.");
      const extended = bytes.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("MP4 atom is too large to validate safely.");
      size = Number(extended); header = 16;
    } else if (size === 0) size = bytes.length - offset;
    if (size < header || offset + size > bytes.length) throw new Error(`Invalid MP4 atom at ${offset}.`);
    atoms.push(bytes.toString("ascii", offset + 4, offset + 8));
    offset += size;
  }
  if (!atoms.includes("moov") || !atoms.includes("mdat") || atoms.indexOf("moov") > atoms.indexOf("mdat")) {
    throw new Error("The MP4 is not faststart: moov must precede mdat.");
  }
  return atoms;
}

function decode(file, picture = false) {
  const args = picture
    ? ["-v", "error", "-i", file, "-frames:v", "1", "-vf", "scale=64:36", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"]
    : ["-v", "error", "-i", file, "-ac", "1", "-ar", "24000", "-f", "s16le", "pipe:1"];
  const result = spawnSync("ffmpeg", args, { env: ENV, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Media decoding failed: ${result.stderr.toString()}`);
  return result.stdout;
}

export function verifyAudio(reference, delivered, cues, codecSampleRate = 48000) {
  const codecPadding = 2 * Math.ceil(24000 * 1024 / codecSampleRate);
  if (!Number.isFinite(codecPadding) || codecPadding <= 0 || Math.abs(reference.length - delivered.length) > codecPadding || delivered.length === 0) {
    throw new Error("Audio length differs by more than one AAC frame of padding; narration may be offset or trimmed.");
  }
  let peak = 0;
  let energy = 0;
  for (let offset = 0; offset < delivered.length; offset += 2) {
    const sample = delivered.readInt16LE(offset) / 32768;
    peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;
  }
  const peakDb = 20 * Math.log10(peak);
  const meanDb = 20 * Math.log10(Math.sqrt(energy / (delivered.length / 2)));
  if (!Number.isFinite(peakDb) || peakDb > -0.8 || meanDb < -32 || meanDb > -10) throw new Error(`Audio is silent, clipped or outside the safe delivery range (peak ${peakDb.toFixed(1)} dBFS, mean ${meanDb.toFixed(1)} dBFS).`);
  const windows = cues.map((cue) => {
    let xy = 0, xx = 0, yy = 0;
    const start = Math.ceil(cue.start * 24000);
    const end = Math.floor(cue.end * 24000);
    if (start < 0 || end <= start || end * 2 > delivered.length) throw new Error(`Invalid delivered audio window: ${cue.id}`);
    for (let index = start; index < end; index++) {
      const x = reference.readInt16LE(index * 2), y = delivered.readInt16LE(index * 2);
      xy += x * y; xx += x * x; yy += y * y;
    }
    const correlation = xy / Math.sqrt(xx * yy);
    if (!Number.isFinite(correlation) || correlation < 0.85) throw new Error(`Narration is missing, masked or out of sync in ${cue.id} (correlation ${correlation.toFixed(3)}).`);
    return { id: cue.id, correlation: Number(correlation.toFixed(4)) };
  });
  return { peakDb: Number(peakDb.toFixed(2)), meanDb: Number(meanDb.toFixed(2)), windows };
}

export function reviewStatus(file) {
  const required = ["scriptApproved", "visualStatesChecked", "captionReadabilityChecked", "audioDeliveryChecked", "licensesChecked"];
  if (!existsSync(file)) return { status: "required", missing: required };
  const review = readJson(file);
  const missing = required.filter((name) => review[name] !== true);
  if (typeof review.reviewer !== "string" || !review.reviewer.trim()) missing.push("reviewer");
  if (typeof review.notes !== "string" || !review.notes.trim()) missing.push("notes");
  return { status: missing.length === 0 ? "approved" : "required", missing };
}

async function validateDelivery(project, { requireReview = false, stateResults } = {}) {
  checkCompositionContract(project);
  const narration = narrationMetadata(project);
  const video = join(project.paths.workspace, "video.mp4");
  const poster = join(project.paths.workspace, "poster.jpg");
  for (const file of [video, poster, join(project.paths.workspace, "captions.vtt"), join(project.paths.workspace, "transcript.txt")]) {
    if (!existsSync(file)) throw new Error(`Missing delivery: ${file}`);
  }
  const manifestFile = join(project.paths.workspace, ".checks/render-manifest.json");
  if (!existsSync(manifestFile)) throw new Error("No render manifest. Use this toolkit to render the current composition first.");
  const manifest = readJson(manifestFile);
  if (manifest.profileHash !== profileHash(project) || manifest.compositionHash !== compositionHash(project.paths.composition)) throw new Error("The profile or composition changed after this render. Render again instead of approving stale media.");
  if (manifest.videoHash !== sha(readFileSync(video)) || manifest.posterHash !== sha(readFileSync(poster))) throw new Error("Delivered video/poster differ from the checked render.");
  const metadata = probe(video);
  const media = verifyMediaContract(metadata, project);
  verifyFaststart(readFileSync(video));
  const audio = verifyAudio(decode(join(project.paths.generated, "narration.wav")), decode(video), narration.cues, Number(metadata.streams.find((stream) => stream.codec_type === "audio").sample_rate));
  const firstFrame = decode(video, true), posterFrame = decode(poster, true);
  if (firstFrame.length !== 64 * 36 || posterFrame.length !== firstFrame.length) throw new Error("Poster/frame-zero decoding failed.");
  const difference = firstFrame.reduce((sum, value, index) => sum + Math.abs(value - posterFrame[index]), 0) / firstFrame.length;
  const average = posterFrame.reduce((sum, value) => sum + value, 0) / posterFrame.length;
  const deviation = Math.sqrt(posterFrame.reduce((sum, value) => sum + (value - average) ** 2, 0) / posterFrame.length);
  if (difference > 8 || deviation < 2) throw new Error("Frame zero does not match a non-blank selected poster.");
  const vtt = readFileSync(join(project.paths.workspace, "captions.vtt"), "utf8");
  const transcript = readFileSync(join(project.paths.workspace, "transcript.txt"), "utf8");
  if (vtt !== canonicalVtt(project, narration) || transcript !== `${project.captions.join("\n\n")}\n`) {
    throw new Error("Delivered captions/transcript differ from the measured timings or approved canonical wording. Regenerate them instead of editing around the gate.");
  }
  const states = stateResults ?? await checkStates(project, { screenshots: false });
  const review = reviewStatus(join(project.paths.workspace, "review.json"));
  const report = {
    schemaVersion: 1, product: project.name, automated: "passed", review,
    media, audio, captionCount: narration.cues.length, mismatchRatio: narration.mismatchRatio,
    pronunciation: narration.pronunciationReport, endingHold: narration.endingHold,
    states, poster: { meanDifference: Number(difference.toFixed(3)), deviation: Number(deviation.toFixed(3)) },
    profileHash: profileHash(project), localOnly: true,
  };
  writeJson(join(project.paths.workspace, "validation.json"), report);
  if (requireReview && review.status !== "approved") {
    const error = new Error(`Automated checks passed, but human review is still required: ${review.missing.join(", ")}. Do not mark an unheard/unseen delivery approved.`);
    error.name = "ReviewRequiredError";
    throw error;
  }
  console.log(`Automated gates passed: ${project.name}, ${media.duration}s, ${media.width}x${media.height}, ${media.frames} frames, ${narration.cues.length} spoken captions. Human review: ${review.status}.`);
  return report;
}

export async function validate(project, options = {}) {
  try {
    return await validateDelivery(project, options);
  } catch (error) {
    if (!(error instanceof Error && error.name === "ReviewRequiredError")) {
      writeJson(join(project.paths.workspace, "validation.json"), {
        schemaVersion: 1, product: project.name, automated: "failed",
        error: error instanceof Error ? error.message : String(error),
        profileHash: profileHash(project), localOnly: true,
      });
    }
    throw error;
  }
}

main(import.meta.url, async () => {
  const { values, positionals } = cli({ "require-review": { type: "boolean", default: false } });
  await validate(loadProject(profileArgument(positionals)), { requireReview: values["require-review"] });
});
