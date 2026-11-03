import assert from "node:assert/strict";
import test from "node:test";

import { dipCurve } from "../../haliday_show/app/halidayshow/static/js/layers.js";
import { eqCurves } from "../../haliday_show/app/halidayshow/static/js/mixer.js";

const A = { source: "media", path: "a.mp3" }, B = { source: "media", path: "b.mp3" };
const song = [{ src: "media:a.mp3", start: 0, end: 20 }];

test("the dip under the waveform says how many dB down the song is, at a few points a second", async () => {
  const { placeClips } = await import("../../haliday_show/app/halidayshow/static/js/layers.js");
  const layers = [{ name: "Voice", gain: 0, duck: true, duckDb: 12, clips: [{ song: B, start: 0, end: 2, anchor: { song: A, t: 4 } }] }];
  const sources = { "media:b.mp3": [new Float32Array(10)] };
  const dip = dipCurve(layers, placeClips(layers, song, 0), sources, 1000, 50);
  assert.ok(Math.abs(dip[250] - 12) < 0.01, "12 dB down in the middle of the clip");
  assert.equal(dip[50], 0, "nothing well before");
  assert.equal(dipCurve([{ ...layers[0], duck: false }], placeClips(layers, song, 0), sources, 1000, 50), null);
});

test("the EQ line follows the settings in force, gliding into each change", () => {
  const eq = { bass: -6, mid: 0, treble: 3, changes: [] };
  const flat = eqCurves(eq, [], 100, 50);
  assert.equal(flat.length, 3);
  assert.equal(flat[0][10], -6);
  assert.equal(flat[2][90], 3);
  const placed = [{ at: 1, i: 0, bass: -24, mid: 0, treble: 0, glide: 0.5 }];
  const [bass] = eqCurves(eq, placed, 200, 50);
  assert.equal(bass[40], -6, "before the change");
  assert.ok(bass[62] < -6 && bass[62] > -24, "gliding");
  assert.equal(bass[100], -24, "off after it (shown at the bottom of the fader)");
});
