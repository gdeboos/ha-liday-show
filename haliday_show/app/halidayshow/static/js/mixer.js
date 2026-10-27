// Bass, mid and treble faders for the song and each layer in the Music editor, like a DJ mixer's EQ.
// The sound is split into three bands (crossovers at 250 Hz and 3 kHz) and each band is turned up or
// down; at the bottom of its fader a band is off. Settings can change at points in the song, gliding
// to the new setting, and those points follow cuts like layer clips (music.js draws and edits them).
//
// An eq: {bass, mid, treble (dB), changes: [{anchor: {song, t}, bass, mid, treble, glide (s)}]}.

import { resultTime } from "./layers.js";

export const BANDS = ["bass", "mid", "treble"];
export const EQ_MIN = -24; // the bottom of a fader: that band off
export const EQ_MAX = 6;
export const MAX_CHANGES = 100;
const LOW_HZ = 250, HIGH_HZ = 3000;
const FLOOR = -60; // glides to and from "off" go through this, so they sound like a fade

export const flatEq = () => ({ bass: 0, mid: 0, treble: 0, changes: [] });
const setting = (s) => ({ bass: s?.bass ?? 0, mid: s?.mid ?? 0, treble: s?.treble ?? 0 });
const isZero = (s) => BANDS.every((b) => !s[b]);

// True when an eq leaves the sound as it is.
export function isFlat(eq) {
  return !eq || (isZero(setting(eq)) && (eq.changes || []).every((c) => isZero(setting(c))));
}

// The eq's changes that are still in the song, in order: [{at, i, bass, mid, treble, glide}].
export function placeChanges(eq, pieces, crossfade) {
  const out = [];
  (eq?.changes || []).forEach((c, i) => {
    const at = resultTime(pieces, crossfade, c.anchor);
    if (at !== null) out.push({ at, i, ...setting(c), glide: c.glide ?? 1 });
  });
  return out.sort((a, b) => a.at - b.at || a.i - b.i);
}

// The setting in force at result time t, and which change it comes from (-1 for the eq's own).
export function eqAt(eq, placed, t) {
  let from = -1;
  for (let k = 0; k < placed.length; k++) if (placed[k].at <= t + 1e-6) from = k;
  return { ...setting(from < 0 ? eq : placed[from]), change: from < 0 ? -1 : placed[from].i };
}

const toDb = (v) => (v <= EQ_MIN ? FLOOR : v);
const toGain = (d) => (d <= FLOOR ? 0 : 10 ** (d / 20));

// The three bands' gains at each moment, as stretches: [{from, to (samples), a: [dB×3], b: [dB×3]}],
// gliding from a to b over the stretch (a equals b where nothing moves).
export function gainSpans(eq, placed, n, rate) {
  const spans = [];
  let cur = BANDS.map((b) => toDb(setting(eq)[b])), pos = 0;
  for (const c of placed) {
    const start = Math.min(n, Math.max(pos, Math.round(c.at * rate)));
    if (start > pos) spans.push({ from: pos, to: start, a: cur, b: cur });
    const next = BANDS.map((b) => toDb(c[b]));
    const end = Math.min(n, start + Math.round(Math.max(0, c.glide) * rate));
    if (end > start) spans.push({ from: start, to: end, a: cur, b: next });
    cur = next;
    pos = Math.max(pos, end, start);
  }
  if (pos < n) spans.push({ from: pos, to: n, a: cur, b: cur });
  return spans;
}

// A second-order filter (RBJ's cookbook) that runs over a block at a time, keeping its state between
// blocks.
function biquad(kind, f, rate, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f) / rate, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  if (kind === "low") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
  else if (kind === "high") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  else { b0 = 1 - al; b1 = -2 * cs; b2 = 1 + al; } // all-pass
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
  const state = new Float64Array(4);
  return (buf, len) => {
    let x1 = state[0], x2 = state[1], y1 = state[2], y2 = state[3];
    for (let i = 0; i < len; i++) {
      const x = buf[i], y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      buf[i] = y;
    }
    state[0] = x1; state[1] = x2; state[2] = y1; state[3] = y2;
  };
}

const BLOCK = 8192;

// Splits one channel's sound into its three bands, a block at a time: Linkwitz-Riley crossovers (two
// Butterworth filters each), which add back up to the original with every fader at 0. The bass goes
// through an all-pass so it stays in step with the other two after the second crossover.
function splitter(rate) {
  const f = (kind, hz) => biquad(kind, hz, rate);
  const bass = [f("low", LOW_HZ), f("low", LOW_HZ), f("all", HIGH_HZ)];
  const rest = [f("high", LOW_HZ), f("high", LOW_HZ)];
  const mid = [f("low", HIGH_HZ), f("low", HIGH_HZ)];
  const top = [f("high", HIGH_HZ), f("high", HIGH_HZ)];
  const bands = [new Float32Array(BLOCK), new Float32Array(BLOCK), new Float32Array(BLOCK)];
  return (src, from, len) => {
    const [b, m, t] = bands;
    for (let i = 0; i < len; i++) b[i] = t[i] = src[from + i];
    for (const run of bass) run(b, len);
    for (const run of rest) run(t, len);
    m.set(t.subarray(0, len));
    for (const run of mid) run(m, len);
    for (const run of top) run(t, len);
    return bands;
  };
}

// Applies an eq to channels in place (placed: its changes, from placeChanges). Returns channels.
// offset is where the channels start in the song, in samples, for a clip mixed on its own.
export function applyEq(channels, rate, eq, placed, offset = 0) {
  if (isFlat(eq)) return channels;
  const n = channels[0]?.length || 0;
  const spans = gainSpans(eq, placed, offset + n, rate).map((s) => ({ ...s, from: s.from - offset, to: s.to - offset,
    still: s.a.every((v, q) => v === s.b[q]), g: s.a.map(toGain) }));
  for (const ch of channels) {
    const split = splitter(rate);
    let k = 0;
    for (let from = 0; from < n; from += BLOCK) {
      const len = Math.min(BLOCK, n - from), end = from + len;
      const [b, m, t] = split(ch, from, len);
      // Each stretch of steady or gliding gains that falls in this block.
      for (let i = from; i < end;) {
        while (k < spans.length - 1 && i >= spans[k].to) k++;
        const s = spans[k], stop = Math.min(end, s.to);
        if (s.still) {
          const [g0, g1, g2] = s.g;
          for (; i < stop; i++) { const j = i - from; ch[i] = g0 * b[j] + g1 * m[j] + g2 * t[j]; }
        } else {
          const span = s.to - s.from;
          for (; i < stop; i++) {
            const f = (i - s.from) / span, j = i - from;
            ch[i] = toGain(s.a[0] + (s.b[0] - s.a[0]) * f) * b[j] + toGain(s.a[1] + (s.b[1] - s.a[1]) * f) * m[j]
              + toGain(s.a[2] + (s.b[2] - s.a[2]) * f) * t[j];
          }
        }
      }
    }
  }
  return channels;
}

// How a fader's value reads.
export const faderText = (v) => (v <= EQ_MIN ? "off" : `${v > 0 ? "+" : ""}${v} dB`);
