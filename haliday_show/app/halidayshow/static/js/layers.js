// Layers in the Music editor: samples or songs played on top of the song, each clip pinned to the
// moment in the song it starts at, so it follows cuts (music.js draws and edits them).
//
// A layer: {name, gain (dB), duck (optional: quieten the song while its clips play), duckDb (optional:
// by how much, 3-24 dB, 8 when missing), eq (optional:
// its bass, mid and treble, mixer.js), muted (optional: not heard, nor in a song file made from it), matchTempo (optional: clips play at the song's tempo, each from
// its own bpm), clips: [{song, start, end, anchor: {song, t}, gain (dB), fadeIn, fadeOut}]}.
// song is the clip's audio ({source, path}); start and end are the part of it that plays; anchor is
// where the clip starts, as a moment in one of the main track's songs (time in that song).

import { arrange } from "./music.js";
import { applyEq, isFlat, placeChanges } from "./mixer.js";
import { speedFor } from "./tempo.js";
import { keyShift } from "./analysis.js";

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
      // Kept just inside the piece, so the moment is still in the song after rounding.
      const last = Math.max(p.start, p.end - 0.002);
      return { song: refs[p.src], t: r3(Math.min(last, Math.max(p.start, p.start + (t - places[i].at)))) };
    }
  }
  return null;
}

// How fast a clip plays: faster or slower to the song's tempo on a layer that matches it, else 1.
export const clipSpeed = (layer, clip, tempo) => (layer.matchTempo ? speedFor(tempo, clip.bpm) : 1);

// Where a clip's audio is in sources: the stretched copy when it plays at another speed.
export const sourceKey = (clip, speed, semis = 0) => (speed === 1 && !semis ? keyOf(clip.song)
  : `${keyOf(clip.song)}@${speed}${semis ? `~${semis}` : ""}`);

// Semitones a clip is moved up or down: its layer's own (`semitones`), or with `matchKey`, from the
// clip's key to the song's (0 while either isn't known).
export const clipSemis = (layer, clip, songKey) => (Number.isFinite(layer.semitones) ? layer.semitones
  : layer.matchKey ? keyShift(clip.key, songKey) : 0);

// Every clip's place in the result: [{layer, clip, at, length, speed}] for the clips that are heard.
// tempo is the song's, for layers that match it.
export function placeClips(layers, pieces, crossfade, tempo = null, songKey = null) {
  const out = [];
  layers.forEach((layer, li) => layer.clips.forEach((clip, ci) => {
    const at = resultTime(pieces, crossfade, clip.anchor), speed = clipSpeed(layer, clip, tempo);
    const semis = clipSemis(layer, clip, songKey);
    if (at !== null) out.push({ layer: li, clip: ci, at, length: (clip.end - clip.start) / speed, speed, semis });
  }));
  return out;
}

// Where a placed clip's audio starts and ends in its (maybe stretched) source, in samples.
function span(c, speed, src, rate) {
  const from = Math.round((c.start / speed) * rate), to = Math.min(src[0].length, Math.round((c.end / speed) * rate));
  return { from, len: Math.max(0, to - from) };
}

const db = (g) => 10 ** ((g || 0) / 20);

// How far the song dips under a layer that quietens it (each layer can set its own, `duckDb`), and how
// quickly: it starts going down just before the clip, so the clip's first sound is already clear, and
// comes back up gently after it.
export const DUCK_DB = -8;
export const DUCK_MIN = 3, DUCK_MAX = 24;
const DUCK_DOWN = 0.15, DUCK_UP = 0.5;
export const duckDbOf = (L) => (Number.isFinite(L?.duckDb) ? Math.min(Math.max(L.duckDb, DUCK_MIN), DUCK_MAX) : -DUCK_DB);

// The song's gain at each sample under the layers that quieten it, or null if none do. Only clips
// that are heard count (a missing sample doesn't dip the song).
export function duckEnvelope(layers, placed, sources, n, rate) {
  // Each layer's own dip (dB down), gliding at its own pace; where layers overlap, the deepest wins.
  const dips = new Map();
  for (const { layer, clip, at, speed = 1 } of placed) {
    const L = layers[layer], c = L.clips[clip], src = sources[keyOf(c.song)];
    if (!L.duck || !src) continue;
    const len = Math.round(((c.end - c.start) / speed) * rate);
    const a = Math.max(0, Math.round(at * rate)), b = Math.min(n, Math.round(at * rate) + len);
    if (b <= a) continue;
    if (!dips.has(layer)) dips.set(layer, new Float32Array(n));
    dips.get(layer).fill(duckDbOf(L), a, b);
  }
  if (!dips.size) return null;
  const depth = new Float32Array(n);
  for (const [layer, d] of dips) {
    const dip = duckDbOf(layers[layer]), up = dip / (rate * DUCK_UP), down = dip / (rate * DUCK_DOWN);
    for (let i = 1; i < n; i++) d[i] = Math.max(d[i], d[i - 1] - up);
    for (let i = n - 2; i >= 0; i--) d[i] = Math.max(d[i], d[i + 1] - down);
    for (let i = 0; i < n; i++) if (d[i] > depth[i]) depth[i] = d[i];
  }
  for (let i = 0; i < n; i++) depth[i] = 10 ** (-depth[i] / 20);
  return depth;
}

// How many dB down the song is at each step (for the shading on the waveform), or null if no layer
// quietens it. Worked out at a low rate, such as 50 steps a second.
export function dipCurve(layers, placed, sources, n, rate) {
  const env = duckEnvelope(layers, placed, sources, n, rate);
  if (!env) return null;
  for (let i = 0; i < n; i++) env[i] = env[i] >= 1 ? 0 : -20 * Math.log10(env[i]);
  return env;
}

const TAIL = 0.25; // seconds of a clip's EQ ringing kept after it ends

// The main track's channels with the layers mixed in (a new copy). sources: {key: [channels]} at rate,
// with each stretched clip's audio under sourceKey. pieces and crossfade place layers' EQ changes.
// heard: the sources that decide where the song dips (the clips' own audio), when `sources` are
// something else, such as one part of each clip for a made file's parts.
export function mixLayers(main, layers, placed, sources, rate, { pieces = [], crossfade = 0, heard = sources } = {}) {
  const out = main.map((ch) => Float32Array.from(ch));
  const n = out[0]?.length || 0;
  const env = duckEnvelope(layers, placed, heard, n, rate);
  if (env) for (const ch of out) for (let i = 0; i < n; i++) ch[i] *= env[i];
  const changes = layers.map((L) => (isFlat(L.eq) ? null : placeChanges(L.eq, pieces, crossfade)));
  for (const { layer, clip, at, speed = 1, semis = 0 } of placed) {
    const L = layers[layer], c = L.clips[clip], src = sources[sourceKey(c, speed, semis)];
    if (!src || !sources[keyOf(c.song)]) continue;
    const gain = db(L.gain) * db(c.gain);
    const { from, len } = span(c, speed, src, rate);
    const fi = Math.round((c.fadeIn || 0) * rate), fo = Math.round((c.fadeOut || 0) * rate);
    const off = Math.round(at * rate), skip = Math.max(0, -off);
    // The clip with its volume and fades, then its layer's EQ, then into the mix.
    const tail = changes[layer] ? Math.round(TAIL * rate) : 0;
    const k1 = Math.min(len + tail, n - off);
    if (k1 <= skip) continue;
    const bits = out.map((_, c2) => {
      const s = src[Math.min(c2, src.length - 1)], bit = new Float32Array(k1 - skip);
      for (let k = skip; k < Math.min(k1, len); k++) {
        let g = gain;
        if (fi && k < fi) g *= k / fi;
        if (fo && k > len - fo) g *= (len - k) / fo;
        bit[k - skip] = g * s[from + k];
      }
      return bit;
    });
    if (changes[layer]) applyEq(bits, rate, L.eq, changes[layer], off + skip);
    out.forEach((ch, c2) => { const bit = bits[c2]; for (let k = 0; k < bit.length; k++) ch[off + skip + k] += bit[k]; });
  }
  return out;
}

// Cutting a stretch out of one layer, leaving the song and the other layers as they are. ctx: {pieces,
// crossfade, refs (a piece's src key → its song), tempo}. closeUp: the rest of the layer moves earlier by
// the stretch's length, overlapping what's before it by a short crossfade; else a gap is left. Returns
// the layers with that layer's clips changed.
export const LAYER_XF = 0.05;
export function cutLayer(layers, li, start, end, { closeUp = false, pieces, crossfade = 0, refs, tempo = null }) {
  const L = layers[li], d = end - start, out = [];
  const pin = (t) => anchorAt(pieces, crossfade, Math.max(0, t), refs);
  for (const c of L.clips) {
    const at = resultTime(pieces, crossfade, c.anchor);
    if (at === null) { out.push(c); continue; } // on a part of the song that's cut out: left alone
    const speed = clipSpeed(L, c, tempo), e = at + (c.end - c.start) / speed;
    const part = (from, to, extra) => clipPart_(c, at, speed, from, to, pin(from), extra);
    if (e <= start + EPS) out.push(c);
    else if (at >= end - EPS) out.push(closeUp ? { ...c, anchor: pin(at - d) ?? c.anchor } : c);
    else {
      const xf = closeUp ? LAYER_XF : 0;
      if (at < start - 0.05) out.push(part(at, Math.min(e, start + xf), { fadeOut: xf || 0.02 }));
      if (e > end + 0.05) {
        const piece = part(end, e, { fadeIn: xf || 0.02, fadeOut: c.fadeOut });
        out.push(closeUp ? { ...piece, anchor: pin(start) ?? piece.anchor } : piece);
      }
    }
  }
  return layers.map((l, k) => (k === li ? { ...l, clips: out.filter(Boolean) } : l));
}

// Another song spliced into one layer at result time t: `clip` (its song, start and end, gain, fades,
// bpm…, no anchor) goes in there, and what of the layer comes after t moves later by its length (a clip
// running across t is split there). What would move past the song's end is left out. Returns
// {layers, dropped (how many clips were left out)}.
export function insertIntoLayer(layers, li, t, clip, { pieces, crossfade = 0, refs, tempo = null }) {
  const L = layers[li], total = arrange(pieces, crossfade).total;
  const pin = (x) => anchorAt(pieces, crossfade, Math.max(0, x), refs);
  const len = (clip.end - clip.start) / clipSpeed(L, clip, tempo), out = [];
  let dropped = 0;
  const later = (c, at) => {
    if (at + len >= total - 0.05) { dropped++; return; }
    const anchor = pin(at + len);
    if (anchor) out.push({ ...c, anchor }); else dropped++;
  };
  for (const c of L.clips) {
    const at = resultTime(pieces, crossfade, c.anchor);
    if (at === null) { out.push(c); continue; }
    const speed = clipSpeed(L, c, tempo), e = at + (c.end - c.start) / speed;
    if (e <= t + EPS) out.push(c);
    else if (at >= t - EPS) later(c, at);
    else { // across t: its first part stays, the rest moves on
      out.push(clipPart_(c, at, speed, at, t, c.anchor, { fadeOut: 0.02 }));
      const rest = clipPart_(c, at, speed, t, e, pin(t), { fadeIn: 0.02 });
      if (rest) later(rest, t);
    }
  }
  const anchor = pin(t);
  if (anchor) out.push({ ...clip, anchor });
  return { layers: layers.map((l, k) => (k === li ? { ...l, clips: out.filter(Boolean) } : l)), dropped };
}

// A stretch of one layer played `times` times in a row: what of its clips is in [start, end] is copied
// on after it, and the rest of the layer moves later by the copies' length (a clip running across the
// end is split there). The song stays as long as it is, so what would move past its end is left out.
// Returns {layers, dropped (how many clips or copies were left out), repeated (how many clips are in the
// stretch: none, and there's nothing to repeat)}.
export function loopLayer(layers, li, start, end, times, { pieces, crossfade = 0, refs, tempo = null }) {
  const L = layers[li], total = arrange(pieces, crossfade).total, d = end - start, extra = d * (times - 1);
  const pin = (x) => anchorAt(pieces, crossfade, Math.max(0, x), refs);
  const out = [], copies = [];
  let dropped = 0;
  const put = (c, at) => {
    if (at >= total - 0.05) { dropped++; return; }
    const anchor = pin(at);
    if (anchor) out.push({ ...c, anchor }); else dropped++;
  };
  for (const c of L.clips) {
    const at = resultTime(pieces, crossfade, c.anchor);
    if (at === null) { out.push(c); continue; }
    const speed = clipSpeed(L, c, tempo), e = at + (c.end - c.start) / speed;
    const from = Math.max(at, start), to = Math.min(e, end);
    if (to - from >= 0.05) copies.push({ c, at, e, speed, from, to });
    if (e <= end + EPS) out.push(c);
    else if (at >= end - EPS) put(c, at + extra);
    else { // across the end: its first part stays, the rest moves on after the copies
      out.push(clipPart_(c, at, speed, at, end, c.anchor, { fadeOut: 0.02 }));
      const rest = clipPart_(c, at, speed, end, e, c.anchor, { fadeIn: 0.02 });
      if (rest) put(rest, end + extra);
    }
  }
  for (let k = 1; k < times; k++) {
    for (const { c, at, e, speed, from, to } of copies) {
      const part = clipPart_(c, at, speed, from, to, c.anchor,
        { fadeIn: from > at + EPS ? 0.02 : c.fadeIn, fadeOut: to < e - EPS ? 0.02 : c.fadeOut });
      if (part) put(part, from + k * d);
    }
  }
  return { layers: layers.map((l, k) => (k === li ? { ...l, clips: out.filter(Boolean) } : l)), dropped, repeated: copies.length };
}

// Only a stretch of one layer kept (its clips trimmed to it); nothing moves.
export function keepLayer(layers, li, start, end, { pieces, crossfade = 0, refs, tempo = null }) {
  const L = layers[li], out = [];
  const pin = (t) => anchorAt(pieces, crossfade, Math.max(0, t), refs);
  for (const c of L.clips) {
    const at = resultTime(pieces, crossfade, c.anchor);
    if (at === null) continue;
    const speed = clipSpeed(L, c, tempo), e = at + (c.end - c.start) / speed;
    const from = Math.max(at, start), to = Math.min(e, end);
    if (to - from < 0.05) continue;
    out.push(from === at && to === e ? c : clipPart_(c, at, speed, from, to, pin(from),
      { fadeIn: from > at ? 0.02 : c.fadeIn, fadeOut: to < e ? 0.02 : c.fadeOut }));
  }
  return layers.map((l, k) => (k === li ? { ...l, clips: out.filter(Boolean) } : l));
}

// The bit of clip c (placed at `at`, playing at `speed`) heard from result time `from` to `to`.
function clipPart_(c, at, speed, from, to, anchor, extra = {}) {
  if (!anchor || to - from < 0.05) return null;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { ...c, start: r3(c.start + (from - at) * speed), end: r3(c.start + (to - at) * speed), anchor,
    fadeIn: from > at + EPS ? 0 : c.fadeIn, fadeOut: c.fadeOut, ...extra };
}

// What a layer's clip adds to one part (vocals, drums, bass, rest or music: everything but the vocals)
// of a song file made from the draft: the audio to play in the clip's place, {source, path}, or null for
// nothing. songs: [{source, path, parts}].
// - A whole song with parts gives that part of it.
// - A part of a song (a clip of just its vocals, say) gives itself to that part. It also feeds the music,
//   unless it's the vocals. A clip of a song's music gives that song's drums, bass and rest to theirs.
// - Anything else (a sample, a song not split yet) counts as the rest of the music.
export function clipPart(song, part, songs) {
  const same = (a, b) => a.source === b.source && a.path === b.path;
  const whole = songs.find((s) => same(s, song));
  if (whole && Object.keys(whole.parts || {}).length) return whole.parts[part] ? { source: "media", path: whole.parts[part] } : null;
  for (const s of songs) {
    const of = Object.entries(s.parts || {}).find(([, p]) => song.source === "media" && p === song.path)?.[0];
    if (!of) continue;
    if (of === part) return song;
    if (part === "music" && of !== "vocals") return song;
    if (of === "music" && ["drums", "bass", "rest"].includes(part)) return s.parts[part] ? { source: "media", path: s.parts[part] } : null;
    return null;
  }
  return part === "rest" || part === "music" ? song : null;
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
