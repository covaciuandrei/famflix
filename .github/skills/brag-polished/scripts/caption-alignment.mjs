function words(text) {
  return text.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase().match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

function canonicalize(tokens, pronunciations) {
  const aliases = pronunciations.flatMap((entry, index) =>
    [entry.canonical, entry.spoken, ...(entry.recognitionAliases ?? [])].map((alias) => ({
      words: words(alias), key: `brand${index}`,
    })),
  ).sort((a, b) => b.words.length - a.words.length);
  const result = [];
  for (let index = 0; index < tokens.length;) {
    const alias = aliases.find((candidate) =>
      candidate.words.length > 0 && candidate.words.every((word, offset) => tokens[index + offset]?.text === word),
    );
    if (alias) {
      result.push({ ...tokens[index], text: alias.key, end: tokens[index + alias.words.length - 1].end });
      index += alias.words.length;
    } else {
      result.push(tokens[index++]);
    }
  }
  return result;
}

export function alignCaptions(captions, chunks, offset, duration, pronunciations = []) {
  if (!Array.isArray(chunks) || chunks.length === 0) throw new Error("Caption alignment needs recognized speech.");
  const groups = captions.map((text) => canonicalize(words(text).map((text) => ({ text })), pronunciations));
  const expected = groups.flatMap((group) => group.map((token) => token.text));
  const raw = chunks.flatMap((chunk, index) => {
    const [start, rawEnd] = chunk.timestamp ?? [];
    const end = rawEnd === null && index === chunks.length - 1 ? duration : rawEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > duration + 0.1) {
      throw new Error("The speech recognizer returned invalid word timings.");
    }
    return words(chunk.text).map((text) => ({ text, start, end: Math.min(end, duration) }));
  });
  const heard = canonicalize(raw, pronunciations);
  if (expected.length === 0 || heard.length === 0) throw new Error("Caption alignment needs a script and recognized words.");
  const costs = Array.from({ length: expected.length + 1 }, () => new Uint16Array(heard.length + 1));
  for (let i = 0; i <= expected.length; i++) costs[i][0] = i;
  for (let j = 0; j <= heard.length; j++) costs[0][j] = j;
  for (let i = 1; i <= expected.length; i++) {
    for (let j = 1; j <= heard.length; j++) {
      costs[i][j] = Math.min(
        costs[i - 1][j] + 1, costs[i][j - 1] + 1,
        costs[i - 1][j - 1] + Number(expected[i - 1] !== heard[j - 1].text),
      );
    }
  }
  const mismatchRatio = costs[expected.length][heard.length] / Math.max(expected.length, heard.length);
  if (mismatchRatio > 0.1) throw new Error(`Speech/script disagreement is ${(mismatchRatio * 100).toFixed(1)}%; maximum is 10%. Review the take and pronunciation aliases.`);

  const matches = Array(expected.length).fill(null);
  let i = expected.length;
  let j = heard.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && costs[i][j] === costs[i - 1][j - 1] + Number(expected[i - 1] !== heard[j - 1].text)) {
      matches[--i] = heard[--j];
    } else if (i > 0 && costs[i][j] === costs[i - 1][j] + 1) {
      i--;
    } else {
      j--;
    }
  }
  let cursor = 0;
  const cues = captions.map((text, index) => {
    const count = groups[index].length;
    const aligned = matches.slice(cursor, cursor + count).filter(Boolean);
    cursor += count;
    if (aligned.length === 0 || aligned.length / count < 0.6) throw new Error(`Caption ${index + 1} has insufficient spoken-word coverage.`);
    return {
      id: `caption-${index + 1}`, text,
      start: Number((aligned[0].start + offset).toFixed(3)),
      end: Number((aligned.at(-1).end + offset).toFixed(3)),
    };
  });
  cues.forEach((cue, index) => {
    if (cues[index + 1]) cue.end = Math.min(cue.end, cues[index + 1].start);
    if (cue.end <= cue.start) throw new Error(`Caption ${index + 1} has no readable duration.`);
  });
  return { cues, mismatchRatio };
}
