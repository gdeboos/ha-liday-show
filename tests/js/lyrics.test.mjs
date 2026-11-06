import assert from "node:assert/strict";
import test from "node:test";

import { fromStarts, lineWords, lyricShapes, parseLyrics, placeLines, savedLines, savedLyrics, singingRuns, syllables, wordShapes }
  from "../../haliday_show/app/halidayshow/static/js/lyrics.js";
import { singerOf } from "../../haliday_show/app/halidayshow/static/js/phones.js";

// Singing 2-4 s and 6-8 s, quiet otherwise (20 a second).
const voice = { fps: 20, values: Array.from({ length: 200 }, (_, k) => ((k >= 40 && k < 80) || (k >= 120 && k < 160) ? 80 : 0)) };

test("lines are read, and words sized by their syllables", () => {
  const lines = parseLyrics("Run, run Rudolph\n\n  Santa's got to make it to town ");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].words, ["Run,", "run", "Rudolph"]);
  assert.equal(syllables("Rudolph"), 2);
  assert.equal(syllables("make"), 1);
  assert.deepEqual(singingRuns(voice), [[2, 4], [6, 8]]);
});

test("lines are placed across the singing, and can be moved by their starts", () => {
  const lines = placeLines(parseLyrics("one two\nthree four"), voice, 10);
  assert.equal(lines[0].start, 2);
  assert.ok(lines[0].end <= 4 + 1e-9 && lines[1].start >= 4 - 1e-9 && lines[1].end <= 8 + 1e-9);
  const words = lineWords(lines[0], voice);
  assert.ok(words.every((w) => w.start >= 2 && w.end <= 4.05));
  // The second line started by hand at 6.5 s: its words stay in the singing after it.
  const moved = fromStarts(lines, [2, 6.5], voice, 10);
  assert.equal(moved[1].start, 6.5);
  assert.equal(moved[1].end, 8);
  assert.ok(lineWords(moved[1], voice).every((w) => w.start >= 6.5));
});

test("words become mouth shapes, shut between words", () => {
  assert.deepEqual(wordShapes("moon"), ["m", "o"]);
  assert.ok(wordShapes("moon").includes("o") && wordShapes("moon")[0] === "m");
  assert.ok(wordShapes("see").includes("e"));
  assert.ok(wordShapes("dad").includes("a"));
  assert.ok(wordShapes("hmm").includes("a")); // every word opens the mouth once
  const lines = placeLines(parseLyrics("see dad"), voice, 10);
  const shapes = lyricShapes(lines, voice, 10);
  assert.equal(shapes.length, 200);
  assert.equal(shapes[10], "m"); // before the singing
  assert.ok(/[aeo]/.test(shapes.slice(40, 80)));
  // Saved and read back, and handed to the face in place of the guessed shapes.
  const saved = savedLyrics("see dad", lines, voice, 10);
  assert.equal(savedLines(saved).length, 1);
  const singer = singerOf({ voice: { ...voice, shapes: "a".repeat(200) }, lyrics: saved });
  assert.ok(singer.lyrics && singer.shapes === saved.shapes && singer.values === voice.values);
  assert.equal(singerOf({ voice }), voice);
});
