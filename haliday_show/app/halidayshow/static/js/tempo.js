// Tempo matching for layers in the Music editor: a layer's clips sped up or slowed to the song's beat,
// keeping their pitch. The stretching is WSOLA: short overlapping slices of the sound are laid down at
// the new pace, each one nudged to where it lines up best with the one before, so there's no warble.

// How much faster a clip plays (source seconds per second) to match the song's tempo. A tempo
// detected at half or double speed is taken as the nearer one, so a clip is never stretched by more
// than about 1.4 times either way.
export function speedFor(songBpm, clipBpm) {
  if (!(songBpm > 0) || !(clipBpm > 0)) return 1;
  let r = songBpm / clipBpm;
  while (r > Math.SQRT2) r /= 2;
  while (r < Math.SQRT1_2) r *= 2;
  return Math.round(r * 10000) / 10000;
}

const DECIMATE = 8;

// The channels played speed times as fast at the same pitch (a new copy; the same channels if speed
// is 1).
export function stretch(channels, rate, speed) {
  if (!channels.length || speed === 1) return channels;
  const len = channels[0].length, outLen = Math.round(len / speed);
  const N = 2 * Math.round(rate * 0.02), hs = N / 2, ha = hs * speed, tol = Math.round(rate * 0.008);
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  // A coarser mono copy, to find where slices line up quickly.
  const gl = Math.floor(len / DECIMATE), guide = new Float32Array(gl);
  for (let i = 0; i < gl; i++) {
    let v = 0;
    for (const ch of channels) for (let k = 0; k < DECIMATE; k++) v += ch[i * DECIMATE + k];
    guide[i] = v;
  }
  const out = channels.map(() => new Float32Array(outLen + N)), sum = new Float32Array(outLen + N);
  const last = Math.max(0, len - N), cl = Math.floor(hs / DECIMATE), dt = Math.floor(tol / DECIMATE);
  let prev = 0;
  for (let k = 0; k * hs < outLen; k++) {
    let pos = 0;
    if (k > 0) {
      const nominal = Math.round(k * ha), natural = Math.round((prev + hs) / DECIMATE);
      let best = -Infinity;
      pos = Math.min(last, nominal);
      for (let d = -dt; d <= dt; d++) {
        const cand = Math.round(nominal / DECIMATE) + d;
        if (cand < 0 || cand * DECIMATE > last || natural + cl > gl || cand + cl > gl) continue;
        let c = 0;
        for (let j = 0; j < cl; j++) c += guide[natural + j] * guide[cand + j];
        if (c > best) { best = c; pos = cand * DECIMATE; }
      }
    }
    prev = pos;
    const at = k * hs;
    for (let c = 0; c < out.length; c++) {
      const src = channels[c], dst = out[c];
      for (let i = 0; i < N && pos + i < len; i++) dst[at + i] += win[i] * src[pos + i];
    }
    for (let i = 0; i < N; i++) sum[at + i] += win[i];
  }
  // Even out the overlaps (the very start, under the first slice's fade-in, especially).
  return out.map((ch) => {
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) res[i] = sum[i] > 1e-3 ? ch[i] / sum[i] : ch[i];
    return res;
  });
}
