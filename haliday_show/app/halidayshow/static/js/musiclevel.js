// The song's loudness over time, saved with a show (show.loudness) so the Music level effect can
// follow it when the show is baked, even without the song to hand.

export const LEVEL_FPS = 10;

// {fps, song, values}: one value a tenth of a second, 0 (the song's quiet parts) to 100 (its loudest),
// measured against the song's own range so every song uses the whole meter. song is the song's path,
// to tell when a show's song has changed.
export function levelCurve(samples, rate, song = "") {
  const step = Math.max(1, Math.round(rate / LEVEL_FPS)), n = Math.ceil(samples.length / step);
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
  return { fps: LEVEL_FPS, song, values };
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
  const l = before?.loudness;
  if (!l || !after?.audio || l.song !== after.audio.path) return after;
  if (after.loudness?.song !== l.song) after.loudness = l;
  return after;
}
