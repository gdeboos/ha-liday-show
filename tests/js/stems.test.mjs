import assert from "node:assert/strict";
import test from "node:test";

import { MDX, chunkSound, chunkSpectrum, dft, separate, tools } from "../../haliday_show/app/halidayshow/static/js/stems.js";

test("the any-length transform matches a plain DFT", () => {
  const n = 15, re = Float64Array.from({ length: n }, (_, i) => Math.sin(i) + i / 7), im = new Float64Array(n);
  const want = [...Array(n).keys()].map((k) => {
    let r = 0, i = 0;
    for (let j = 0; j < n; j++) { const a = (-2 * Math.PI * j * k) / n; r += re[j] * Math.cos(a); i += re[j] * Math.sin(a); }
    return [r, i];
  });
  const r2 = Float64Array.from(re), i2 = Float64Array.from(im);
  dft(n)(r2, i2);
  for (let k = 0; k < n; k++) { assert.ok(Math.abs(r2[k] - want[k][0]) < 1e-9); assert.ok(Math.abs(i2[k] - want[k][1]) < 1e-9); }
  dft(n, true)(r2, i2);
  for (let k = 0; k < n; k++) assert.ok(Math.abs(r2[k] / n - re[k]) < 1e-9);
});

test("a chunk's spectrum turns back into the same sound, each channel its own", () => {
  const len = MDX.hop * (MDX.dimT - 1), rate = MDX.rate;
  const L = Float32Array.from({ length: len }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));
  const R = Float32Array.from({ length: len }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 1234 * i) / rate + 1));
  const t = tools();
  const spec = chunkSpectrum(L, R, t);
  assert.equal(spec.length, 4 * MDX.dimF * MDX.dimT);
  const [l, r] = chunkSound(spec, t);
  let worst = 0; // the edges (half a window each side) are thrown away when splitting, so they don't count
  for (let i = MDX.nFft / 2; i < len - MDX.nFft / 2; i++) worst = Math.max(worst, Math.abs(l[i] - L[i]), Math.abs(r[i] - R[i]));
  assert.ok(worst < 1e-5, `back within ${worst}`);
});

test("splitting gives vocals and music as long as the song, which add back up to it", async () => {
  const n = 50000, L = Float32Array.from({ length: n }, (_, i) => Math.sin(i / 20) * 0.4), R = Float32Array.from(L);
  let calls = 0;
  const half = async (spec) => { calls++; return spec.map((v) => v * 0.5); }; // a stand-in model: "half is vocals"
  const progress = [];
  const { vocals, music } = await separate(L, R, half, (p) => progress.push(p));
  assert.equal(vocals[0].length, n);
  assert.equal(calls, 1);
  assert.deepEqual(progress, [1]);
  for (const i of [1000, 25000, 49000]) {
    assert.ok(Math.abs(vocals[0][i] - L[i] * 0.5 * MDX.compensate) < 2e-3);
    assert.ok(Math.abs(vocals[0][i] + music[0][i] - L[i]) < 1e-6);
  }
});

test("the halves are named after the song, and saved as 16-bit WAV", async () => {
  const { stemNames, wav16 } = await import("../../haliday_show/app/halidayshow/static/js/splitvocals.js");
  assert.deepEqual(stemNames("haliday_show/Rock/Jingle Bells.mp3"), { vocals: "Jingle Bells (vocals).wav", music: "Jingle Bells (music).wav" });
  const buf = wav16([Float32Array.of(0, 1, -1), Float32Array.of(0.5, 0, 2)], 44100), v = new DataView(buf);
  assert.equal(buf.byteLength, 44 + 3 * 2 * 2);
  assert.equal(String.fromCharCode(...new Uint8Array(buf, 0, 4)), "RIFF");
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getInt16(44 + 4, true), 32767); // full scale
  assert.equal(v.getInt16(44 + 10, true), 32767); // clipped, not wrapped
  assert.equal(v.getInt16(44 + 8, true), -32768);
});

test("every part's model has a window the transforms can take, and a power of two is done directly", async () => {
  const { MODELS } = await import("../../haliday_show/app/halidayshow/static/js/stems.js");
  for (const m of Object.values(MODELS)) {
    const len = m.hop * (m.dimT - 1), L = Float32Array.from({ length: len }, (_, i) => Math.sin(i / 7)), R = Float32Array.from(L, (v) => v / 2);
    const t = tools(m), spec = chunkSpectrum(L, R, t, m);
    assert.equal(spec.length, 4 * m.dimF * m.dimT);
    const [l] = chunkSound(spec, t, m);
    // Only the bins the model sees come back, so the low sine survives.
    let worst = 0;
    for (let i = m.nFft / 2; i < len - m.nFft / 2; i += 97) worst = Math.max(worst, Math.abs(l[i] - L[i]));
    assert.ok(worst < 1e-3, `${m.file}: ${worst}`);
  }
  const re = Float64Array.from({ length: 8 }, (_, i) => i), im = new Float64Array(8);
  dft(8)(re, im);
  assert.ok(Math.abs(re[0] - 28) < 1e-9);
});

test("with helpers working ahead, the split comes out the same, in order, and the model runs one chunk at a time", async () => {
  const { localMaths, MODELS } = await import("../../haliday_show/app/halidayshow/static/js/stems.js");
  const m = MODELS.drums, n = 44100 * 40;
  const L = Float32Array.from({ length: n }, (_, i) => Math.sin(i / 30) * 0.3 + Math.sin(i / 7) * 0.1), R = Float32Array.from(L, (v) => v * 0.8);
  const model = async (spec) => spec.map((v, i) => v * (0.3 + (i % 5) / 10));
  const plain = await separate(L.slice(), R.slice(), model, () => {}, m);
  // Helpers answering out of order, at random speeds.
  const local = localMaths(m), wait = () => new Promise((r) => setTimeout(r, Math.random() * 15));
  let inside = 0, most = 0, maxAhead = 0, spectraOut = 0;
  const maths = {
    ahead: 3,
    spectrum: async (l, r) => { spectraOut++; maxAhead = Math.max(maxAhead, spectraOut); await wait(); const s = await local.spectrum(l, r); return s; },
    sound: async (spec) => { await wait(); return local.sound(spec); },
  };
  const run = async (spec) => { spectraOut--; inside++; most = Math.max(most, inside); await wait(); const out = await model(spec); inside--; return out; };
  const progress = [];
  const piped = await separate(L.slice(), R.slice(), run, (p) => progress.push(p), m, maths);
  assert.equal(most, 1);
  assert.ok(maxAhead <= 4 && maxAhead >= 2, `spectra worked out ahead: ${maxAhead}`); // three waiting, plus the one the model is on
  assert.equal(progress.at(-1), 1);
  for (let i = 0; i < n; i += 1013) {
    assert.equal(piped.vocals[0][i], plain.vocals[0][i]);
    assert.equal(piped.music[1][i], plain.music[1][i]);
  }
});

test("the progress line says where the split runs", async () => {
  const { routeWords } = await import("../../haliday_show/app/halidayshow/static/js/splitvocals.js");
  assert.match(routeWords("gpu"), /graphics chip/);
  assert.match(routeWords("cpu"), /processor.*closing other apps/);
  assert.equal(routeWords(undefined), "");
});
