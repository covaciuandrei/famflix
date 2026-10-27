import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { TOOL_ROOT, fontAsset, inside, profileHash, projectAsset, readJson, sha, writeJson } from "./lib.mjs";

function score(project) {
  const rate = 48000;
  const samples = new Float64Array(project.output.duration * rate);
  const beat = 2 / 3;
  const chords = [[45, 57, 60, 64, 71], [41, 53, 57, 60, 64], [48, 55, 59, 64, 67], [43, 55, 59, 62, 69]];
  function tone(start, length, note, gain, pad = false) {
    const frequency = 440 * 2 ** ((note - 69) / 12);
    const offset = Math.floor(start * rate);
    for (let index = 0; index < Math.min(Math.floor(length * rate), samples.length - offset); index++) {
      const time = index / rate;
      const attack = Math.min(1, time / (pad ? 0.3 : 0.018));
      const release = Math.min(1, (length - time) / (pad ? 0.7 : 0.16));
      const decay = pad ? 0.8 : Math.exp(-time * 3.8);
      const phase = 2 * Math.PI * frequency * time;
      samples[offset + index] += (Math.sin(phase) + Math.sin(phase * 2) * 0.16 + Math.sin(phase * 3) * 0.045) * attack * release * decay * gain;
    }
  }
  if (project.music.enabled) {
    for (let bar = 0; bar * beat * 4 < project.output.duration; bar++) {
      const start = bar * beat * 4;
      const chord = chords[bar % chords.length];
      chord.slice(1).forEach((note) => tone(start, beat * 4 + 0.3, note, 0.018, true));
      tone(start, beat * 3.8, chord[0], 0.065, true);
      for (let step = 0; step < 4; step++) tone(start + step * beat, 0.9, chord[1 + step % 4] + 12, 0.048);
    }
    project.music.cues.forEach((cue) => tone(cue.at, 0.65, cue.note, 0.035));
  }
  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    const time = index / rate;
    samples[index] *= Math.min(1, time / 0.65, (project.output.duration - time) / 1.4);
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  const wav = Buffer.alloc(44 + samples.length * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples.length * 4, 40);
  const levels = [];
  let energy = 0;
  let frameSamples = 0;
  let frame = 0;
  const frameCount = project.output.duration * project.output.fps;
  for (let index = 0; index < samples.length; index++) {
    const sample = peak === 0 ? 0 : samples[index] / peak * 0.36;
    const spread = Math.sin(index / rate * 0.7) * 0.035;
    wav.writeInt16LE(Math.round(sample * (1 - spread) * 32767), 44 + index * 4);
    wav.writeInt16LE(Math.round(sample * (1 + spread) * 32767), 46 + index * 4);
    energy += sample * sample;
    frameSamples++;
    if (index + 1 >= Math.round((frame + 1) * rate / project.output.fps)) {
      levels.push(Math.sqrt(energy / frameSamples));
      energy = 0; frameSamples = 0; frame++;
    }
  }
  if (levels.length !== frameCount) throw new Error("Audio modulation data does not match the requested frame count.");
  const maxLevel = Math.max(...levels);
  writeFileSync(join(project.paths.generated, "score.wav"), wav);
  writeFileSync(join(project.paths.generated, "audio-levels.js"), `window.BRAG_AUDIO_LEVELS = ${JSON.stringify(levels.map((value) => maxLevel === 0 ? 0 : Number((value / maxLevel).toFixed(4))))};\n`);
}

export function narrationMetadata(project) {
  const file = join(project.paths.generated, "narration.json");
  const audio = join(project.paths.generated, "narration.wav");
  if (!existsSync(file) || !existsSync(audio)) throw new Error("Narration is missing. Run narrate.mjs with this project profile first.");
  const metadata = readJson(file);
  if (metadata.profileHash !== profileHash(project)) throw new Error("The project profile changed. Regenerate narration/captions before rendering.");
  if (metadata.audioHash !== sha(readFileSync(audio))) throw new Error("The narration audio changed since verification. Regenerate it explicitly.");
  if (metadata.cues.length !== project.captions.length || metadata.cues.some((cue, index) => cue.text !== project.captions[index])) {
    throw new Error("Narration captions do not match the approved canonical script.");
  }
  return metadata;
}

export function prepareRuntime(project) {
  if (!existsSync(project.paths.composition)) throw new Error("Composition is missing. Initialize a new workspace or provide a custom composition.");
  mkdirSync(project.paths.generated, { recursive: true });
  const font = fontAsset(project);
  copyFileSync(font, join(project.paths.generated, "project-font.woff2"));
  copyFileSync(join(TOOL_ROOT, "node_modules/gsap/dist/gsap.min.js"), join(project.paths.generated, "gsap.min.js"));
  const palette = Object.entries(project.brand.palette).map(([name, value]) => `  --${name}: ${value};`).join("\n");
  writeFileSync(join(project.paths.generated, "project.css"), `@font-face {
  font-family: "${project.brand.font.family}";
  src: url("project-font.woff2") format("woff2");
  font-weight: 100 900;
  font-display: block;
}
:root {
${palette}
  --canvas-width: ${project.output.width}px;
  --canvas-height: ${project.output.height}px;
}
* { box-sizing: border-box; }
html, body { width: var(--canvas-width); height: var(--canvas-height); margin: 0; overflow: hidden; }
body { background: var(--background); color: var(--foreground); font-family: "${project.brand.font.family}", sans-serif; }
.clip { position: absolute; }
`);
  const assets = [{ file: "project-font.woff2", sha256: sha(readFileSync(font)), license: project.brand.font.license }];
  if (project.brand.logo) {
    const source = projectAsset(project, project.brand.logo.path);
    const target = `logo${extname(source)}`;
    if (!/^\.(svg|png|jpg|jpeg|webp)$/.test(extname(source))) throw new Error("Use a local SVG, PNG, JPEG or WebP logo.");
    copyFileSync(source, join(project.paths.generated, target));
    assets.push({ file: target, sha256: sha(readFileSync(source)), license: project.brand.logo.license });
  }
  writeJson(join(project.paths.generated, "assets.json"), { profileHash: profileHash(project), assets });
}

export function prepareAssets(project) {
  const narration = narrationMetadata(project);
  prepareRuntime(project);
  score(project);
  writeFileSync(join(project.paths.workspace, "captions.vtt"), canonicalVtt(project, narration));
  writeFileSync(join(project.paths.workspace, "transcript.txt"), `${project.captions.join("\n\n")}\n`);
  return narration;
}

export function canonicalVtt(project, narration) {
  const timestamp = (seconds) => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
  let previousEnd = 0;
  const captions = narration.cues.map((cue) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previousEnd || cue.end <= cue.start || cue.end > project.output.duration) {
      throw new Error(`Caption timing is invalid: ${cue.id}`);
    }
    previousEnd = cue.end;
    return `${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}`;
  });
  return `WEBVTT\n\n${captions.join("\n\n")}\n`;
}

export function checkCompositionContract(project) {
  const file = inside(project.paths.composition, "index.html");
  const html = readFileSync(file, "utf8");
  const id = project.compositionId ?? "main";
  if (!/^[\w-]+$/.test(id)) throw new Error("compositionId must be a simple id.");
  const root = html.match(new RegExp(`<[^>]+data-composition-id=["']${id}["'][^>]*>`))?.[0];
  if (!root) throw new Error(`Composition root "${id}" is missing.`);
  for (const [attribute, value] of Object.entries({
    "data-duration": project.output.duration, "data-width": project.output.width,
    "data-height": project.output.height, "data-fps": project.output.fps,
  })) {
    const actual = root.match(new RegExp(`${attribute}=["']([^"']+)["']`))?.[1];
    if (Number(actual) !== value) throw new Error(`Composition ${attribute} is ${actual}; the profile requires ${value}. Retiming must update the composition, not only the MP4.`);
  }
  const audio = html.match(/<audio\b[^>]*\bid=["']narration["'][^>]*>/)?.[0];
  if (!audio || !audio.includes("assets/generated/narration.wav")) throw new Error("The root must include the verified local narration track.");
  for (const [key, value] of [["data-start", 0], ["data-duration", project.output.duration], ["data-volume", 1]]) {
    if (Number(audio.match(new RegExp(`${key}=["']([^"']+)["']`))?.[1]) !== value) throw new Error(`Narration ${key} must be ${value}; do not trim, stretch or offset the verified take.`);
  }
  if (/data-playback-rate=/.test(audio)) throw new Error("Do not time-stretch the verified narration track.");
  if (project.music.enabled) {
    const music = html.match(/<audio\b[^>]*\bid=["']score["'][^>]*>/)?.[0];
    if (!music || !music.includes("assets/generated/score.wav")) throw new Error("The declared music bed is missing from the composition.");
    const gain = Number(music.match(/data-volume=["']([^"']+)["']/)?.[1]);
    if (gain !== project.music.gain) throw new Error(`Music gain must match the profile (${project.music.gain}).`);
  }
  return { root: id, duration: project.output.duration, frames: project.output.duration * project.output.fps };
}
