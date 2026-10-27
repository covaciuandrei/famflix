import { phonemize } from "phonemizer";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function spokenScript(captions, pronunciations) {
  let script = captions.join(" ");
  for (const entry of [...pronunciations].sort((a, b) => b.canonical.length - a.canonical.length)) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(entry.canonical)}(?![\\p{L}\\p{N}])`, "giu");
    script = script.replace(pattern, () => entry.spoken);
  }
  return script.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

export async function englishPhones(text, language) {
  const result = (await phonemize(text, language)).join(" ");
  // Kokoro's English vocabulary uses these phone forms (see THIRD_PARTY_NOTICES).
  return result.replaceAll("ʲ", "j").replaceAll("r", "ɹ").replaceAll("x", "k").replaceAll("ɬ", "l").trim();
}

export async function checkPronunciations(project) {
  const result = [];
  for (const entry of project.pronunciations) {
    const phones = await englishPhones(entry.spoken, project.voice.language);
    if (entry.expectedPhonemes && phones !== entry.expectedPhonemes) {
      throw new Error(`Pronunciation changed for "${entry.canonical}": expected ${entry.expectedPhonemes}, got ${phones}. Review it before recording.`);
    }
    result.push({ canonical: entry.canonical, spoken: entry.spoken, phones });
  }
  return result;
}

export function checkTokenBudget(inputIds) {
  const length = inputIds.dims.at(-1);
  if (!Number.isInteger(length) || length < 3 || length > 512) {
    throw new Error(`The continuous take has ${length} model tokens; Kokoro supports at most 512. Shorten/rebudget the approved script; it will not be silently truncated.`);
  }
  return length;
}

export function guardTokenizer(tokenizer, recordCount) {
  return new Proxy(tokenizer, {
    apply(target, receiver, args) {
      const [input, options] = args;
      const result = Reflect.apply(target, receiver, [input, { ...options, truncation: false }]);
      recordCount(checkTokenBudget(result.input_ids));
      return result;
    },
  });
}
