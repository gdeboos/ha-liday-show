import assert from "node:assert/strict";
import test from "node:test";

import { keyFrom, keyShift, keyName } from "../../haliday_show/app/halidayshow/static/js/analysis.js";
import { shift } from "../../haliday_show/app/halidayshow/static/js/tempo.js";
import { clipSemis, placeClips, sourceKey } from "../../haliday_show/app/halidayshow/static/js/layers.js";

const rate = 11025;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
// A few seconds of chords (each a list of MIDI notes), a second each, with a little of each note's octave.
function chords(list, secs = 1) {
  const n = Math.round(rate * secs), out = new Float32Array(n * list.length);
  list.forEach((notes, k) => {
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (const m of notes) v += Math.sin((2 * Math.PI * hz(m) * i) / rate) + 0.3 * Math.sin((2 * Math.PI * hz(m) * 2 * i) / rate);
      out[k * n + i] = (v / notes.length) * 0.3;
    }
  });
  return out;
}
const C = 60;
const triad = (root, minor = false) => [root, root + (minor ? 3 : 4), root + 7];

test("a song's key is found from its harmony", () => {
  // I–IV–V–I in C major, then in A minor (i–iv–v–i), then in E♭ major.
  assert.equal(keyFrom(chords([triad(C), triad(C + 5), triad(C + 7), triad(C), triad(C + 5), triad(C)]), rate), "C major");
  assert.equal(keyFrom(chords([triad(57, true), triad(62, true), triad(64), triad(57, true), triad(57, true)]), rate), "A minor");
  assert.equal(keyFrom(chords([triad(63), triad(68), triad(70), triad(63), triad(63)]), rate), "E♭ major");
  assert.equal(keyName(1, false), "C♯ major");
});

test("matching a key moves by the fewest semitones, counting relative major and minor as the same", () => {
  assert.equal(keyShift("A minor", "C major"), 0);
  assert.equal(keyShift("D major", "C major"), -2);
  assert.equal(keyShift("B♭ major", "C major"), 2);
  assert.equal(keyShift("E minor", "C major"), keyShift("G major", "C major"), "E minor is G major's relative");
  assert.equal(Math.abs(keyShift("F♯ major", "C major")), 6);
  assert.equal(keyShift("nonsense", "C major"), 0);
  assert.equal(keyShift(null, "C major"), 0);
});

test("a pitch shift keeps the length and the speed, and moves the pitch", () => {
  const n = rate * 2, a = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate));
  const up = shift([a], rate, 1, 12)[0];
  assert.ok(Math.abs(up.length - n) < rate * 0.01, `length ${up.length}`);
  // The pitch, from the lag where the sound best matches itself.
  const pitch = (x) => { let best = 0, lag = 0; for (let l = 10; l < 60; l++) { let c = 0; for (let i = 5000; i < 15000; i++) c += x[i] * x[i + l]; if (c > best) { best = c; lag = l; } } return rate / lag; };
  assert.ok(Math.abs(pitch(up) - 440) < 10, `about 440 Hz: ${pitch(up)}`);
  const faster = shift([a], rate, 1.25, -2)[0];
  assert.ok(Math.abs(faster.length - n / 1.25) < rate * 0.01);
  assert.equal(shift([a], rate, 1, 0)[0], a, "nothing to do: the same audio");
});

test("a layer's clips are shifted by its own semitones, or to the song's key", () => {
  const A = { source: "media", path: "a.mp3" }, B = { source: "media", path: "b.mp3" };
  const clip = { song: B, start: 0, end: 2, anchor: { song: A, t: 1 }, key: "D major" };
  assert.equal(clipSemis({ matchKey: true }, clip, "C major"), -2);
  assert.equal(clipSemis({ semitones: 3 }, clip, "C major"), 3);
  assert.equal(clipSemis({}, clip, "C major"), 0);
  assert.equal(clipSemis({ matchKey: true }, { ...clip, key: undefined }, "C major"), 0, "a clip whose key isn't known stays as it is");
  const layers = [{ name: "V", gain: 0, matchKey: true, clips: [clip] }];
  const [p] = placeClips(layers, [{ src: "media:a.mp3", start: 0, end: 10 }], 0, null, "C major");
  assert.equal(p.semis, -2);
  assert.equal(sourceKey(clip, 1, -2), "media:b.mp3@1~-2");
  assert.equal(sourceKey(clip, 1, 0), "media:b.mp3");
  assert.equal(sourceKey(clip, 1.1), "media:b.mp3@1.1");
});
