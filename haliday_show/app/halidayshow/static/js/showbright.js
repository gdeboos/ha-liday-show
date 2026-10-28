// Show brightness (Show settings): a level for the whole show and one for each light in it.
// Saved as show.brightness and show.lightBrightness[lightId], percentages 1–100; 100 is left out,
// so a show nobody dimmed saves exactly as before. effects.js's showLevel() reads them.
import { HOUSE } from "./effects.js";

export const MIN_LEVEL = 1;

// The physical lights a show plays on, in timeline order. `devices` maps a track's device id to
// what it plays on: a light, or a part of one (with `parent`).
export function lightsInShow(show, devices) {
  const out = [];
  for (const tr of show?.tracks || []) {
    if (tr.device === HOUSE) continue;
    const dev = devices[tr.device];
    if (!dev) continue;
    const id = dev.parent || tr.device;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

const clean = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, MIN_LEVEL), 100) : 100;
};

export const wholeLevel = (show) => (show?.brightness == null ? 100 : clean(show.brightness));
export const lightLevel = (show, id) => (show?.lightBrightness?.[id] == null ? 100 : clean(show.lightBrightness[id]));

export function setWholeLevel(show, value) {
  const v = clean(value);
  if (v === 100) delete show.brightness;
  else show.brightness = v;
}

export function setLightLevel(show, id, value) {
  const v = clean(value);
  const map = { ...(show.lightBrightness || {}) };
  if (v === 100) delete map[id];
  else map[id] = v;
  if (Object.keys(map).length) show.lightBrightness = map;
  else delete show.lightBrightness;
}
