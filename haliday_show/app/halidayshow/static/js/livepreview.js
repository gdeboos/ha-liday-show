// What live music effects preview with in the editor: what a WLED with a microphone hears now
// (GET api/live-music, asked a few times a second while something previews), or, with none sending,
// a made-up 120 BPM song swelling and falling, so the effects can be seen moving.

import { setLiveSource } from "./effects.js";

const POLL_MS = 250;

// Made up: a level that swells over 8 seconds, with a lift on every beat, and the bands at their own pace.
export function madeUpLevels(t) {
  const beat = Math.max(0, 1 - ((t * 2) % 1) * 3); // 120 BPM, each beat dying over a third of it
  const swell = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 8);
  const pct = (v) => Math.round(Math.max(0, Math.min(1, v)) * 100);
  return { beatAge: (t % 0.5), loudness: pct(0.25 + 0.5 * swell + 0.25 * beat), bass: pct(0.2 + 0.4 * swell + 0.4 * beat),
    mid: pct(0.3 + 0.4 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 5))), treble: pct(0.15 + 0.5 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 3))) };
}

let users = 0, timer = 0, heard = null, beatAt = -1e9;

// Starts previewing live effects (each start needs a stop); api is the editor's.
export function startLivePreview(api) {
  if (users++) return;
  const poll = async () => {
    try {
      const r = await api("api/live-music");
      heard = r?.now && r.music ? r.now : null;
      // When a beat was last heard, by this page's clock (the WLED holds each one about 0.3 s).
      if (heard?.beat && performance.now() - beatAt > 300) beatAt = performance.now();
    } catch { heard = null; }
    if (users) timer = setTimeout(poll, POLL_MS);
  };
  setLiveSource((t) => (heard ? { ...heard, beatAge: (performance.now() - beatAt) / 1000 } : madeUpLevels(t)));
  poll();
}

export function stopLivePreview() {
  if (!users || --users) return;
  clearTimeout(timer);
  heard = null;
  setLiveSource(null);
}
