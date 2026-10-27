// Layers in the Music editor: samples or songs played on top of the song, each clip pinned to the
// moment in the song it starts at, so it follows cuts (music.js draws and edits them).
//
// A layer: {name, gain (dB), clips: [{song, start, end, anchor: {song, t}, gain (dB), fadeIn, fadeOut}]}.
// song is the clip's audio ({source, path}); start and end are the part of it that plays; anchor is
// where the clip starts, as a moment in one of the main track's songs (time in that song).

import { arrange } from "./music.js";

export const MAX_LAYERS = 4;
export const MAX_CLIPS = 100;
const EPS = 1e-6;
export const keyOf = (ref) => `${ref.source}:${ref.path}`;

// Where a moment in one of the main track's songs is in the edited result, or null if it's cut out.
export function resultTime(pieces, crossfade, anchor) {
  const { places, total } = arrange(pieces, crossfade);
  const key = keyOf(anchor.song);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.src !== key || anchor.t < p.start - EPS || anchor.t >= p.end - EPS) continue;
    const at = places[i].at + (anchor.t - p.start);
    // Each piece owns its stretch up to the middle of its crossfades (as music.js slice does).
    const own0 = i === 0 ? 0 : places[i].at + places[i].xf / 2;
    const own1 = i === pieces.length - 1 ? total : places[i + 1].at + places[i + 1].xf / 2;
    if (at >= own0 - EPS && at < own1 + EPS) return at;
  }
  return null;
}

// The moment in the main track's songs at result time t: {song, t}, or null past the end. refs maps
// a piece's src key to its song.
export function anchorAt(pieces, crossfade, t, refs) {
  const { places, total } = arrange(pieces, crossfade);
  if (t < 0 || t > total + EPS || !pieces.length) return null;
  for (let i = 0; i < pieces.length; i++) {
    const own1 = i === pieces.length - 1 ? total + EPS : places[i + 1].at + places[i + 1].xf / 2;
    if (t < own1) {
      const p = pieces[i];
      const r3 = (x) => Math.round(x * 1000) / 1000;
      return { song: refs[p.src], t: r3(Math.min(p.end, Math.max(p.start, p.start + (t - places[i].at)))) };
    }
  }
  return null;
}

// Every clip's place in the result: [{layer, clip, at, length}] for the clips that are heard.
export function placeClips(layers, pieces, crossfade) {
  const out = [];
  layers.forEach((layer, li) => layer.clips.forEach((clip, ci) => {
    const at = resultTime(pieces, crossfade, clip.anchor);
    if (at !== null) out.push({ layer: li, clip: ci, at, length: clip.end - clip.start });
  }));
  return out;
}

const db = (g) => 10 ** ((g || 0) / 20);

// The main track's channels with the layers mixed in (a new copy). sources: {key: [channels]} at rate.
export function mixLayers(main, layers, placed, sources, rate) {
  const out = main.map((ch) => Float32Array.from(ch));
  const n = out[0]?.length || 0;
  for (const { layer, clip, at } of placed) {
    const L = layers[layer], c = L.clips[clip], src = sources[keyOf(c.song)];
    if (!src) continue;
    const gain = db(L.gain) * db(c.gain);
    const from = Math.round(c.start * rate), to = Math.min(src[0].length, Math.round(c.end * rate));
    const len = to - from, fi = Math.round((c.fadeIn || 0) * rate), fo = Math.round((c.fadeOut || 0) * rate);
    const off = Math.round(at * rate);
    for (let k = 0; k < len; k++) {
      const i = off + k;
      if (i >= n) break;
      if (i < 0) continue;
      let g = gain;
      if (fi && k < fi) g *= k / fi;
      if (fo && k > len - fo) g *= (len - k) / fo;
      out.forEach((ch, c2) => { ch[i] += g * src[Math.min(c2, src.length - 1)][from + k]; });
    }
  }
  return out;
}

// Keeps a mix from clipping: turns down just around anything louder than ceiling, smoothly (it acts
// a few milliseconds ahead and lets go over a tenth of a second). In place; returns channels.
export function limit(channels, rate, ceiling = 0.98) {
  const n = channels[0]?.length || 0;
  let over = false;
  for (const ch of channels) for (let i = 0; i < n && !over; i++) if (Math.abs(ch[i]) > ceiling) over = true;
  if (!over) return channels;
  const need = new Float32Array(n).fill(1);
  for (const ch of channels) for (let i = 0; i < n; i++) {
    const a = Math.abs(ch[i]);
    if (a > ceiling) need[i] = Math.min(need[i], ceiling / a);
  }
  // Each sample takes the lowest gain needed within the next few ms (so it's already down when the
  // peak comes), then the gain comes back up gradually.
  const ahead = Math.max(1, Math.round(rate * 0.005)), back = 1 - 1 / (rate * 0.1);
  const gain = new Float32Array(n);
  let g = 1;
  for (let i = n - 1, low = 1, q = []; i >= 0; i--) { // lowest need in [i, i + ahead]
    while (q.length && need[q[q.length - 1]] >= need[i]) q.pop();
    q.push(i);
    if (q[0] > i + ahead) q.shift();
    low = need[q[0]];
    gain[i] = low;
  }
  for (let i = 0; i < n; i++) {
    g = gain[i] < g ? gain[i] : Math.min(gain[i], 1 - (1 - g) * back);
    for (const ch of channels) ch[i] *= g;
  }
  return channels;
}

// A new clip's gain (dB) so it sits a little under the song: its loudness 6 LU below the song's.
export function matchGain(songLufs, clipLufs) {
  if (!Number.isFinite(songLufs) || !Number.isFinite(clipLufs)) return 0;
  return Math.max(-24, Math.min(12, Math.round((songLufs - 6 - clipLufs) * 10) / 10));
}
