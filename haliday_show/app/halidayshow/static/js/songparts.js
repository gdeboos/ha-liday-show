// The song's own parts in the Music editor, like stems on a DJ controller: a level for each of its
// vocals, drums, bass and the rest (draft.parts), muting, and changes over stretches of the song ("no
// drums in the first verse", "vocals only in the intro"). The parts add up to the song, so a part that's
// changed is mixed back in at its new level: the song plus (level - 1) times that part. Pure, so it can
// be tested in node; music.js renders the parts and draws them.
//
// draft.parts: {gain: {vocals, drums, bass, rest} (dB, missing is 0), muted: [part], changes: [{part,
// gain (dB; MUTE or lower is silent), from: {song, t}, to: {song, t}}]}, the changes pinned to moments in
// the song, so they follow cuts, as layers' clips do.

import { resultTime } from "./layers.js";

export const SONG_PARTS = ["vocals", "drums", "bass", "rest"];
export const GAIN_MIN = -24, GAIN_MAX = 6;
export const MUTE = -60; // a change down to this is silent
const RAMP = 0.03; // seconds a level takes to change, so there's no click

export const emptyParts = () => ({ gain: {}, muted: [], changes: [] });

// Whether anything is changed (the song plays as it is otherwise).
export function partsActive(parts) {
  if (!parts) return false;
  return SONG_PARTS.some((p) => (parts.gain?.[p] || 0) !== 0) || (parts.muted || []).length > 0 || (parts.changes || []).length > 0;
}

// Whether a part is changed at all.
export const partChanged = (parts, part) => (parts?.gain?.[part] || 0) !== 0 || (parts?.muted || []).includes(part)
  || (parts?.changes || []).some((c) => c.part === part);

const lin = (db) => (db <= MUTE ? 0 : 10 ** (db / 20));

// A part's level over the result: {base (linear), segs: [[start, end, linear]]}, the changes placed
// where their moments are now (one whose start or end is cut out is left out). listen: the part isn't
// heard (muted or soloed away just for listening) when false.
export function partLevel(parts, part, pieces, crossfade) {
  const base = (parts?.muted || []).includes(part) ? 0 : lin(parts?.gain?.[part] || 0);
  const segs = [];
  for (const c of parts?.changes || []) {
    if (c.part !== part) continue;
    const a = resultTime(pieces, crossfade, c.from), b = resultTime(pieces, crossfade, c.to);
    if (a === null || b === null || b - a < 0.01) continue;
    segs.push([a, b, lin(c.gain)]);
  }
  return { base, segs: segs.sort((x, y) => x[0] - y[0]) };
}

// The level at time t: the base, times every change covering it, each ramping in and out over RAMP.
export function levelAt({ base, segs }, t) {
  let g = base;
  for (const [a, b, v] of segs) {
    if (t <= a - RAMP || t >= b + RAMP) continue;
    const k = t < a ? (t - (a - RAMP)) / RAMP : t > b ? ((b + RAMP) - t) / RAMP : 1; // how far in
    g *= 1 + (v - 1) * Math.max(0, Math.min(1, k));
  }
  return g;
}

// Adds a part into `out` at its level less `minus` (1 to mix a change into the song, which has the part
// at full level already; 0 to build the song from parts). out, part: channels at rate.
export function addPart(out, part, level, rate, minus = 1) {
  const n = out[0].length;
  // The level only changes near a change's edges: work it out once a millisecond and step through.
  const step = Math.max(1, Math.round(rate / 1000));
  for (let i0 = 0; i0 < n; i0 += step) {
    const g = levelAt(level, i0 / rate) - minus;
    if (g === 0) continue;
    const i1 = Math.min(n, i0 + step);
    out.forEach((ch, c) => {
      const src = part[Math.min(c, part.length - 1)];
      for (let i = i0; i < i1 && i < src.length; i++) ch[i] += g * src[i];
    });
  }
  return out;
}

// The changes for a part over a stretch [from, to] (anchors), replacing any of that part's changes it
// overlaps (adding "Mute the drums here" over half of an earlier one shortens that one). gain null
// takes that part's changes off the stretch.
export function setChange(parts, part, from, to, gain, toResult) {
  const a = toResult(from), b = toResult(to);
  const keep = [];
  for (const c of parts.changes || []) {
    if (c.part !== part) { keep.push(c); continue; }
    const ca = toResult(c.from), cb = toResult(c.to);
    if (ca === null || cb === null || cb <= a || ca >= b) { keep.push(c); continue; }
    // The bits of it outside the new stretch stay.
    if (ca < a - 0.01) keep.push({ ...c, to: from });
    if (cb > b + 0.01) keep.push({ ...c, from: to });
  }
  if (gain != null) keep.push({ part, gain, from, to });
  return { ...parts, changes: keep };
}

// The changes of a part overlapping [a, b] (result seconds).
export function changesIn(parts, part, a, b, pieces, crossfade) {
  return (parts?.changes || []).filter((c) => {
    if (c.part !== part) return false;
    const ca = resultTime(pieces, crossfade, c.from), cb = resultTime(pieces, crossfade, c.to);
    return ca !== null && cb !== null && cb > a + 0.01 && ca < b - 0.01;
  });
}
