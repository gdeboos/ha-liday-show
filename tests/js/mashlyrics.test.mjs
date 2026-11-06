import assert from "node:assert/strict";
import test from "node:test";

import { mashLyrics } from "../../haliday_show/app/halidayshow/static/js/music.js";

const song = [{ src: "media:a.mp3", start: 0, end: 60 }];
const base = { text: "one two\nthree four\nfive six", lines: [{ start: 5, end: 8 }, { start: 20, end: 23 }, { start: 40, end: 43 }] };
const other = { text: "la la\ndee dee", lines: [{ start: 10, end: 12, words: [{ start: 10, end: 11 }, { start: 11, end: 12 }] }, { start: 30, end: 32 }] };

test("a mashup sings the layered song's words where it plays, and the song's own elsewhere", () => {
  // The other song's 8-35 s on a layer from 15 s, at 1.25 times: its 10 s line at 16.6 s, its 30 s line at 32.6 s.
  const out = mashLyrics(base, song, 0, "media:a.mp3", { clips: [{ lyrics: other, at: 15, start: 8, end: 35, speed: 1.25 }] });
  assert.deepEqual(out.text.split("\n"), ["one two", "la la", "dee dee", "five six"]); // "three four" (20 s) is under the layer
  assert.deepEqual(out.lines[1], { start: 16.6, end: 18.2, words: [{ start: 16.6, end: 17.4 }, { start: 17.4, end: 18.2 }] });
  assert.deepEqual(out.lines[2], { start: 32.6, end: 34.2 });
});

test("the song's muted vocals take its words with them", () => {
  assert.equal(mashLyrics(base, song, 0, "media:a.mp3", { muted: true }), null);
  const some = mashLyrics(base, song, 0, "media:a.mp3", { muted: [[0, 30]] });
  assert.deepEqual(some.text.split("\n"), ["five six"]);
  // No lyrics of its own, just the layer's.
  assert.deepEqual(mashLyrics(null, song, 0, "media:a.mp3", { clips: [{ lyrics: other, at: 0, start: 0, end: 60, speed: 1 }] }).text, "la la\ndee dee");
});
