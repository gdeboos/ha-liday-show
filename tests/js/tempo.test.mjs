import assert from "node:assert/strict";
import test from "node:test";

import { speedFor, stretch } from "../../haliday_show/app/halidayshow/static/js/tempo.js";

const rate = 44100;
const sine = (f, seconds) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / rate));
// The frequency of a stretch of sound, from its upward zero crossings.
function freq(x, from, to) {
  const ups = [];
  for (let i = Math.max(1, from); i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) ups.push(i - x[i] / (x[i] - x[i - 1]));
  return ((ups.length - 1) * rate) / (ups[ups.length - 1] - ups[0]);
}

test("a clip's speed is the song's tempo over its own, taking the nearer of half or double", () => {
  assert.equal(speedFor(120, 100), 1.2);
  assert.equal(speedFor(120, 120), 1);
  assert.equal(speedFor(128, 64), 1, "a tempo found at half speed");
  assert.equal(speedFor(90, 180), 1);
  assert.equal(speedFor(100, 140), 0.7143);
  assert.equal(speedFor(100, 150), 1.3333, "rather than 0.67");
  assert.equal(speedFor(null, 120), 1, "the song has no tempo yet");
  assert.equal(speedFor(120, 0), 1);
});

test("stretching changes the length but keeps the pitch and the level", () => {
  for (const speed of [1.25, 0.8]) {
    const [out] = stretch([sine(440, 2)], rate, speed);
    assert.equal(out.length, Math.round((2 * rate) / speed), `length at ${speed}`);
    const mid = out.length >> 1;
    const f = freq(out, mid - rate / 4, mid + rate / 4);
    assert.ok(Math.abs(f - 440) < 3, `pitch at ${speed}: ${f}`);
    let peak = 0;
    for (let i = mid - 2000; i < mid + 2000; i++) peak = Math.max(peak, Math.abs(out[i]));
    assert.ok(Math.abs(peak - 0.5) < 0.05, `level at ${speed}: ${peak}`);
  }
  const same = [sine(440, 0.5)];
  assert.equal(stretch(same, rate, 1), same, "speed 1 leaves it alone");
});

test("beats land at the new tempo", () => {
  // Clicks every half second (120 BPM), played 1.25 times as fast: every 0.4 s.
  const x = new Float32Array(rate * 4);
  for (let b = 0; b < 8; b++) for (let i = 0; i < 200; i++) x[b * rate * 0.5 + i] = 0.8 * Math.sin(i / 3) * (1 - i / 200);
  const [out] = stretch([x, x], rate, 1.25);
  for (let b = 1; b < 7; b++) {
    const at = Math.round(b * 0.4 * rate);
    let near = 0, between = 0;
    for (let i = at - 900; i < at + 900; i++) near = Math.max(near, Math.abs(out[i]));
    for (let i = at + 4000; i < at + 6000; i++) between = Math.max(between, Math.abs(out[i]));
    assert.ok(near > 0.2 && between < 0.05, `beat ${b}: ${near} vs ${between}`);
  }
});
