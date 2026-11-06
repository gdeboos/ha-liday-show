// The song's loudness over time, saved with a show (show.loudness) so the Music level effect can
// follow it when the show is baked, even without the song to hand.

export const LEVEL_FPS = 10;

// {fps, song, values}: one value a tenth of a second, 0 (the song's quiet parts) to 100 (its loudest),
// measured against the song's own range so every song uses the whole meter. song is the song's path,
// to tell when a show's song has changed.
export function levelCurve(samples, rate, song = "", fps = LEVEL_FPS) {
  const step = Math.max(1, Math.round(rate / fps)), n = Math.ceil(samples.length / step);
  const db = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0, count = 0;
    for (let i = k * step; i < Math.min((k + 1) * step, samples.length); i++, count++) sum += samples[i] * samples[i];
    db[k] = 10 * Math.log10(sum / Math.max(count, 1) + 1e-10);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const lo = pick(0.1), hi = Math.max(pick(0.98), lo + 1);
  const values = Array.from(db, (v) => Math.round(Math.min(Math.max((v - lo) / (hi - lo), 0), 1) * 100));
  return { fps, song, values };
}

// The singer's level, for the Singing face (show.voice): measured faster than the music level, so the
// mouth keeps up with the words.
export const VOICE_FPS = 20;

// The voice range of a song (about 300 Hz to 3.4 kHz, as a telephone carries), for a song without its
// vocals split out: the singer stands out from the drums and bass there.
export function voiceBand(samples, rate) {
  const biquad = (x, kind, f0) => {
    const w = (2 * Math.PI * f0) / rate, cos = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2;
    const b = kind === "high" ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = (b[0] * x[i] + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
  return biquad(biquad(samples, "high", 300), "low", Math.min(3400, rate * 0.45));
}

// The mouth's shape for each step of the singer's level (values, fps a second), as a string of faces.js
// SHAPES: "m" when it's quiet, else guessed from where the voice's energy is. An open "ah" puts a lot
// into 500-1100 Hz (its first formant is high); an "ee" has a high second formant (1.7-3.2 kHz) over a
// low first; an "oo" keeps it all low. Rough, as no lyrics are known, but it gives the mouth variety.
export function voiceShapes(samples, rate, fps, values) {
  const band = (lo, hi) => {
    const f0 = Math.sqrt(lo * hi), q = f0 / (hi - lo), w = (2 * Math.PI * Math.min(f0, rate * 0.45)) / rate;
    const alpha = Math.sin(w) / (2 * q), cos = Math.cos(w), a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
    const step = Math.max(1, Math.round(rate / fps)), out = new Float64Array(values.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) {
      const y = b0 * samples[i] + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = samples[i]; y2 = y1; y1 = y;
      const k = Math.floor(i / step);
      if (k < out.length) out[k] += y * y;
    }
    return out;
  };
  const low = band(200, 500), mid = band(500, 1100), high = band(1700, 3200);
  const raw = Array.from(values, (v, k) => {
    if (v < 15) return "m";
    const l = low[k], m = mid[k], h = high[k];
    if (h > 0.5 * (l + m)) return "e";
    return m > 1.2 * l ? "a" : "o";
  });
  // A shape lasts at least two steps, so the mouth doesn't flicker between them.
  return raw.map((c, k) => (k > 0 && k < raw.length - 1 && raw[k - 1] !== c && raw[k + 1] !== c ? raw[k - 1] : c)).join("");
}

// Whether a show's saved voice levels belong to its current song (the same file, as long as it was
// then). `vocals`: whether the song's vocals are there now, so levels taken from the song itself are
// measured again from them.
export function voiceFits(show, songPath, duration, vocals = false) {
  const l = show?.voice;
  return !!l && Array.isArray(l.values) && l.song === songPath && Math.abs((l.seconds ?? duration) - duration) < 0.5
    && !(vocals && l.from === "song") && typeof l.shapes === "string"; // before 0.2.385 there were no shapes
}

// Where Split vocals keeps a song's vocals: in HA-liday Show's own folder of your songs (as the server
// names uploads), or beside the song.
export function vocalsPlaces(ref, vocalsName) {
  const safe = vocalsName.replace(/[^\p{L}\p{N}_ .()-]+/gu, "_").replace(/^[ .]+|[ .]+$/g, "");
  const dir = ref.path.includes("/") ? ref.path.slice(0, ref.path.lastIndexOf("/") + 1) : "";
  const out = [{ source: "media", path: `haliday_show/${safe}` }, { ...ref, path: dir + vocalsName }];
  return out.filter((r, i) => out.findIndex((o) => o.source === r.source && o.path === r.path) === i);
}

// Whether a show's saved loudness belongs to its current song.
export function levelsFit(show, songPath, duration) {
  const l = show?.loudness;
  return !!l && Array.isArray(l.values) && l.song === songPath && Math.abs(l.values.length / (l.fps || LEVEL_FPS) - duration) < 1;
}

// The song's loudness is measured, not edited, so undo mustn't take it away: a show restored from
// before it was measured (or from another song's) takes the measurement it had, when it's for the
// same song.
export function keepLevels(before, after) {
  // The singer's level (show.voice) is measured too, so it's kept the same way.
  for (const key of ["loudness", "voice"]) {
    const l = before?.[key];
    if (!l || !after?.audio || l.song !== after.audio.path) continue;
    if (after[key]?.song !== l.song) after[key] = l;
  }
  return after;
}
