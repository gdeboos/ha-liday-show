import assert from "node:assert/strict";
import test from "node:test";

import { evenGain, evenOut, loudness, peakDb } from "../../haliday_show/app/halidayshow/static/js/loudness.js";

const rate = 48000;
const tone = (freq, amp, seconds = 5) => Float32Array.from({ length: rate * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));

test("a full-scale 1 kHz tone reads as the standard says (-3 LUFS in one channel, 0 in two)", () => {
  // BS.1770's reference: a 0 dBFS 997 Hz sine in one channel reads -3.01 LUFS; in two, +3 dB more.
  const one = loudness([tone(997, 1)], rate);
  assert.ok(Math.abs(one - -3.01) < 0.2, `one channel ${one}`);
  const two = loudness([tone(997, 1), tone(997, 1)], rate);
  assert.ok(Math.abs(two - -0.0) < 0.3, `two channels ${two}`);
});

test("halving the level is 6 dB quieter, and silence has no loudness", () => {
  const a = loudness([tone(440, 0.5)], rate), b = loudness([tone(440, 0.25)], rate);
  assert.ok(Math.abs(a - b - 6.02) < 0.1, `${a} vs ${b}`);
  assert.equal(loudness([new Float32Array(rate)], rate), -Infinity);
});

test("gaps between notes count far less than in a plain average", () => {
  const notes = tone(440, 0.5).map((v, i) => (Math.floor(i / (rate * 0.5)) % 2 ? v : 0)); // on, off, on…
  const steady = loudness([tone(440, 0.5)], rate);
  // A plain average of half silence would be 3 dB down; the gates leave out the silent stretches.
  assert.ok(steady - loudness([notes], rate) < 2, `${steady} vs ${loudness([notes], rate)}`);
});

test("evening out turns a quiet song up and a loud one down, but never past the ceiling", () => {
  assert.equal(evenGain(-20, -10), 6); // up 6 dB to -14
  assert.equal(evenGain(-8, -0.1), -6); // down to -14
  assert.equal(evenGain(-20, -3), 2, "only up to a -1 dBFS peak");
  assert.equal(evenGain(-Infinity, -Infinity), 0);
  const quiet = [tone(440, 0.05), tone(440, 0.05)];
  const { channels, gain } = evenOut(quiet, rate);
  assert.ok(gain > 0);
  assert.ok(Math.abs(loudness(channels, rate) - -14) < 0.2, `${loudness(channels, rate)}`);
  assert.ok(peakDb(channels) <= -1 + 1e-6);
});
