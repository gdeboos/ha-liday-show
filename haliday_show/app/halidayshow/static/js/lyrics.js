// Lyrics for the Singing face (show.lyrics): pasted in, placed across the singing automatically, and
// tweaked line by line (tap along, or type a line's start). Each word becomes mouth shapes (faces.js
// SHAPES) from its spelling, spread over the time it's sung, and those shapes are what the face uses
// (phones.js singerOf). Pure, so it can be tested in node.

export const LYRIC_FPS = 20;
const SINGING = 20; // the singer's level (0-100) counted as singing
const GAP_S = 0.3; // gaps shorter than this don't split the singing

// The lines of `text` (blank lines left out), each with its words.
export function parseLyrics(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((text) => ({ text, words: text.split(/\s+/).filter(Boolean) }));
}

// How long a word takes to sing, roughly: its syllables (groups of vowels), at least one.
export const syllables = (word) => Math.max(1, (String(word).toLowerCase().replace(/e\b/, "").match(/[aeiouy]+/g) || []).length);

// The singing in `voice` ({fps, values}), as [start, end] seconds, short gaps joined.
export function singingRuns(voice) {
  const v = voice?.values || [], fps = voice?.fps || LYRIC_FPS, runs = [];
  let from = -1;
  for (let k = 0; k <= v.length; k++) {
    const on = k < v.length && v[k] >= SINGING;
    if (on && from < 0) from = k;
    if (!on && from >= 0) {
      const run = [from / fps, k / fps];
      const last = runs[runs.length - 1];
      if (last && run[0] - last[1] < GAP_S) last[1] = run[1]; else runs.push(run);
      from = -1;
    }
  }
  return runs;
}

// The singing between `start` and `end` seconds (or all of it), clipped to that stretch.
function singingIn(runs, start, end) {
  return runs.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a);
}

// Words spread across `runs` (the singing they're sung in), each taking a share by its syllables.
// Returns [{word, start, end}].
function spread(words, runs, start, end) {
  if (!words.length) return [];
  const sung = runs.length ? runs : [[start, end]];
  const total = sung.reduce((n, [a, b]) => n + (b - a), 0);
  const weights = words.map(syllables), sum = weights.reduce((a, b) => a + b, 0);
  // Where `x` seconds of singing in falls on the song.
  const at = (x) => {
    for (const [a, b] of sung) {
      if (x <= b - a) return a + x;
      x -= b - a;
    }
    return sung[sung.length - 1][1];
  };
  let done = 0;
  return words.map((word, k) => {
    const from = at(done), to = at(done + (weights[k] / sum) * total);
    done += (weights[k] / sum) * total;
    return { word, start: from, end: Math.max(to, from + 0.05) };
  });
}

// The lines placed across all the singing in `voice` (or evenly over `duration` without it): each line
// gets [start, end] seconds, its words a share of the singing by syllables.
export function placeLines(lines, voice, duration) {
  const runs = singingRuns(voice);
  const all = lines.flatMap((l, i) => l.words.map((w) => ({ w, i })));
  const placed = spread(all.map((x) => x.w), runs, 0, duration);
  return lines.map((l, i) => {
    const mine = placed.filter((_, k) => all[k].i === i);
    return { ...l, start: mine[0]?.start ?? 0, end: mine[mine.length - 1]?.end ?? 0 };
  });
}

// A line's words over the singing between its start and end (evenly if there's none there).
export const lineWords = (line, voice) => spread(line.words, singingIn(singingRuns(voice), line.start, line.end), line.start, line.end);

// Lines given starts by hand (by tapping along, say), each ending where the next starts, or at the end
// of the singing after it; their words spread again within.
export function fromStarts(lines, starts, voice, duration) {
  const runs = singingRuns(voice);
  return lines.map((l, i) => {
    const start = starts[i], next = starts[i + 1] ?? duration;
    // It ends at the next line, or sooner when the singing stops for a while before it.
    const sung = singingIn(runs, start, next);
    const end = sung.length ? sung[sung.length - 1][1] : next;
    return { ...l, start, end: Math.max(end, start + 0.2) };
  });
}

// The mouth shapes of a word from its spelling, in order: a vowel group makes "a", "e" or "o"; m, b,
// p, f and v close the lips ("m"). Other consonants leave the mouth as it was.
export function wordShapes(word) {
  const w = String(word).toLowerCase().replace(/[^a-z']/g, "");
  const out = [];
  for (const part of w.match(/[aeiouy]+|[^aeiouy]+/g) || []) {
    if (/[aeiouy]/.test(part[0])) out.push(/^[ou]|w/.test(part) || part === "oo" ? "o" : /a/.test(part) ? "a" : "e");
    else if (/[mbpfv]/.test(part)) out.push("m");
  }
  if (!out.some((s) => s !== "m")) out.push("a"); // every word opens the mouth at least once
  return out;
}

// The mouth shapes, LYRIC_FPS a second for `duration` seconds, of the placed lines: each word's shapes
// spread over its time, "m" (shut) between words.
export function lyricShapes(lines, voice, duration) {
  const n = Math.ceil(duration * LYRIC_FPS), out = new Array(n).fill("m");
  for (const line of lines) {
    for (const { word, start, end } of lineWords(line, voice)) {
      const shapes = wordShapes(word), a = Math.floor(start * LYRIC_FPS), b = Math.max(a + 1, Math.floor(end * LYRIC_FPS));
      for (let k = a; k < b && k < n; k++) out[k] = shapes[Math.min(shapes.length - 1, Math.floor(((k - a) / (b - a)) * shapes.length))];
    }
  }
  return out.join("");
}

// show.lyrics as saved: the text, each line's start and end, and the shapes worked out from them.
export function savedLyrics(text, lines, voice, duration) {
  return { text, lines: lines.map((l) => ({ start: Math.round(l.start * 100) / 100, end: Math.round(l.end * 100) / 100 })),
    fps: LYRIC_FPS, shapes: lyricShapes(lines, voice, duration) };
}

// The saved lyrics' lines with their text again (null when the text and the saved lines don't match).
export function savedLines(lyrics) {
  const lines = parseLyrics(lyrics?.text);
  if (!lines.length || !Array.isArray(lyrics?.lines) || lyrics.lines.length !== lines.length) return null;
  return lines.map((l, i) => ({ ...l, start: Number(lyrics.lines[i].start) || 0, end: Number(lyrics.lines[i].end) || 0 }));
}
