// What can be heard in a song (sleigh bells, a choir, brass…) and how it sounds (happy, scary…), found
// by YAMNet, Google's model that names 521 kinds of sound, run in the browser on the whole song
// (stemsworker.js). Kept with the song, a little like its drum hits, for Generate and the AI to pick
// looks that suit it: twinkles for bells, slow washes for a choir. Pure, so it can be tested in node.

// Each sound, its name for people, and the YAMNet classes (numbers in its class map) that count as it.
export const SOUNDS = {
  sleighbells: { label: "Sleigh bells", classes: [197] },
  bells: { label: "Bells and chimes", classes: [195, 196, 202, 173, 200, 201, 176] },
  mallets: { label: "Xylophone and vibes", classes: [174, 175, 177, 178] },
  choir: { label: "Choir", classes: [25, 250] },
  brass: { label: "Brass", classes: [180, 182, 183, 181] },
  strings: { label: "Strings and orchestra", classes: [184, 185, 186, 187, 188, 189, 179] },
  piano: { label: "Piano", classes: [148, 149, 155] },
  organ: { label: "Organ", classes: [150, 151, 152] },
  guitar: { label: "Guitar", classes: [135, 136, 138, 139, 141, 511] },
  synth: { label: "Synthesiser", classes: [153] },
  woodwind: { label: "Woodwind", classes: [190, 191, 192, 193, 203, 205] },
  harp: { label: "Harp", classes: [194] },
  whistling: { label: "Whistling", classes: [35] },
  clapping: { label: "Clapping", classes: [58] },
  christmas: { label: "Christmassy", classes: [268], mood: true },
  happy: { label: "Happy", classes: [271], mood: true },
  sad: { label: "Sad", classes: [272], mood: true },
  tender: { label: "Tender", classes: [273], mood: true },
  exciting: { label: "Exciting", classes: [274], mood: true },
  angry: { label: "Angry", classes: [275], mood: true },
  scary: { label: "Scary", classes: [276], mood: true },
};

// The YAMNet classes the worker sends back, in this order (every sound's, once).
export const CLASSES = [...new Set(Object.values(SOUNDS).flatMap((s) => s.classes))].sort((a, b) => a - b);

export const FRAME_S = 0.1; // YAMNet scores a 0.96 s window every 0.1 s
const WINDOW_S = 0.96;
export const STEP_S = 0.5; // what's kept: each sound's score every half second
const SMOOTH_S = 2; // averaged over two seconds, so a sound has to last to count
const KEEP = 4; // a sound never scoring this much (of 100) isn't kept

// YAMNet's scores (frames × CLASSES, as the worker sends them) → what's kept with the song:
// {step, sounds: {key: [0-100 every step]}}, only sounds that are there somewhere.
export function soundsFrom(scores, duration) {
  const steps = Math.max(1, Math.ceil(duration / STEP_S));
  const col = new Map(CLASSES.map((c, i) => [c, i]));
  const out = {};
  for (const [key, s] of Object.entries(SOUNDS)) {
    // The sound's score in each frame: its loudest class.
    const per = scores.map((row) => Math.max(...s.classes.map((c) => row[col.get(c)] || 0)));
    const values = [];
    for (let k = 0; k < steps; k++) {
      // Frames whose window's middle falls within SMOOTH_S of this step's middle.
      const mid = (k + 0.5) * STEP_S;
      const a = Math.max(0, Math.ceil((mid - SMOOTH_S / 2 - WINDOW_S / 2) / FRAME_S));
      const b = Math.min(per.length - 1, Math.floor((mid + SMOOTH_S / 2 - WINDOW_S / 2) / FRAME_S));
      let sum = 0, n = 0;
      for (let j = a; j <= b; j++) { sum += per[j]; n++; }
      values.push(n ? Math.round((sum / n) * 100) : 0);
    }
    if (Math.max(...values) >= KEEP) out[key] = values;
  }
  return { step: STEP_S, sounds: out };
}

const THERE = 5; // a sound's average (of 100) over a stretch for it to count as heard there
const MOOD = 8;

// The sounds heard between start and end (seconds), loudest first: [key]. Moods come after the sounds.
export function soundsIn(kept, start = 0, end = Infinity) {
  if (!kept?.sounds) return [];
  const step = kept.step || STEP_S, found = [];
  for (const [key, values] of Object.entries(kept.sounds)) {
    if (!SOUNDS[key]) continue;
    const a = Math.max(0, Math.floor(start / step)), b = Math.min(values.length, Math.ceil(Math.min(end, values.length * step) / step));
    if (b <= a) continue;
    let sum = 0;
    for (let k = a; k < b; k++) sum += values[k];
    const avg = sum / (b - a);
    if (avg >= (SOUNDS[key].mood ? MOOD : THERE)) found.push([key, avg]);
  }
  return found.sort((x, y) => (SOUNDS[x[0]].mood ? 1 : 0) - (SOUNDS[y[0]].mood ? 1 : 0) || y[1] - x[1]).map(([k]) => k);
}

// What a stretch's sounds suggest for Generate: looks to lean towards, strongest sound first.
// Some for each loudness (autogen.js LOOKS: quiet, middle, loud), so every section has a choice.
export const SOUND_LOOKS = {
  sleighbells: ["twinkle", "fairy", "snow", "juggle", "dissolve", "drip", "fireworks"],
  bells: ["twinkle", "fairy", "dissolve", "drip", "comet", "fireworks", "ripple"],
  mallets: ["twinkle", "duo", "juggle", "tetris", "dissolve", "bounce"],
  choir: ["aurora", "flow", "gradient", "ocean", "comet", "lighthouse", "pulse", "ripple"],
  brass: ["pulse", "gradient", "theatre", "lighthouse", "trio", "fireworks"],
  strings: ["gradient", "flow", "ocean", "comet", "dissolve", "ripple", "cycle"],
  piano: ["twinkle", "fairy", "dissolve", "comet", "ripple"],
  organ: ["pulse", "aurora", "candles", "lighthouse", "gradient", "ripple"],
  guitar: ["duo", "pulse", "chase", "scanner", "trio", "strobe"],
  synth: ["cycle", "gradient", "rainbow", "scanner", "strobe"],
  woodwind: ["flow", "fairy", "ocean", "comet", "dissolve", "ripple", "bounce"],
  harp: ["fairy", "twinkle", "flow", "dissolve", "comet", "ripple"],
  whistling: ["flow", "fairy", "comet", "scanner", "bounce", "chase"],
  clapping: ["pulse", "duo", "theatre", "trio", "strobe"],
};

// The feel (autogen.js FEELS) a song's moods point to, for Surprise me; null if none stands out.
export function feelFor(kept) {
  const moods = soundsIn(kept).filter((k) => SOUNDS[k].mood);
  const to = { scary: "spooky", angry: "rock", exciting: "rock", happy: "playful", tender: "elegant", sad: "dreamy", christmas: null };
  for (const m of moods) if (to[m]) return to[m];
  return null;
}
