// Keeping a visitor's phone in time with the lights (the public page's Listen button).
//
// The phone asks the server where the song is about once a second. Each answer is a sample:
// {sent, recv} on the phone's own clock (performance.now(), ms) and the song's position (s) when the
// server answered. Half the round trip is the best guess at how long the answer took to arrive, and
// the quickest round trips are the most trustworthy, so the song's position at any moment is worked
// out from the quickest recent sample. The phone then nudges its playback speed (or jumps, when far
// out) to match. Nothing here touches the page, so it's tested on its own.

export const KEEP = 12; // samples kept
export const MAX_AGE_MS = 30000; // and only this recent
export const SLACK_S = 0.05; // allowance beyond the round trips before a sample counts as a jump
export const SEEK_S = 0.3; // further out than this, jump rather than speed up or slow down
export const CLOSE_S = 0.015; // closer than this, play at normal speed
export const MAX_NUDGE = 0.04; // speed changes stay within ±4 %
export const CATCH_UP_S = 2; // a gap is closed over about this long

export const rtt = (s) => s.recv - s.sent;

// The song's position at local time 0, from one sample (seconds).
export const anchorOf = (s) => s.position + rtt(s) / 2000 - s.recv / 1000;

export function bestOf(samples) {
  let best = null;
  for (const s of samples) if (!best || rtt(s) < rtt(best)) best = s;
  return best;
}

// Adds a sample. One that can't be squared with the best so far (the server's song jumped: a new
// show, or the lights re-lined up with a speaker) starts the list afresh.
export function addSample(samples, s, now = s.recv) {
  if (!(rtt(s) >= 0) || !Number.isFinite(s.position)) return samples;
  const recent = samples.filter((x) => now - x.recv <= MAX_AGE_MS);
  const best = bestOf(recent);
  if (best && Math.abs(anchorOf(s) - anchorOf(best)) > (rtt(s) + rtt(best)) / 2000 + SLACK_S) return [s];
  return [...recent, s].slice(-KEEP);
}

// Where the song should be at local time `now` (ms), or null with no samples.
export function target(samples, now) {
  const best = bestOf(samples);
  return best ? anchorOf(best) + now / 1000 : null;
}

// What to do about an error (the phone's song minus where it should be, in seconds):
// {seek: true} to jump, else {rate} to play at.
export function steer(err) {
  if (!Number.isFinite(err) || Math.abs(err) > SEEK_S) return { seek: true, rate: 1 };
  if (Math.abs(err) < CLOSE_S) return { seek: false, rate: 1 };
  const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, err / CATCH_UP_S));
  return { seek: false, rate: 1 - nudge };
}

// A jump lands late (the phone takes a moment to start again), so it aims ahead by a lead it learns
// from how far out each jump turned out to be.
export function learnLead(lead, errAfterSeek) {
  if (!Number.isFinite(errAfterSeek)) return lead;
  return Math.max(0, Math.min(0.6, lead - errAfterSeek * 0.7));
}

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Music ahead / behind, set on each phone: how much earlier (+) or later (-) than the lights the phone
// plays the song, in seconds. Bluetooth headphones and speakers play late, so they want it earlier.
export const NUDGE_STEP = 0.05;
export const MAX_NUDGE_S = 1;

export function clampNudge(v) {
  const n = Math.round((Number(v) || 0) / NUDGE_STEP) * NUDGE_STEP;
  return Math.max(-MAX_NUDGE_S, Math.min(MAX_NUDGE_S, Math.round(n * 100) / 100));
}
