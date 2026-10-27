import assert from "node:assert/strict";
import test from "node:test";

import { EQ_MIN, applyEq, eqAt, faderText, gainSpans, isFlat, placeChanges } from "../../haliday_show/app/halidayshow/static/js/mixer.js";
import { cut } from "../../haliday_show/app/halidayshow/static/js/music.js";

const rate = 44100;
const A = { source: "media", path: "a.mp3" };
const song = [{ src: "media:a.mp3", start: 0, end: 60 }];
const sine = (f, seconds = 1, amp = 0.5) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / rate));
// The level of the second half (after the filters settle).
const level = (x) => { let m = 0; for (let i = x.length >> 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg ?? ""} ${a} vs ${b}`);

test("with every fader at 0 the sound is untouched, and the bands add back up to it", () => {
  assert.ok(isFlat(null) && isFlat({ bass: 0, mid: 0, treble: 0, changes: [] }));
  assert.ok(!isFlat({ bass: 0, changes: [{ anchor: { song: A, t: 1 }, treble: -3 }] }));
  const x = sine(1000);
  assert.equal(applyEq([x], rate, { bass: 0, mid: 0, treble: 0 }, [])[0], x);
  // A tiny change forces the bands to be split and joined: every frequency comes back at its level.
  for (const f of [40, 250, 1000, 3000, 9000]) {
    const out = applyEq([sine(f)], rate, { bass: 1e-9, mid: 0, treble: 0 }, [])[0];
    near(level(out), 0.5, 0.01, `${f} Hz`);
  }
});

test("each fader turns its own band up or down, and off at the bottom", () => {
  const run = (f, eq) => level(applyEq([sine(f)], rate, eq, [])[0]);
  assert.ok(run(60, { bass: EQ_MIN }) < 0.02, "bass off");
  near(run(8000, { bass: EQ_MIN }), 0.5, 0.02, "treble untouched by the bass fader");
  assert.ok(run(9000, { treble: EQ_MIN }) < 0.03, "treble off");
  near(run(1000, { mid: -6 }), 0.25, 0.02, "mid down 6 dB");
  near(run(60, { bass: 6 }), 1.0, 0.04, "bass up 6 dB");
  assert.equal(faderText(EQ_MIN), "off");
  assert.equal(faderText(3), "+3 dB");
  assert.equal(faderText(-6), "-6 dB");
});

test("changes glide to their setting, and follow cuts", () => {
  const eq = { bass: 0, mid: 0, treble: 0, changes: [
    { anchor: { song: A, t: 30 }, bass: EQ_MIN, mid: 0, treble: 0, glide: 2 },
    { anchor: { song: A, t: 15 }, bass: -6, mid: 0, treble: 0, glide: 0 },
  ] };
  const placed = placeChanges(eq, song, 0);
  assert.deepEqual(placed.map((c) => [c.at, c.i]), [[15, 1], [30, 0]], "in time order");
  assert.equal(eqAt(eq, placed, 10).bass, 0);
  assert.deepEqual(eqAt(eq, placed, 20), { bass: -6, mid: 0, treble: 0, change: 1 });
  assert.equal(eqAt(eq, placed, 31).change, 0);
  const spans = gainSpans(eq, placed, 60 * 10, 10);
  assert.deepEqual(spans.map((s) => [s.from, s.to, s.a[0], s.b[0]]), [[0, 150, 0, 0], [150, 300, -6, -6], [300, 320, -6, -60], [320, 600, -60, -60]]);
  // Cut 10–20 s: the 15 s change is gone, the 30 s one is now at 20 s.
  const after = placeChanges(eq, cut(song, 0, 10, 20), 0);
  assert.deepEqual(after.map((c) => [c.at, c.i]), [[20, 0]]);
});

test("a glide moves smoothly between settings", () => {
  const eq = { bass: 0, mid: 0, treble: 0, changes: [{ anchor: { song: A, t: 0.5 }, bass: 0, mid: -12, treble: 0, glide: 1 }] };
  const out = applyEq([sine(1000, 2.5)], rate, eq, placeChanges(eq, song, 0))[0];
  const at = (t) => { let m = 0; for (let i = Math.round(t * rate); i < Math.round((t + 0.01) * rate); i++) m = Math.max(m, Math.abs(out[i])); return m; };
  near(at(0.3), 0.5, 0.02, "before");
  near(at(1.0), 0.5 * 10 ** (-6 / 20), 0.03, "halfway in dB");
  near(at(2.0), 0.5 * 10 ** (-12 / 20), 0.02, "after");
});
