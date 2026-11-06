// Drum hits, found in a song's drums part (Split into parts): when each kick, snare, hi-hat and crash
// lands, for Generate's accents. The drums are split into three bands (kick's thump, snare's crack, the
// cymbals' hiss), and a hit is a sudden rise in a band, well above how busy that band is around it. A
// cymbal that rings on is a crash; a short one a hi-hat. Pure, so it can be tested in node.

export const KINDS = ["kick", "snare", "hat", "crash"];
const HOP_S = 0.005; // the bands' loudness is measured every 5 ms
const GAP_S = { kick: 0.09, snare: 0.09, hat: 0.06, crash: 1 }; // no two hits of a kind closer than this
const WITH_S = 0.02; // hits in two bands this close together are one drum

// A biquad filter (RBJ's cookbook) run over x: "low", "high" or "band" at f Hz.
function biquad(x, rate, type, f, q = 0.707) {
  const w = (2 * Math.PI * f) / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === "low") { b1 = 1 - cos; b0 = b2 = b1 / 2; }
  else if (type === "high") { b1 = -(1 + cos); b0 = b2 = (1 + cos) / 2; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

// Loudness (dB) every HOP_S of x.
function levels(x, rate) {
  const hop = Math.max(1, Math.round(rate * HOP_S)), n = Math.floor(x.length / hop), out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * hop; i < (k + 1) * hop; i++) s += x[i] * x[i];
    out[k] = 10 * Math.log10(s / hop + 1e-10);
  }
  return out;
}

// Steps where a band suddenly gets louder: its rise over 15 ms (from silence at the very start), a
// peak within 50 ms either side, well above the rises around it (the band's own busyness over two
// seconds). Of those, only hits about as loud as the band's usual hits count, so another drum's spill
// into the band (a kick's click in the snare's) is left out.
function onsets(db, gapS) {
  const n = db.length, back = 3, rise = new Float32Array(n);
  let floor = Infinity;
  for (const v of db) if (v < floor) floor = v;
  for (let k = 0; k < n; k++) rise[k] = Math.max(0, db[k] - (k >= back ? db[k - back] : floor));
  const near = Math.round(0.05 / HOP_S), wide = Math.round(1 / HOP_S), gap = Math.round(gapS / HOP_S);
  const peakAfter = Math.round(0.03 / HOP_S);
  // Running mean of the rises over two seconds, kept as a prefix sum.
  const sum = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) sum[k + 1] = sum[k] + rise[k];
  const found = [];
  for (let k = 0; k < n; k++) {
    const r = rise[k];
    if (r < 6) continue;
    let peak = true;
    for (let j = Math.max(0, k - near); j <= Math.min(n - 1, k + near) && peak; j++) if (rise[j] > r || (rise[j] === r && j < k)) peak = false;
    if (!peak) continue;
    const a = Math.max(0, k - wide), b = Math.min(n, k + wide), mean = (sum[b] - sum[a]) / (b - a);
    if (r < 3 * mean) continue;
    let loud = -Infinity;
    for (let j = k; j <= Math.min(n - 1, k + peakAfter); j++) if (db[j] > loud) loud = db[j];
    found.push({ k, loud });
  }
  if (!found.length) return [];
  const sorted = found.map((f) => f.loud).sort((x, y) => x - y);
  const usual = sorted[Math.floor(sorted.length * 0.9)];
  const out = [];
  for (const f of found) {
    if (f.loud < usual - 12 || (out.length && f.k - out[out.length - 1].k < gap)) continue;
    out.push(f);
  }
  return out;
}

// The hits in a drums part (mono samples at `rate`): {kick, snare, hat, crash}, each a list of seconds.
export function drumHits(samples, rate) {
  const band = (...filters) => levels(filters.reduce((x, [type, f]) => biquad(x, rate, type, f), samples), rate);
  const low = band(["low", 100], ["low", 100]); // the kick's thump
  const mid = band(["high", 300], ["high", 300], ["low", 4000]); // the snare's crack
  const high = band(["high", 7000], ["high", 7000]); // cymbals
  const t = (f) => Math.round(f.k * HOP_S * 1000) / 1000;
  const hat = [], crash = [];
  const from = Math.round(0.03 / HOP_S), to = Math.round(0.3 / HOP_S);
  for (const f of onsets(high, GAP_S.hat)) {
    // A crash rings on: 30 to 300 ms after it, the cymbals never drop more than 15 dB below its start.
    let least = Infinity;
    for (let j = f.k + from; j <= Math.min(high.length - 1, f.k + to); j++) if (high[j] < least) least = high[j];
    (least > f.loud - 15 && f.k + to < high.length ? crash : hat).push(f);
  }
  const crashes = crash.filter((f, i) => i === 0 || f.k - crash[i - 1].k >= Math.round(GAP_S.crash / HOP_S));
  // One drum reaches more than its own band: a kick's click the snare's, a snare's hiss the cymbals'.
  // A hit with a lower drum's under it is that drum's, unless it's as loud as that band's own hits.
  const kick = onsets(low, GAP_S.kick), near = (list, f) => list.some((g) => Math.abs(g.k - f.k) * HOP_S <= WITH_S);
  const own = (hits, under) => {
    const alone = hits.filter((f) => !near(under, f)).map((f) => f.loud).sort((a, b) => a - b);
    const usual = alone.length ? alone[Math.floor(alone.length / 2)] : -Infinity;
    return hits.filter((f) => !near(under, f) || f.loud > usual - 6);
  };
  const snare = own(onsets(mid, GAP_S.snare), kick);
  return { kick: kick.map(t), snare: snare.map(t), hat: hat.filter((f) => !near(snare, f) && !near(kick, f)).map(t), crash: crashes.map(t) };
}
