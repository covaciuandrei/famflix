function words(text) {
  return text.replace(/\bfamflix\b/gi, "Fam Flix").toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? [];
}

export function alignCaptions(captions, chunks, offset, duration) {
  const expected = captions.flatMap(words);
  const heard = chunks.flatMap((chunk) => {
    const [start, rawEnd] = chunk.timestamp;
    const end = rawEnd ?? duration;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > duration + 0.1) {
      throw new Error("The speech recognizer returned invalid word timings.");
    }
    return words(chunk.text).map((text) => ({ text, start, end: Math.min(end, duration) }));
  });
  if (expected.length === 0 || heard.length === 0) {
    throw new Error("Caption alignment needs both a script and recognized speech.");
  }

  const costs = Array.from({ length: expected.length + 1 }, () => new Uint16Array(heard.length + 1));
  for (let i = 0; i <= expected.length; i++) costs[i][0] = i;
  for (let j = 0; j <= heard.length; j++) costs[0][j] = j;
  for (let i = 1; i <= expected.length; i++) {
    for (let j = 1; j <= heard.length; j++) {
      costs[i][j] = Math.min(
        costs[i - 1][j] + 1,
        costs[i][j - 1] + 1,
        costs[i - 1][j - 1] + Number(expected[i - 1] !== heard[j - 1].text),
      );
    }
  }
  const mismatchRatio = costs[expected.length][heard.length] / Math.max(expected.length, heard.length);
  if (mismatchRatio > 0.18) {
    throw new Error(`The recognized narration differs too much from the script (${Math.round(mismatchRatio * 100)}%).`);
  }

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

  let wordIndex = 0;
  const cues = captions.map((text, index) => {
    const count = words(text).length;
    const timed = matches.slice(wordIndex, wordIndex + count).filter(Boolean);
    wordIndex += count;
    if (timed.length === 0) throw new Error(`No spoken words aligned with caption ${index + 1}.`);
    return {
      id: `caption-${index + 1}`,
      start: Number((timed[0].start + offset).toFixed(3)),
      end: Number((timed.at(-1).end + offset).toFixed(3)),
      text,
    };
  });
  for (let index = 0; index < cues.length; index++) {
    if (index + 1 < cues.length) cues[index].end = Math.min(cues[index].end, cues[index + 1].start);
    if (cues[index].end <= cues[index].start) throw new Error(`Caption ${index + 1} has no readable duration.`);
  }
  return { cues, mismatchRatio };
}
