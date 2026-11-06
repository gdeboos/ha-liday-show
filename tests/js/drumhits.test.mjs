import assert from "node:assert/strict";
import test from "node:test";

import { drumHits } from "../../haliday_show/app/halidayshow/static/js/drumhits.js";

// Two bars a second: a kick on each beat, a snare between, hi-hats on the off-beats and a crash at 4 s.
function kit(secs = 8, rate = 44100) {
  const n = rate * secs, out = new Float32Array(n), beat = 0.5;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const hiss = (at, len, level, decay) => { let prev = 0; for (let i = 0; i < len && at + i < n; i++) { const v = noise(); out[at + i] += level * (v - prev) * Math.exp(-i / rate * decay); prev = v; } };
  for (let b = 0; b * beat < secs; b++) {
    const at = Math.floor(b * beat * rate);
    for (let i = 0; i < rate * 0.25 && at + i < n; i++) {
      const t = i / rate;
      if (b % 2 === 0) out[at + i] += 0.8 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-t * 30)) * t) * Math.exp(-t * 12);
      else out[at + i] += 0.5 * noise() * Math.exp(-t * 18) + 0.3 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 20);
    }
    hiss(Math.floor((b + 0.5) * beat * rate), rate * 0.05, 0.15, 80);
  }
  hiss(4 * rate, rate * 1.5, 0.3, 2);
  return out;
}

test("each drum is told apart: kicks, snares, hi-hats and a crash", () => {
  const h = drumHits(kit(), 44100);
  const near = (list, t) => list.some((x) => Math.abs(x - t) < 0.02);
  for (let s = 0; s < 8; s++) {
    assert.ok(near(h.kick, s), `a kick at ${s}`);
    assert.ok(near(h.snare, s + 0.5), `a snare at ${s + 0.5}`);
    assert.ok(!near(h.kick, s + 0.5) && !near(h.snare, s), "and not the other way round");
  }
  assert.equal(h.kick.length, 8);
  assert.equal(h.snare.length, 8);
  assert.ok(h.hat.length >= 12 && h.hat.every((t) => Math.abs(((t * 4) % 2) - 1) < 0.1), "hi-hats on the off-beats");
  assert.deepEqual(h.crash.map((t) => Math.round(t)), [4]);
  // Silence has none.
  const none = drumHits(new Float32Array(44100), 44100);
  assert.deepEqual(none, { kick: [], snare: [], hat: [], crash: [] });
});
