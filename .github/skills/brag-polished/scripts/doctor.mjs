import { existsSync, statfsSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

import { TOOL_ROOT, cli, fontAsset, loadProject, main, projectAsset, requireNode, run } from "./lib.mjs";

export function doctor(project) {
  requireNode();
  const ffmpeg = run("ffmpeg", ["-version"], { capture: true }).split("\n")[0];
  const ffprobe = run("ffprobe", ["-version"], { capture: true }).split("\n")[0];
  if (!existsSync(chromium.executablePath())) throw new Error("Chromium is missing. In the skill directory run: npm exec playwright install chromium");
  if (!existsSync(join(TOOL_ROOT, "node_modules/hyperframes/bin/hyperframes.mjs"))) throw new Error("Hyperframes is missing. Run npm ci in the skill directory.");
  const disk = statfsSync(project?.paths.workspace ?? TOOL_ROOT);
  const free = Number(disk.bavail) * Number(disk.bsize);
  if (free < 2 * 1024 ** 3) throw new Error("Less than 2 GiB free disk space. Free space explicitly before downloading models/rendering; this toolkit will not delete shared files.");
  if (project) {
    fontAsset(project);
    if (project.brand.logo) projectAsset(project, project.brand.logo.path);
  }
  return { node: process.version, ffmpeg, ffprobe, chromium: chromium.executablePath(), freeGiB: Number((free / 1024 ** 3).toFixed(2)), localOnly: true };
}

main(import.meta.url, () => {
  const { positionals } = cli();
  if (positionals.length > 1) throw new Error("Usage: doctor.mjs [project.json]");
  const project = positionals[0] ? loadProject(positionals[0]) : undefined;
  console.log(JSON.stringify(doctor(project), null, 2));
});
