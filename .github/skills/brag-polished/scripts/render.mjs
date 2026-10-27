import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import { prepareAssets, checkCompositionContract } from "./assets.mjs";
import { doctor } from "./doctor.mjs";
import { checkStates } from "./state-check.mjs";
import { compositionHash, validate, verifyFaststart, verifyMediaContract } from "./validate.mjs";
import { TOOL_ROOT, cli, loadProject, main, probe, profileArgument, profileHash, run, sha, writeJson } from "./lib.mjs";

async function renderDelivery(project, { prepareOnly = false } = {}) {
  const environment = doctor(project);
  prepareAssets(project);
  checkCompositionContract(project);
  if (prepareOnly) {
    console.log("Prepared local assets, canonical captions and transcript.");
    return;
  }
  const states = await checkStates(project);
  const binary = join(TOOL_ROOT, "node_modules/hyperframes/bin/hyperframes.mjs");
  run(process.execPath, [binary, "check"], { cwd: project.paths.composition });
  const raw = join(project.paths.workspace, "render.mp4");
  run(process.execPath, [
    binary, "render", "--output", raw, "--fps", String(project.output.fps),
    "--quality", "delivery", "--workers", "1",
  ], { cwd: project.paths.composition });
  const candidatePoster = join(project.paths.workspace, "poster.next.jpg");
  const candidateVideo = join(project.paths.workspace, "video.next.mp4");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-ss", String(project.output.posterAt),
    "-i", raw, "-frames:v", "1", "-q:v", "2", candidatePoster,
  ]);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-i", candidatePoster,
    "-filter_complex", "[0:v][1:v]overlay=enable='eq(n,0)'[video]",
    "-map", "[video]", "-map", "0:a:0", "-t", String(project.output.duration), "-r", String(project.output.fps),
    "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p",
    "-af", "alimiter=limit=0.84:level=false:latency=true",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", candidateVideo,
  ]);
  verifyMediaContract(probe(candidateVideo), project);
  verifyFaststart(readFileSync(candidateVideo));
  const video = join(project.paths.workspace, "video.mp4");
  const poster = join(project.paths.workspace, "poster.jpg");
  renameSync(candidateVideo, video);
  renameSync(candidatePoster, poster);
  const checks = join(project.paths.workspace, ".checks");
  mkdirSync(checks, { recursive: true });
  writeJson(join(checks, "render-manifest.json"), {
    profileHash: profileHash(project), compositionHash: compositionHash(project.paths.composition),
    videoHash: sha(readFileSync(video)), posterHash: sha(readFileSync(poster)), environment,
  });
  const report = await validate(project, { stateResults: states });
  const decoded = join(checks, "decoded");
  mkdirSync(decoded, { recursive: true });
  for (const [index, time] of project.frames.entries()) {
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-ss", String(time), "-i", video,
      "-frames:v", "1", "-q:v", "2", join(decoded, `frame-${String(index).padStart(3, "0")}.jpg`),
    ]);
  }
  const rows = Math.ceil(project.frames.length / 3);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-framerate", "1",
    "-i", join(decoded, "frame-%03d.jpg"),
    "-vf", `scale=480:-2,tile=3x${rows}`, "-frames:v", "1", join(checks, "contact-sheet.jpg"),
  ]);
  console.log(`Local delivery: ${video}\nReview frames: ${join(checks, "contact-sheet.jpg")}\nNo upload or publishing was performed.`);
  return report;
}

export async function render(project, options = {}) {
  try {
    return await renderDelivery(project, options);
  } catch (error) {
    writeJson(join(project.paths.workspace, "validation.json"), {
      schemaVersion: 1, product: project.name, automated: "failed",
      error: error instanceof Error ? error.message : String(error),
      profileHash: profileHash(project), localOnly: true,
    });
    throw error;
  }
}

main(import.meta.url, async () => {
  const { values, positionals } = cli({ prepare: { type: "boolean", default: false } });
  await render(loadProject(profileArgument(positionals)), { prepareOnly: values.prepare });
});
