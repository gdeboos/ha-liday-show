import assert from "node:assert/strict";
import test from "node:test";

import { MUTE, addPart, changesIn, emptyParts, levelAt, partChanged, partLevel, partsActive, setChange } from "../../haliday_show/app/halidayshow/static/js/songparts.js";
import { resultTime } from "../../haliday_show/app/halidayshow/static/js/layers.js";

const A = { source: "media", path: "a.mp3" };
const song = [{ src: "media:a.mp3", start: 0, end: 60 }];
const at = (t) => ({ song: A, t });

test("nothing changed plays the song as it is", () => {
  assert.equal(partsActive(null), false);
  assert.equal(partsActive(emptyParts()), false);
  assert.equal(partsActive({ gain: { drums: 0 }, muted: [], changes: [] }), false);
  assert.equal(partsActive({ gain: { drums: -3 }, muted: [], changes: [] }), true);
  assert.equal(partsActive({ gain: {}, muted: ["vocals"], changes: [] }), true);
  assert.equal(partChanged({ gain: {}, muted: ["vocals"], changes: [] }, "drums"), false);
});

test("a part's level follows its fader, its mute and its changes, ramping at their edges", () => {
  const parts = { gain: { drums: -6 }, muted: ["vocals"], changes: [{ part: "drums", gain: MUTE, from: at(10), to: at(20) }] };
  const drums = partLevel(parts, "drums", song, 0);
  assert.ok(Math.abs(levelAt(drums, 5) - 10 ** (-6 / 20)) < 1e-9);
  assert.equal(levelAt(drums, 15), 0);
  assert.ok(levelAt(drums, 9.985) > 0 && levelAt(drums, 9.985) < levelAt(drums, 5)); // half way down its ramp, just before
  assert.equal(levelAt(partLevel(parts, "vocals", song, 0), 30), 0);
  assert.equal(levelAt(partLevel(parts, "bass", song, 0), 30), 1);
  // Changes follow the song's cuts: with 0-5 cut out, the drums go quiet from 5 s to 15 s.
  const cut = [{ src: "media:a.mp3", start: 5, end: 60 }];
  const moved = partLevel(parts, "drums", cut, 0);
  assert.equal(levelAt(moved, 10), 0);
  assert.ok(levelAt(moved, 17) > 0);
});

test("a changed part is mixed back at its new level", () => {
  const rate = 1000, n = 3000;
  const song1 = [new Float32Array(n).fill(0.5)], drums = [new Float32Array(n).fill(0.2)];
  const parts = { gain: {}, muted: [], changes: [{ part: "drums", gain: MUTE, from: at(1), to: at(2) }] };
  const out = addPart([Float32Array.from(song1[0])], drums, partLevel(parts, "drums", song, 0), rate);
  assert.ok(Math.abs(out[0][500] - 0.5) < 1e-6); // untouched outside
  assert.ok(Math.abs(out[0][1500] - 0.3) < 1e-6); // the drums taken out
});

test("a new change over a stretch replaces what it overlaps of that part's, and can be taken off", () => {
  const toResult = (a) => resultTime(song, 0, a);
  let parts = setChange(emptyParts(), "drums", at(10), at(30), MUTE, toResult);
  parts = setChange(parts, "drums", at(20), at(40), MUTE, toResult);
  assert.deepEqual(parts.changes.map((c) => [c.from.t, c.to.t]).sort((x, y) => x[0] - y[0]), [[10, 20], [20, 40]]);
  parts = setChange(parts, "vocals", at(0), at(5), MUTE, toResult);
  assert.equal(changesIn(parts, "drums", 25, 26, song, 0).length, 1);
  parts = setChange(parts, "drums", at(15), at(25), null, toResult); // off between 15 and 25
  assert.deepEqual(parts.changes.filter((c) => c.part === "drums").map((c) => [c.from.t, c.to.t]).sort((x, y) => x[0] - y[0]), [[10, 15], [25, 40]]);
  assert.equal(changesIn(parts, "vocals", 0, 5, song, 0).length, 1);
});
