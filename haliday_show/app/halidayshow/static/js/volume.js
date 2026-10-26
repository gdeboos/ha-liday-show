// The editor's song volume: one level shared by the Edit and Music tabs, remembered in this browser.
// It only changes what plays here; speakers and the lights are untouched.

export const DEFAULT_VOLUME = 100;
const KEY = "halidayshow.volume";

export function clampVolume(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : DEFAULT_VOLUME;
}

// Ears hear loudness roughly logarithmically, so a squared curve makes the slider's middle sound
// like the middle rather than nearly full.
export const gainFor = (percent) => (clampVolume(percent) / 100) ** 2;

export function loadVolume(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(KEY);
    return v == null ? DEFAULT_VOLUME : clampVolume(v);
  } catch { return DEFAULT_VOLUME; }
}

export function saveVolume(v, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, String(clampVolume(v))); } catch { /* private mode: still applied */ }
}

// Ties sliders together: moving any of them sets the level everywhere and calls each apply(gain).
export function createVolume(storage = globalThis.localStorage) {
  let level = loadVolume(storage);
  const bound = [];
  const set = (v) => {
    level = clampVolume(v);
    for (const { input, apply } of bound) {
      if (input && Number(input.value) !== level) input.value = String(level);
      apply?.(gainFor(level));
    }
  };
  return {
    get level() { return level; },
    get gain() { return gainFor(level); },
    bind(input, apply) {
      bound.push({ input, apply });
      if (input) {
        input.value = String(level);
        input.addEventListener("input", () => set(input.value));
        input.addEventListener("change", () => saveVolume(level, storage));
      }
      apply?.(gainFor(level));
    },
    set(v) { set(v); saveVolume(level, storage); },
  };
}
