import assert from "node:assert/strict";
import test from "node:test";

import { FRAME_S, LABELS, alignLyrics, letters, logSoftmax } from "../../haliday_show/app/halidayshow/static/js/align.js";

// Model scores that hear `plan` ([label, frames], …): each frame sure of its label.
function heard(plan) {
  const rows = [];
  for (const [label, n] of plan) for (let k = 0; k < n; k++) rows.push(LABELS.map((l) => (l === label ? 5 : 0)));
  return logSoftmax(Float32Array.from(rows.flat()));
}

test("letters are the model's, accents dropped and symbols left out", () => {
  assert.deepEqual(letters("Noël").map((i) => LABELS[i]).join(""), "NOEL");
  assert.deepEqual(letters("rock'n'roll").map((i) => LABELS[i]).join(""), "ROCK'N'ROLL");
  assert.deepEqual(letters("2&"), []);
});

test("each word is placed where its letters are heard, with silence between", () => {
  const plan = [["-", 50], ["R", 3], ["U", 5], ["N", 2], ["-", 10], ["|", 2], ["R", 3], ["U", 4], ["N", 3], ["-", 100],
    ["H", 2], ["O", 8], ["-", 30]];
  const lines = [{ text: "Run run", words: ["Run", "run"] }, { text: "Ho", words: ["Ho"] }];
  const out = alignLyrics(heard(plan), lines);
  const at = (f) => Math.round(f * FRAME_S * 1000) / 1000;
  assert.deepEqual(out[0].times[0], { start: at(50), end: at(60) });
  assert.deepEqual(out[0].times[1], { start: at(72), end: at(82) });
  assert.deepEqual(out[1].times[0], { start: at(182), end: at(192) });
  assert.equal(out[0].start, at(50));
  assert.equal(out[0].end, at(82));
  assert.equal(out[1].start, at(182));
});

test("double letters need a blank between them, and words with no letters follow the word before", () => {
  const plan = [["-", 5], ["B", 2], ["E", 2], ["-", 1], ["E", 2], ["-", 20], ["|", 1], ["Y", 2], ["O", 2], ["U", 2], ["-", 5]];
  const out = alignLyrics(heard(plan), [{ text: "Bee & you", words: ["Bee", "&", "you"] }]);
  const [bee, amp, you] = out[0].times;
  assert.ok(Math.abs(bee.start - 5 * FRAME_S) < 1e-9 && Math.abs(bee.end - 12 * FRAME_S) < 1e-9);
  assert.ok(amp.start >= bee.end && amp.end <= you.start);
  assert.ok(Math.abs(you.start - 33 * FRAME_S) < 1e-9);
});

test("lyrics longer than the song can't fit, and nothing to place gives nothing", () => {
  assert.equal(alignLyrics(heard([["-", 3]]), [{ text: "Jingle bells", words: ["Jingle", "bells"] }]), null);
  assert.equal(alignLyrics(heard([["-", 30]]), []), null);
});
