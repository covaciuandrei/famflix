import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { AutoTokenizer, StyleTextToSpeech2Model, env as inferenceEnv, pipeline } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

import { alignCaptions } from "./caption-alignment.mjs";
import { doctor } from "./doctor.mjs";
import { checkPronunciations, guardTokenizer, spokenScript } from "./phonemes.mjs";
import { ENV, MODEL, TOOL_ROOT, cli, loadProject, main, probe, profileArgument, profileHash, readJson, run, sha, writeJson } from "./lib.mjs";

const cache = join(TOOL_ROOT, ".cache");
inferenceEnv.cacheDir = join(cache, "models");
Object.assign(process.env, { HF_HUB_DISABLE_TELEMETRY: "1", HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" });

function modelArtifacts(directory = inferenceEnv.cacheDir) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return modelArtifacts(path);
    if (!entry.isFile() || !/\.(onnx|json|txt)$/.test(entry.name)) return [];
    return [{ file: relative(cache, path), sha256: sha(readFileSync(path)), bytes: statSync(path).size }];
  });
}

export async function narrate(project) {
  doctor(project);
  const text = spokenScript(project.captions, project.pronunciations);
  const pronunciationReport = await checkPronunciations(project);
  const versions = Object.fromEntries(["kokoro-js", "@huggingface/transformers", "phonemizer"].map((name) =>
    [name, readJson(join(TOOL_ROOT, "node_modules", name, "package.json")).version],
  ));
  const key = sha(JSON.stringify({ models: MODEL, versions, normalization: "sdk-guarded-v1", voice: project.voice, text })).slice(0, 20);
  const take = join(cache, "takes", `${key}.wav`);
  const takeMetadata = join(cache, "takes", `${key}.json`);
  mkdirSync(join(cache, "takes"), { recursive: true });
  mkdirSync(project.paths.generated, { recursive: true });
  let recording;
  if (!existsSync(take) || !existsSync(takeMetadata)) {
    console.log(`Recording ${project.voice.id}/${project.voice.precision} locally as one connected take.`);
    const options = { revision: MODEL.voice.revision, dtype: project.voice.precision, device: "cpu" };
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL.voice.id, { revision: MODEL.voice.revision });
    let tokens;
    const model = await StyleTextToSpeech2Model.from_pretrained(MODEL.voice.id, options);
    try {
      // Guard the public tokenizer call so SDK normalization is preserved without silent truncation.
      const narrator = new KokoroTTS(model, guardTokenizer(tokenizer, (count) => { tokens = count; }));
      if (!narrator.voices[project.voice.id]) throw new Error(`Unknown Kokoro voice: ${project.voice.id}`);
      const audio = await narrator.generate(text, { voice: project.voice.id, speed: project.voice.speed });
      await audio.save(take);
    } finally {
      await model.dispose();
    }
    if (!Number.isInteger(tokens)) throw new Error("The narrator did not run the required untruncated token-budget check.");
    if (!existsSync(take) || statSync(take).size <= 44) throw new Error("Kokoro did not produce the continuous narration take.");
    recording = { key, tokens, audioHash: sha(readFileSync(take)), models: MODEL, versions };
    writeJson(takeMetadata, recording);
  } else {
    recording = readJson(takeMetadata);
    if (recording.audioHash !== sha(readFileSync(take))) throw new Error("The cached take changed. Remove only that explicitly identified take and regenerate it after review.");
    if (recording.key !== key) throw new Error("The cached voice metadata is stale.");
  }
  const speechDuration = Number(probe(take).format.duration);
  const wordCount = text.match(/\S+/g)?.length ?? 0;
  const wordsPerMinute = wordCount / speechDuration * 60;
  if (!Number.isFinite(speechDuration) || speechDuration <= 0 || speechDuration + project.voice.start > project.output.duration - 0.15) {
    throw new Error(`The ${speechDuration}s take does not fit the ${project.output.duration}s output. Rebudget the script or explicitly adjust delivery speed, not the finished audio.`);
  }
  if (wordsPerMinute < 120 || wordsPerMinute > 210) throw new Error(`Delivery is ${wordsPerMinute.toFixed(1)} words/minute; supported range is 120–210. Review the script and pace.`);
  const endingHold = project.output.duration - speechDuration - project.voice.start;
  if (endingHold > project.output.maxEndingHold) throw new Error(`Ending hold is ${endingHold.toFixed(2)}s, over ${project.output.maxEndingHold}s. Tighten the cut or adapt the script; do not pad the outro.`);

  const wordsFile = join(cache, "takes", `${key}.words.json`);
  if (!existsSync(wordsFile)) {
    console.log("Measuring actual word timings with local Whisper.");
    const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", take, "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"], {
      cwd: TOOL_ROOT, env: ENV, maxBuffer: 16 * 1024 * 1024,
    });
    if (decoded.error) throw decoded.error;
    if (decoded.status !== 0) throw new Error(`Audio decoding failed: ${decoded.stderr.toString()}`);
    const samples = new Float32Array(decoded.stdout.length / 4);
    for (let index = 0; index < samples.length; index++) samples[index] = decoded.stdout.readFloatLE(index * 4);
    const transcriber = await pipeline("automatic-speech-recognition", MODEL.recognition.id, {
      revision: MODEL.recognition.revision, dtype: "q8", device: "cpu",
    });
    try {
      const result = await transcriber(samples, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 3 });
      if (!Array.isArray(result.chunks)) throw new Error("Whisper did not return word timestamps.");
      writeJson(wordsFile, result);
    } finally {
      await transcriber.dispose();
    }
  }
  const recognized = readJson(wordsFile);
  const { cues, mismatchRatio } = alignCaptions(
    project.captions, recognized.chunks, project.voice.start, speechDuration, project.pronunciations,
  );
  const output = join(project.paths.generated, "narration.wav");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", take,
    "-af", `aresample=48000,adelay=${Math.round(project.voice.start * 1000)}:all=1,apad,atrim=duration=${project.output.duration},loudnorm=I=-17:TP=-2:LRA=7`,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output,
  ]);
  const metadata = {
    profileHash: profileHash(project), audioHash: sha(readFileSync(output)), models: MODEL, versions,
    voice: project.voice, takeCount: 1, tokens: recording.tokens,
    speechDuration, wordsPerMinute: Number(wordsPerMinute.toFixed(1)), endingHold: Number(endingHold.toFixed(3)),
    mismatchRatio, pronunciationReport, cues, artifacts: modelArtifacts(),
  };
  writeJson(join(project.paths.generated, "narration.json"), metadata);
  console.log(`Narration verified: ${speechDuration.toFixed(2)}s, ${wordsPerMinute.toFixed(1)} wpm, ${(100 * (1 - mismatchRatio)).toFixed(1)}% script agreement.`);
  return metadata;
}

main(import.meta.url, async () => {
  const { positionals } = cli();
  await narrate(loadProject(profileArgument(positionals)));
});
