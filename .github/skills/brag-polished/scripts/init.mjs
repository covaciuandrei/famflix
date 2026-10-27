import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import { TOOL_ROOT, cli, escapeHtml, loadProject, main, relativeSource, writeJson } from "./lib.mjs";

export function initialize(profileFile, destination) {
  const project = loadProject(resolve(profileFile));
  const output = resolve(destination);
  if (existsSync(output)) throw new Error(`Workspace already exists: ${output}. Choose a new directory; existing work will not be overwritten.`);
  if (!project.demo) throw new Error("The starter requires demo labels/timings. Supply them or author a custom composition/workspace instead.");
  for (const name of ["title", "item", "initial", "action", "added", "confirmAction", "confirmed", "result"]) {
    if (typeof project.demo[name] !== "string" || !project.demo[name].trim()) throw new Error(`Starter demo.${name} must be non-empty text.`);
  }
  const flowDuration = project.output.duration - 7 + 0.2;
  for (const name of ["actionAt", "confirmAt"]) {
    if (!Number.isFinite(project.demo[name]) || project.demo[name] < 1 || project.demo[name] > flowDuration - 1) throw new Error(`Starter demo.${name} must fit inside the flow scene.`);
  }
  if (project.demo.confirmAt <= project.demo.actionAt + 1) throw new Error("Allow a readable hold between the demo's action and confirmation.");
  const values = {
    NAME: escapeHtml(project.name), TAGLINE: escapeHtml(project.tagline),
    FACT: escapeHtml(project.facts[0].claim), WIDTH: project.output.width, HEIGHT: project.output.height,
    DURATION: project.output.duration, FPS: project.output.fps, FLOW_DURATION: flowDuration,
    OUTRO_START: project.output.duration - 4, MUSIC_GAIN: project.music.enabled ? project.music.gain : 0,
    LAYOUT: project.output.width / project.output.height > 1.2 ? "landscape" : "stacked",
    LOGO: project.brand.logo ? `<img src="assets/generated/logo${extname(project.brand.logo.path)}" alt="">` : "",
    DEMO_TITLE: escapeHtml(project.demo.title), ITEM: escapeHtml(project.demo.item),
    INITIAL: escapeHtml(project.demo.initial), ACTION: escapeHtml(project.demo.action),
    ADDED: escapeHtml(project.demo.added), CONFIRM_ACTION: escapeHtml(project.demo.confirmAction),
    CONFIRMED: escapeHtml(project.demo.confirmed), RESULT: escapeHtml(project.demo.result),
    ACTION_AT: project.demo.actionAt, CONFIRM_AT: project.demo.confirmAt,
  };
  function materialize(source, target) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const input = join(source, entry.name);
      const file = join(target, entry.name);
      if (entry.isDirectory()) materialize(input, file);
      else {
        const content = readFileSync(input, "utf8").replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
          if (!(key in values)) throw new Error(`Unknown starter token: ${key}`);
          return String(values[key]);
        });
        writeFileSync(file, content);
      }
    }
  }
  materialize(join(TOOL_ROOT, "templates/composition"), join(output, "composition"));
  const { paths, ...configuration } = project;
  writeJson(join(output, "project.json"), { ...configuration, sourceRoot: relativeSource(output, project) });
  writeJson(join(output, "review.json"), {
    scriptApproved: false, visualStatesChecked: false, captionReadabilityChecked: false,
    audioDeliveryChecked: false, licensesChecked: false, reviewer: "", notes: "",
  });
  console.log(`Created ${relative(process.cwd(), output) || output}. Customize its scenes, then generate narration.`);
  return output;
}

main(import.meta.url, () => {
  const { values, positionals } = cli({ profile: { type: "string" }, out: { type: "string" } });
  if (positionals.length || !values.profile || !values.out) throw new Error("Usage: init.mjs --profile <completed-profile.json> --out <new-directory>");
  initialize(values.profile, values.out);
});
