import assert from "node:assert/strict";
import test from "node:test";

import { DUCK_DB, anchorAt, duckEnvelope, limit, matchGain, mixLayers, placeClips, resultTime } from "../../haliday_show/app/halidayshow/static/js/layers.js";
import { cut, insert } from "../../haliday_show/app/halidayshow/static/js/music.js";

const A = { source: "media", path: "a.mp3" }, B = { source: "media", path: "b.mp3" };
const song = [{ src: "media:a.mp3", start: 0, end: 60 }];
const refs = { "media:a.mp3": A, "media:b.mp3": B };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} != ${b}`);

test("a clip pinned to a moment in the song moves with cuts, and goes with a cut that takes it out", () => {
  const anchor = { song: A, t: 30 };
  near(resultTime(song, 0, anchor), 30);
  const p = cut(song, 0, 10, 20);
  near(resultTime(p, 0, anchor), 20, "10 s earlier after cutting before it");
  assert.equal(resultTime(cut(song, 0, 25, 35), 0, anchor), null, "cut out");
  // In a spliced-in song too.
  const spliced = insert(song, 0, 5, [{ src: "media:b.mp3", start: 0, end: 10 }]);
  near(resultTime(spliced, 0, { song: B, t: 2 }), 7);
  near(resultTime(spliced, 0, anchor), 40);
});

test("a result time maps back to its moment in the song, and round-trips", () => {
  const p = cut(song, 0.5, 10, 20);
  for (const t of [3, 9.5, 12, 40]) {
    const a = anchorAt(p, 0.5, t, refs);
    near(resultTime(p, 0.5, a), t, `at ${t}`);
  }
  assert.equal(anchorAt(p, 0.5, 9999, refs), null);
  const spliced = insert(song, 0, 5, [{ src: "media:b.mp3", start: 0, end: 10 }]);
  assert.deepEqual(anchorAt(spliced, 0, 7, refs), { song: B, t: 2 });
});

test("clips are placed, and only those still in the song", () => {
  const layers = [{ name: "Bells", gain: 0, clips: [
    { song: B, start: 0, end: 2, anchor: { song: A, t: 5 } },
    { song: B, start: 0, end: 2, anchor: { song: A, t: 15 } },
  ] }];
  assert.deepEqual(placeClips(layers, cut(song, 0, 10, 20), 0), [{ layer: 0, clip: 0, at: 5, length: 2 }]);
});

test("mixing adds each clip at its place with its gain and fades, leaving the song alone", () => {
  const rate = 100;
  const main = [new Float32Array(1000)];
  const sources = { "media:b.mp3": [new Float32Array(300).fill(0.5)] };
  const layers = [{ name: "x", gain: -6.0206, clips: [{ song: B, start: 1, end: 3, anchor: { song: A, t: 2 }, fadeIn: 0.5, gain: 0 }] }];
  const out = mixLayers(main, layers, placeClips(layers, song, 0), sources, rate);
  assert.equal(main[0][250], 0, "the song's own audio isn't changed");
  near(out[0][199], 0, "nothing before the clip");
  near(out[0][200], 0, "fades in from silence");
  near(out[0][300], 0.25, "half volume (−6 dB) once faded in");
  near(out[0][399], 0.25);
  near(out[0][400], 0, "ends after its 2 s");
});

test("the limiter keeps a loud mix under the ceiling and leaves a quiet one alone", () => {
  const rate = 1000;
  const quiet = [Float32Array.from({ length: 2000 }, (_, i) => 0.5 * Math.sin(i / 5))];
  const before = Float32Array.from(quiet[0]);
  limit(quiet, rate);
  assert.deepEqual(quiet[0], before);
  const loud = [Float32Array.from({ length: 2000 }, (_, i) => (i > 1000 && i < 1050 ? 1.6 : 0.5) * Math.sin(i / 5))];
  limit(loud, rate);
  assert.ok(Math.max(...loud[0].map(Math.abs)) <= 0.98 + 1e-6);
  near(loud[0][100], 0.5 * Math.sin(100 / 5), "untouched well before the loud bit");
});

test("a new clip sits 6 LU under the song", () => {
  assert.equal(matchGain(-14, -20), 0);
  assert.equal(matchGain(-14, -8), -12);
  assert.equal(matchGain(-14, -60), 12, "at most 12 dB up");
  assert.equal(matchGain(-Infinity, -20), 0);
});

test("a clip placed right at the end of a piece or the song is still in the song", () => {
  const p = cut(song, 0, 10, 20); // pieces 0–10 and 20–60
  for (const t of [9.9996, 10, 49.9999, 50]) {
    const a = anchorAt(p, 0, t, refs);
    assert.ok(a, `at ${t}`);
    assert.notEqual(resultTime(p, 0, a), null, `placed at ${t}`);
  }
});

test("a layer that quietens the song dips it while its clips play, smoothly, and only then", () => {
  const rate = 100, n = 1000;
  const sources = { "media:b.mp3": [new Float32Array(300).fill(0.5)] };
  const layer = (duck) => [{ name: "Voice", gain: 0, duck, clips: [{ song: B, start: 0, end: 2, anchor: { song: A, t: 4 } }] }];
  const placed = placeClips(layer(true), song, 0);
  assert.equal(duckEnvelope(layer(false), placed, sources, n, rate), null, "off by default");
  assert.equal(duckEnvelope(layer(true), placed, {}, n, rate), null, "a missing sample doesn't dip the song");
  const env = duckEnvelope(layer(true), placed, sources, n, rate);
  const dip = 10 ** (DUCK_DB / 20);
  near(env[100], 1, "untouched well before");
  near(env[400], dip, "down by the clip's start");
  near(env[599], dip, "down until its end");
  assert.ok(env[390] < 1 && env[390] > dip, "already going down just before");
  assert.ok(env[620] > dip && env[620] < 1, "coming back up after");
  near(env[900], 1, "back up well after");
  const main = [new Float32Array(n).fill(0.2)];
  const out = mixLayers(main, layer(true), placed, sources, rate);
  near(out[0][100], 0.2);
  near(out[0][500], 0.2 * dip + 0.5, "the song dipped, the clip at full volume");
});
