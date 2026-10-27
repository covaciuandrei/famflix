import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MODEL = Object.freeze({
  voice: { id: "onnx-community/Kokoro-82M-v1.0-ONNX", revision: "1939ad2a8e416c0acfeecc08a694d14ef25f2231" },
  recognition: { id: "Xenova/whisper-tiny.en", revision: "79fb389fc764e7c395bd330e9531d9d32ada7049" },
});
export const ENV = {
  ...process.env,
  HYPERFRAMES_NO_TELEMETRY: "1",
  HF_HUB_DISABLE_TELEMETRY: "1",
  DO_NOT_TRACK: "1",
};

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text.`);
  return value.trim();
}

function number(value, label, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}.`);
  }
  return value;
}

function keys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`Unknown ${label} field(s): ${unknown.join(", ")}.`);
}

export function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function run(command, args, { cwd = TOOL_ROOT, capture = false, maxBuffer = 16 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, {
    cwd, env: ENV, encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit", maxBuffer,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") throw new Error(`Missing ${command}. Install it or add it to PATH; no alternate tool will be silently substituted.`);
    throw result.error;
  }
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}). ${capture ? result.stderr : "See its output above."}`);
  return result.stdout;
}

export function requireNode() {
  if (Number(process.versions.node.split(".")[0]) < 22) {
    throw new Error("Use Node.js 22+ or npm --prefix <skill-dir> run <command> with the installed isolated runtime; do not change the application's runtime.");
  }
}

export function cli(options = {}) {
  return parseArgs({
    allowPositionals: true,
    options,
  });
}

export function profileArgument(positionals) {
  if (positionals.length !== 1) throw new Error("Pass exactly one project.json path. See references/local-setup.md.");
  return resolve(positionals[0]);
}

export function loadProject(file, { checkSources = true } = {}) {
  const input = object(readJson(file), "Profile");
  keys(input, ["schemaVersion", "draft", "name", "tagline", "sourceRoot", "output", "voice", "brand", "captions", "pronunciations", "facts", "music", "stateContracts", "stateStyles", "frames", "demo", "compositionId"], "profile");
  if (input.schemaVersion !== 1) throw new Error("Profile schemaVersion must be 1.");
  if (input.draft) throw new Error("Complete the draft profile with real product evidence before generating a video.");
  const name = text(input.name, "name");
  const tagline = text(input.tagline, "tagline");
  const output = { duration: 25, width: 1920, height: 1080, fps: 30, ...object(input.output ?? {}, "output") };
  keys(output, ["duration", "width", "height", "fps", "posterAt", "maxEndingHold", "endingHoldReason"], "output");
  number(output.duration, "output.duration", 5, 120, true);
  for (const key of ["width", "height"]) {
    number(output[key], `output.${key}`, 240, 3840, true);
    if (output[key] % 2 !== 0) throw new Error(`output.${key} must be even for H.264/yuv420p.`);
  }
  number(output.fps, "output.fps", 15, 60, true);
  output.posterAt ??= output.duration - 2;
  output.maxEndingHold ??= 2;
  number(output.posterAt, "output.posterAt", 0, output.duration - 1 / output.fps);
  number(output.maxEndingHold, "output.maxEndingHold", 0, 5);
  if (output.maxEndingHold > 2 && !input.output?.endingHoldReason) throw new Error("A longer ending hold needs output.endingHoldReason.");

  const voice = { id: "af_bella", precision: "fp32", speed: 1.06, start: 0.12, language: "en-us", ...object(input.voice ?? {}, "voice") };
  keys(voice, ["id", "precision", "speed", "start", "language"], "voice");
  if (!/^[ab][fm]_[a-z]+$/.test(voice.id)) throw new Error("voice.id must be an explicitly selected English Kokoro voice.");
  if (!["fp32", "fp16", "q8"].includes(voice.precision)) throw new Error("Unsupported voice.precision. Default is fp32; no automatic downgrade is allowed.");
  number(voice.speed, "voice.speed", 0.65, 1.3);
  number(voice.start, "voice.start", 0, 2);
  if (!["en-us", "en-gb"].includes(voice.language)) throw new Error("This workflow currently supports English narration only.");
  if ((voice.id.startsWith("b") ? "en-gb" : "en-us") !== voice.language) throw new Error("Voice and phonemizer language must agree.");
  if (!Array.isArray(input.captions) || input.captions.length === 0) throw new Error("captions must contain the approved canonical script.");
  const captions = input.captions.map((value, index) => text(value, `captions[${index}]`));
  if (captions.some((value) => /-->|[\r\n]/.test(value))) throw new Error("Each caption must be one plain-text phrase, without VTT timing syntax.");

  const brand = object(input.brand, "brand");
  const palette = object(brand.palette, "brand.palette");
  for (const [key, value] of Object.entries(palette)) {
    if (!/^[a-z][a-z-]*$/.test(key) || !/^#[a-f\d]{6}$/i.test(value)) throw new Error("Palette entries must have simple CSS variable names and six-digit hex colors.");
  }
  for (const key of ["background", "foreground", "card", "muted", "border", "primary"]) {
    if (!/^#[a-f\d]{6}$/i.test(palette[key])) throw new Error(`brand.palette.${key} must be a six-digit hex color.`);
  }
  const font = object(brand.font, "brand.font");
  if (!/^[\w -]+$/.test(font.family)) throw new Error("brand.font.family must be a simple font-family name.");
  text(font.license, "brand.font.license");
  if (Boolean(font.package) === Boolean(font.path)) throw new Error("Choose exactly one font source: package + file, or a local path.");
  if (font.package) {
    if (!/^(@[\w-]+\/)?[\w-]+$/.test(font.package)) throw new Error("Invalid font package name.");
    text(font.file, "brand.font.file");
  }
  if (brand.logo) {
    text(brand.logo.path, "brand.logo.path");
    text(brand.logo.license, "brand.logo.license");
  }
  const workspace = dirname(resolve(file));
  const sourceRoot = resolve(workspace, input.sourceRoot ?? ".");
  const pronunciations = input.pronunciations ?? [];
  if (!Array.isArray(pronunciations)) throw new Error("pronunciations must be an array.");
  pronunciations.forEach((entry, index) => {
    object(entry, `pronunciations[${index}]`);
    text(entry.canonical, "pronunciation.canonical");
    text(entry.spoken, "pronunciation.spoken");
    if (entry.expectedPhonemes !== undefined) text(entry.expectedPhonemes, "pronunciation.expectedPhonemes");
    if (entry.recognitionAliases && (!Array.isArray(entry.recognitionAliases) || entry.recognitionAliases.some((value) => typeof value !== "string" || !value.trim()))) {
      throw new Error("recognitionAliases must contain non-empty strings.");
    }
  });
  if (!Array.isArray(input.facts) || input.facts.length === 0) throw new Error("Record at least one source-backed product fact.");
  input.facts.forEach((fact, index) => {
    object(fact, `facts[${index}]`);
    text(fact.claim, "fact.claim");
    text(fact.source, "fact.source");
    text(fact.evidence, "fact.evidence");
    if (checkSources) {
      const source = resolve(sourceRoot, fact.source);
      if (!existsSync(source)) throw new Error(`Fact source is missing: ${source}`);
      if (!readFileSync(source, "utf8").includes(fact.evidence)) throw new Error(`Evidence was not found for: ${fact.claim}`);
    }
  });
  const music = { enabled: true, gain: 0.25, cues: [], ...object(input.music ?? {}, "music") };
  if (typeof music.enabled !== "boolean") throw new Error("music.enabled must be boolean.");
  number(music.gain, "music.gain", 0, 0.35);
  if (!Array.isArray(music.cues)) throw new Error("music.cues must be an array.");
  music.cues.forEach((cue) => {
    number(cue.at, "music cue time", 0, output.duration - 0.01);
    number(cue.note, "music cue note", 24, 108, true);
  });
  if (!Array.isArray(input.stateContracts) || input.stateContracts.length === 0) throw new Error("Supply at least one leaf-scene state contract.");
  input.stateContracts.forEach((contract) => {
    object(contract, "State contract");
    text(contract.scene, "State scene");
    text(contract.timeline, "State timeline");
    if (!Array.isArray(contract.samples) || contract.samples.length === 0) throw new Error("State contracts need samples.");
    contract.samples.forEach((sample) => {
      number(sample.at, "State sample time", 0, output.duration);
      if (!Array.isArray(sample.assertions) || sample.assertions.length === 0) throw new Error("State samples need assertions.");
      sample.assertions.forEach((assertion) => {
        object(assertion, "State assertion");
        keys(assertion, ["selector", "count", "visible", "text", "contains", "notContains", "attributes"], "assertion");
        text(assertion.selector, "State selector");
        if (assertion.count !== undefined) number(assertion.count, "Assertion count", 0, 1000, true);
        if (assertion.visible !== undefined && typeof assertion.visible !== "boolean") throw new Error("Assertion visible must be boolean.");
        for (const field of ["text", "contains", "notContains"]) {
          if (assertion[field] !== undefined && typeof assertion[field] !== "string") throw new Error(`Assertion ${field} must be text.`);
        }
        if (assertion.attributes !== undefined) {
          object(assertion.attributes, "Assertion attributes");
          if (Object.values(assertion.attributes).some((value) => value !== null && typeof value !== "string")) throw new Error("Expected attribute values must be strings or null.");
        }
        if (assertion.count === 0 && (assertion.visible === true || ["text", "contains", "notContains", "attributes"].some((key) => assertion[key] !== undefined))) {
          throw new Error("A zero-count assertion cannot have contradictory visibility or element-value expectations.");
        }
        if (Object.keys(assertion).length < 2) throw new Error("Every assertion needs an explicit expected value.");
      });
    });
  });
  const styles = input.stateStyles ?? [];
  if (!Array.isArray(styles) || styles.some((value) => typeof value !== "string")) throw new Error("stateStyles must contain composition-relative CSS paths.");
  const frames = input.frames ?? [output.duration / 2, output.posterAt];
  if (!Array.isArray(frames) || frames.length === 0) throw new Error("frames must select readable review moments.");
  frames.forEach((at) => number(at, "frame time", 0, output.duration - 1 / output.fps));
  return {
    ...input, name, tagline, output, voice, captions, pronunciations, music, stateStyles: styles, frames,
    paths: { file: resolve(file), workspace, sourceRoot, composition: join(workspace, "composition"), generated: join(workspace, "composition/assets/generated") },
  };
}

export function profileHash(project) {
  const { paths, ...configuration } = project;
  return sha(JSON.stringify(configuration));
}

export function projectAsset(project, value) {
  const path = resolve(project.paths.sourceRoot, text(value, "Asset path"));
  if (!existsSync(path)) throw new Error(`Local asset is missing: ${path}`);
  return path;
}

export function fontAsset(project) {
  const font = project.brand.font;
  if (font.path) return projectAsset(project, font.path);
  const base = join(TOOL_ROOT, "node_modules", font.package);
  const file = resolve(base, font.file);
  if (isAbsolute(font.file) || !file.startsWith(`${base}${sep}`) || !existsSync(file)) {
    throw new Error(`Font package asset is missing or invalid: ${font.package}/${font.file}`);
  }
  return file;
}

export function inside(root, file) {
  const target = resolve(root, file);
  if (isAbsolute(file) || (target !== root && !target.startsWith(`${root}${sep}`))) throw new Error(`Path leaves the composition: ${file}`);
  if (!existsSync(target)) throw new Error(`Missing composition file: ${file}`);
  const actual = realpathSync(target);
  const actualRoot = realpathSync(root);
  if (actual !== actualRoot && !actual.startsWith(`${actualRoot}${sep}`)) throw new Error(`Symlink leaves the composition: ${file}`);
  return target;
}

export function probe(file) {
  return JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { capture: true }));
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function main(moduleUrl, fn) {
  if (process.argv[1] && moduleUrl === pathToFileURL(resolve(process.argv[1])).href) {
    Promise.resolve().then(() => { requireNode(); return fn(); }).catch((error) => {
      console.error(`brag-polished: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

export function relativeSource(destination, project) {
  return relative(destination, project.paths.sourceRoot) || ".";
}
