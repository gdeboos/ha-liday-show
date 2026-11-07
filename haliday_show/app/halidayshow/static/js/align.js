// Line up with the singing: pasted lyrics placed word by word where they're sung. A small English speech
// model (wav2vec 2.0, run in stemsworker.js) listens to the song's vocals and says, 50 times a second, how
// likely each letter is; this finds the most likely way the lyrics' letters fit those moments (CTC forced
// alignment) and gives each word its start and end. Pure, so it can be tested in node.

// The model's letters, in its order: 0 is "nothing new here" (blank), 1 is the gap between words.
export const LABELS = ["-", "|", "E", "T", "A", "O", "N", "I", "H", "S", "R", "D", "L", "U", "M", "W", "C", "F", "G", "Y",
  "P", "B", "V", "K", "'", "X", "J", "Q", "Z"];
const BLANK = 0, GAP = 1;
const INDEX = new Map(LABELS.map((l, i) => [l, i]));
export const FRAME_S = 320 / 16000; // the model's step: one row of letters every 20 ms
const MAX_CELLS = 250e6; // song frames × lyric letters: past this it needs too much memory

// A word's letters as the model's, accents dropped and anything else left out ("rock'n'roll" keeps its
// apostrophes, "2" has none).
export function letters(word) {
  return [...String(word).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()]
    .map((c) => INDEX.get(c)).filter((i) => i !== undefined && i > GAP);
}

// logp: Float32Array of frames × LABELS.length log-probabilities (each row summing to 1 as
// probabilities). lines: [{words: [string]}] (lyrics.js parseLyrics). Returns the lines with start, end and
// times ([{start, end}] per word, in seconds), or null when the lyrics can't fit (more letters than moments).
export function alignLyrics(logp, lines, { frameS = FRAME_S } = {}) {
  const width = LABELS.length, T = Math.floor(logp.length / width);
  // The letters to place, a gap between words, and which word each belongs to.
  const tokens = [], owner = [], words = [];
  lines.forEach((line, i) => line.words.forEach((word, k) => {
    const ls = letters(word), w = words.length;
    words.push({ line: i, k, n: ls.length });
    if (!ls.length) return;
    if (tokens.length) { tokens.push(GAP); owner.push(-1); }
    for (const l of ls) { tokens.push(l); owner.push(w); }
  }));
  if (!words.length) return null;
  const N = tokens.length, S = 2 * N + 1;
  if (!N || T * S > MAX_CELLS) return null;
  const label = (s) => (s & 1 ? tokens[s >> 1] : BLANK);
  // Viterbi over the CTC states (blank, letter, blank, letter, …, blank), keeping how each was reached.
  // 0: stayed, 1: from the state before, 2: skipped a blank, 3 and 4: skipped the gap between words (the
  // model doesn't always hear one, and a gap it must find would take a letter's moment instead).
  const from = new Uint8Array(T * S);
  const afterGap = (s) => (s & 1) && s >= 5 && tokens[(s >> 1) - 1] === GAP;
  let prev = new Float64Array(S).fill(-Infinity), cur = new Float64Array(S);
  prev[0] = logp[BLANK];
  prev[1] = logp[label(1)];
  for (let t = 1; t < T; t++) {
    const row = t * width, back = t * S;
    // A state can't be reached sooner than its letters allow, nor left too late to finish.
    const lo = Math.max(0, S - 4 * (T - t)), hi = Math.min(S - 1, 4 * t + 1);
    cur.fill(-Infinity);
    for (let s = lo; s <= hi; s++) {
      let best = prev[s], how = 0;
      if (s > 0 && prev[s - 1] > best) { best = prev[s - 1]; how = 1; }
      if (s > 1 && (s & 1) && tokens[s >> 1] !== tokens[(s >> 1) - 1] && prev[s - 2] > best) { best = prev[s - 2]; how = 2; }
      if (afterGap(s)) {
        if (prev[s - 3] > best) { best = prev[s - 3]; how = 3; }
        if (tokens[s >> 1] !== tokens[(s >> 1) - 2] && prev[s - 4] > best) { best = prev[s - 4]; how = 4; }
      }
      if (best === -Infinity) continue;
      cur[s] = best + logp[row + label(s)];
      from[back + s] = how;
    }
    [prev, cur] = [cur, prev];
  }
  let s = prev[S - 1] >= prev[S - 2] ? S - 1 : S - 2;
  if (prev[s] === -Infinity) return null;
  // Back through the moments: where each letter was sung.
  const first = new Int32Array(N).fill(-1), last = new Int32Array(N).fill(-1);
  for (let t = T - 1; t >= 0; t--) {
    if (s & 1) { const n = s >> 1; last[n] = Math.max(last[n], t); first[n] = t; }
    if (t > 0) s -= from[t * S + s];
  }
  // Each word from its first letter's start to its last letter's end.
  const spans = words.map(() => null);
  for (let n = 0; n < N; n++) {
    const w = owner[n];
    if (w < 0 || first[n] < 0) continue;
    const a = first[n] * frameS, b = (last[n] + 1) * frameS;
    spans[w] = spans[w] ? [Math.min(spans[w][0], a), Math.max(spans[w][1], b)] : [a, b];
  }
  // Words with no letters ("&", "2") take a moment straight after the word before.
  const SHORT = 0.05, r = (x) => Math.round(x * 1000) / 1000;
  let end = 0;
  const times = spans.map((sp) => {
    const t = sp ? { start: Math.max(sp[0], end), end: Math.max(sp[1], Math.max(sp[0], end) + SHORT) } : { start: end, end: end + SHORT };
    end = t.end;
    return { start: r(t.start), end: r(t.end) };
  });
  return lines.map((line, i) => {
    const mine = times.filter((_, w) => words[w].line === i);
    if (!mine.length) return { ...line, start: end, end: end + SHORT };
    return { ...line, start: mine[0].start, end: mine[mine.length - 1].end, times: mine };
  });
}

// The model's raw scores (frames × LABELS.length) as log-probabilities, row by row, in place.
export function logSoftmax(scores, width = LABELS.length) {
  for (let at = 0; at < scores.length; at += width) {
    let max = -Infinity;
    for (let j = 0; j < width; j++) max = Math.max(max, scores[at + j]);
    let sum = 0;
    for (let j = 0; j < width; j++) sum += Math.exp(scores[at + j] - max);
    const log = max + Math.log(sum);
    for (let j = 0; j < width; j++) scores[at + j] -= log;
  }
  return scores;
}
