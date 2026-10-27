import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { env as transformersEnv, pipeline } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

import { alignCaptions } from "./caption-alignment.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, "narration.json"), "utf8");
const script = JSON.parse(source);
const cache = join(root, ".voice");
const assets = join(root, "assets");
const model = "onnx-community/Kokoro-82M-v1.0-ONNX";
const text = script.captions.join(" ").replaceAll("FamFlix", script.spokenBrand);
const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", HF_HUB_DISABLE_TELEMETRY: "1" };
transformersEnv.cacheDir = join(cache, "models");

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr ?? ""}`);
  return result.stdout;
}

mkdirSync(cache, { recursive: true });
mkdirSync(assets, { recursive: true });
const fingerprint = createHash("sha256")
  .update(JSON.stringify([model, script.precision, script.voice, script.speed, text]))
  .digest("hex").slice(0, 12);
const file = join(cache, `presenter-${fingerprint}.wav`);
if (!existsSync(file)) {
  console.log("Recording one continuous, full-precision presenter take locally.");
  const narrator = await KokoroTTS.from_pretrained(model, { dtype: script.precision, device: "cpu" });
  const audio = await narrator.generate(text, { voice: script.voice, speed: script.speed });
  await audio.save(file);
  await narrator.model.dispose();
}
if (!existsSync(file) || statSync(file).size <= 44) throw new Error("Kokoro did not produce the presenter take.");
const duration = Number(run("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
], true).trim());
if (!Number.isFinite(duration) || duration <= 0 || duration + script.start > script.duration - 0.15) {
  throw new Error(`The ${duration}s presenter take does not fit the ${script.duration}s video. Adjust the script or delivery speed, not the finished audio.`);
}
const wordCount = text.match(/\S+/g).length;
const wordsPerMinute = wordCount / duration * 60;
if (wordsPerMinute < 150 || wordsPerMinute > 210) {
  throw new Error(`Presenter pace is ${wordsPerMinute.toFixed(1)} words/minute. Choose a clear, brisk delivery before rendering.`);
}

const wordsFile = join(cache, `presenter-${fingerprint}.words.json`);
if (!existsSync(wordsFile)) {
  console.log("Aligning captions to the continuous take with local speech recognition.");
  const decoded = spawnSync("ffmpeg", [
    "-v", "error", "-i", file, "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1",
  ], { cwd: root, env, maxBuffer: 8 * 1024 * 1024 });
  if (decoded.error) throw decoded.error;
  if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
  const samples = new Float32Array(decoded.stdout.length / 4);
  for (let index = 0; index < samples.length; index++) samples[index] = decoded.stdout.readFloatLE(index * 4);
  const transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
    dtype: "q8", device: "cpu",
  });
  try {
    const recognition = await transcriber(samples, {
      return_timestamps: "word", chunk_length_s: 30, stride_length_s: 3,
    });
    if (!Array.isArray(recognition.chunks)) throw new Error("The local recognizer did not return word timestamps.");
    writeFileSync(wordsFile, `${JSON.stringify(recognition, null, 2)}\n`);
  } finally {
    await transcriber.dispose();
  }
}
const recognition = JSON.parse(readFileSync(wordsFile, "utf8"));
const { cues, mismatchRatio } = alignCaptions(script.captions, recognition.chunks, script.start, duration);

run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y", "-i", file,
  "-af", `aresample=48000,adelay=${Math.round(script.start * 1000)}:all=1,apad,atrim=duration=${script.duration},loudnorm=I=-17:TP=-2:LRA=7`,
  "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", join(assets, "narration.wav"),
]);
writeFileSync(join(assets, "narration-cues.json"), `${JSON.stringify({
  sourceHash: createHash("sha256").update(source).digest("hex"),
  voice: script.voice,
  precision: script.precision,
  takeCount: 1,
  spokenBrand: script.spokenBrand,
  speechDuration: duration,
  wordsPerMinute: Number(wordsPerMinute.toFixed(1)),
  recognitionMismatch: Number(mismatchRatio.toFixed(4)),
  duration: script.duration,
  cues,
}, null, 2)}\n`);
console.log(`Presenter: ${script.voice}, ${script.precision}, one ${duration.toFixed(2)}s take, ${wordsPerMinute.toFixed(1)} words/minute.`);
console.log(`Speech/script agreement: ${(100 * (1 - mismatchRatio)).toFixed(1)}%. No speech text was sent to a service.`);
