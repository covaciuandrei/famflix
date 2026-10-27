import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const assets = join(root, "assets");
const output = resolve(root, "../../public/video");
const cli = join(root, "node_modules/hyperframes/bin/hyperframes.mjs");
const narrationSource = readFileSync(join(root, "narration.json"), "utf8");
const duration = JSON.parse(narrationSource).duration;
const fps = 30;
const sampleRate = 48_000;
const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" };

if (!Number.isSafeInteger(duration) || duration <= 0) {
  throw new Error("The narration script must specify a positive, whole-second video duration.");
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr ?? ""}`);
  }
  return result.stdout;
}

function createScore() {
  const samples = new Float64Array(duration * sampleRate);
  const beat = 2 / 3;
  const chords = [
    [45, 57, 60, 64, 71],
    [41, 53, 57, 60, 64],
    [48, 55, 59, 64, 67],
    [43, 55, 59, 62, 69],
  ];

  function tone(start, length, midi, level, voice = "keys") {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const count = Math.min(Math.floor(length * sampleRate), samples.length - Math.floor(start * sampleRate));
    const offset = Math.floor(start * sampleRate);
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      const attack = Math.min(1, t / (voice === "pad" ? 0.3 : 0.018));
      const release = Math.min(1, (length - t) / (voice === "pad" ? 0.7 : 0.16));
      const decay = voice === "pad" ? 0.8 : Math.exp(-t * 3.8);
      const phase = 2 * Math.PI * frequency * t;
      const wave = Math.sin(phase) + Math.sin(phase * 2) * 0.16 + Math.sin(phase * 3) * 0.045;
      samples[offset + i] += wave * attack * release * decay * level;
    }
  }

  for (let bar = 0; bar * beat * 4 < duration; bar++) {
    const start = bar * beat * 4;
    const chord = chords[bar % chords.length];
    for (const note of chord.slice(1)) tone(start, beat * 4 + 0.3, note, 0.018, "pad");
    tone(start, beat * 3.8, chord[0], 0.065, "pad");
    for (let step = 0; step < 4; step++) {
      tone(start + step * beat, 0.9, chord[1 + step % 4] + 12, 0.048);
    }
  }

  for (const [start, midi] of [[3.525, 81], [4.0875, 84], [6.0375, 83], [7.65, 88], [9.4125, 81], [9.6, 84], [9.7875, 88], [14.175, 83], [15, 88], [20.43, 76]]) {
    tone(start, 0.65, midi, 0.035);
  }

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    samples[i] *= Math.min(1, t / 0.65, (duration - t) / 1.4);
    peak = Math.max(peak, Math.abs(samples[i]));
  }

  const wav = Buffer.alloc(44 + samples.length * 4);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length * 4, 40);

  const levels = [];
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] / peak * 0.36;
    const spread = Math.sin(i / sampleRate * 0.7) * 0.035;
    wav.writeInt16LE(Math.round(sample * (1 - spread) * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(sample * (1 + spread) * 32767), 46 + i * 4);
    energy += sample * sample;
    if ((i + 1) % (sampleRate / fps) === 0) {
      levels.push(Math.sqrt(energy / (sampleRate / fps)));
      energy = 0;
    }
  }
  const maxLevel = Math.max(...levels);
  writeFileSync(join(assets, "score.wav"), wav);
  writeFileSync(
    join(assets, "audio-levels.js"),
    `window.FAMFLIX_AUDIO_LEVELS = ${JSON.stringify(levels.map((level) => Number((level / maxLevel).toFixed(4))))};\n`,
  );
}

function createCaptions() {
  const audio = join(assets, "narration.wav");
  const cueFile = join(assets, "narration-cues.json");
  if (!existsSync(audio) || !existsSync(cueFile)) {
    throw new Error("Narration is missing. Run npm run voice before rendering the intro.");
  }
  const narration = JSON.parse(readFileSync(cueFile, "utf8"));
  if (narration.sourceHash !== createHash("sha256").update(narrationSource).digest("hex")) {
    throw new Error("The narration script changed. Run npm run voice to update the speech and captions.");
  }
  function timestamp(seconds) {
    return new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
  }
  const captions = narration.cues.map((cue) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > duration) {
      throw new Error(`Invalid narration cue: ${cue.id}`);
    }
    return `${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}`;
  });
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "famflix-intro.vtt"), `WEBVTT\n\n${captions.join("\n\n")}\n`);
}

mkdirSync(assets, { recursive: true });
copyFileSync(join(root, "node_modules/gsap/dist/gsap.min.js"), join(assets, "gsap.min.js"));
copyFileSync(
  join(root, "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"),
  join(assets, "geist.woff2"),
);
copyFileSync(resolve(root, "../../public/icon.svg"), join(assets, "icon.svg"));
createScore();
createCaptions();

if (!process.argv.includes("--prepare")) {
  run(process.execPath, [cli, "check"]);
  run(process.execPath, [
    cli, "render", "--output", "render.mp4", "--fps", String(fps),
    "--quality", "delivery", "--workers", "1",
  ]);

  mkdirSync(output, { recursive: true });
  const poster = join(output, "famflix-intro.jpg");
  const video = join(output, "famflix-intro.mp4");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-ss", String(duration - 2),
    "-i", join(root, "render.mp4"), "-frames:v", "1", "-q:v", "2", poster,
  ]);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", join(root, "render.mp4"), "-i", poster,
    "-filter_complex", "[0:v][1:v]overlay=enable='eq(n,0)'[video]",
    "-map", "[video]", "-map", "0:a:0", "-t", String(duration), "-r", String(fps),
    "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", video,
  ]);

  const metadata = JSON.parse(run("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", video,
  ], true));
  const picture = metadata.streams.find((stream) => stream.codec_type === "video");
  const sound = metadata.streams.find((stream) => stream.codec_type === "audio");
  if (
    picture?.width !== 1920 || picture?.height !== 1080 ||
    Number(picture.nb_frames) !== duration * fps ||
    Math.abs(Number(metadata.format.duration) - duration) > 0.001 ||
    picture.codec_name !== "h264" || sound?.codec_name !== "aac"
  ) {
    throw new Error(`The rendered intro does not meet the delivery contract:\n${JSON.stringify(metadata, null, 2)}`);
  }
  const bytes = readFileSync(video);
  const atoms = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (size < 8 || offset + size > bytes.length) {
      throw new Error(`Invalid MP4 atom at byte ${offset}.`);
    }
    atoms.push(bytes.toString("ascii", offset + 4, offset + 8));
    offset += size;
  }
  if (!atoms.includes("moov") || atoms.indexOf("moov") > atoms.indexOf("mdat")) {
    throw new Error("The MP4 metadata must precede the media for faststart playback.");
  }
  console.log(`Verified: ${duration}s, 1920x1080, ${duration * fps} frames, H.264/AAC.`);
  console.log(`Video: ${video}\nPoster: ${poster}`);
}
