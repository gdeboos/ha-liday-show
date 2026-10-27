// How loud a song is, and evening it out: the Music editor's "Even out the volume", so song files
// made from different songs play at about the same loudness in shows and playlists.
//
// Loudness is measured as streaming services do (ITU-R BS.1770: K-weighted, gated, in LUFS), then
// the song is turned up or down to TARGET. It's never turned up so far that its loudest peak would
// pass CEILING, so nothing is distorted; a very spiky song may end up a little under the target.

export const TARGET = -14; // LUFS, as most streaming services play at
export const CEILING = -1; // dBFS: the loudest a peak may end up

// RBJ biquad coefficients for this sample rate.
function shelf(rate, f0, gainDb, q) {
  const A = 10 ** (gainDb / 40), w = (2 * Math.PI * f0) / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  const sq = 2 * Math.sqrt(A) * alpha;
  return norm([A * ((A + 1) + (A - 1) * cos + sq), -2 * A * ((A - 1) + (A + 1) * cos), A * ((A + 1) + (A - 1) * cos - sq)],
    [(A + 1) - (A - 1) * cos + sq, 2 * ((A - 1) - (A + 1) * cos), (A + 1) - (A - 1) * cos - sq]);
}
function highpass(rate, f0, q) {
  const w = (2 * Math.PI * f0) / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  return norm([(1 + cos) / 2, -(1 + cos), (1 + cos) / 2], [1 + alpha, -2 * cos, 1 - alpha]);
}
function norm(b, a) { return { b: b.map((x) => x / a[0]), a: [1, a[1] / a[0], a[2] / a[0]] }; }

function filter(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// Integrated loudness in LUFS of channels (Float32Array per channel) at rate; -Infinity for silence.
export function loudness(channels, rate) {
  // K-weighting at any sample rate (the corner frequencies and Qs pyloudnorm uses).
  const stages = [shelf(rate, 1500, 4, 1 / Math.SQRT2), highpass(rate, 38, 0.5)];
  const weighted = channels.map((ch) => stages.reduce((x, s) => filter(x, s), ch));
  // Mean square of each 400 ms block, overlapping by 75%, from running totals (so each sample is
  // added up once, not four times).
  const block = Math.round(rate * 0.4), step = Math.round(rate * 0.1), n = channels[0].length;
  const total = new Float64Array(n + 1);
  for (const w of weighted) {
    let run = 0;
    for (let i = 0; i < n; i++) { run += w[i] * w[i]; total[i + 1] += run; }
  }
  const blocks = [];
  for (let start = 0; start + block <= n; start += step) blocks.push((total[start + block] - total[start]) / block);
  if (!blocks.length && n) blocks.push(total[n] / n); // shorter than one block: measure it whole
  const lufs = (ms) => -0.691 + 10 * Math.log10(ms);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const loud = blocks.filter((ms) => lufs(ms) > -70); // absolute gate: leave out silence
  if (!loud.length) return -Infinity;
  const relative = lufs(mean(loud)) - 10; // relative gate: leave out the quiet gaps between notes
  const kept = loud.filter((ms) => lufs(ms) > relative);
  return lufs(mean(kept.length ? kept : loud));
}

export function peakDb(channels) {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  return peak ? 20 * Math.log10(peak) : -Infinity;
}

// The gain (dB) that brings a song of this loudness and peak to target without passing ceiling.
export function evenGain(lufs, peak, { target = TARGET, ceiling = CEILING } = {}) {
  if (!Number.isFinite(lufs) || !Number.isFinite(peak)) return 0;
  return Math.min(target - lufs, ceiling - peak);
}

// A copy of channels evened out: {channels, gain} (gain in dB, 0 for silence).
export function evenOut(channels, rate, opts) {
  const gain = evenGain(loudness(channels, rate), peakDb(channels), opts);
  if (Math.abs(gain) < 0.05) return { channels, gain: 0 };
  const k = 10 ** (gain / 20);
  return { channels: channels.map((ch) => ch.map((v) => v * k)), gain };
}
