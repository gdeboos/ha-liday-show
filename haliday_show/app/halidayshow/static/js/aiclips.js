// "Describe it": what the editor tells the AI about the show, and how the clips it sends back are
// checked and placed. The model can get names, times or settings wrong, so nothing goes on the
// timeline until it has been matched to a real light and effect and clamped to valid values.

import { parseLyrics } from "./lyrics.js";
import { SOUNDS, soundsIn } from "./sounds.js";
import { CURVE_SHAPES, EFFECTS, MIXES, TRANSITIONS, clipPiece, defaultParams } from "./effects.js";
import { laneTakes, runsDownTree } from "./matrix.js";

const r2 = (t) => Math.round(t * 100) / 100;

// What each effect looks like, in a few words, so the AI can pick by look rather than by name.
export const EFFECT_NOTES = {
  solid: "one steady colour", duo: "two colours in blocks or alternating; can move like marquee lights",
  trio: "three colours in blocks or alternating; can move like marquee lights", pulse: "breathes in and out, or a heartbeat",
  gradient: "two or three colours blended along the light", cycle: "the whole light changes through colours",
  fade: "fades from one colour to another over the clip", chase: "a block of colour running along",
  rainbow: "a moving rainbow", comet: "a bright head with a fading tail running along", scanner: "a dot bouncing end to end",
  flicker: "fire or candle flicker", lightning: "random bright flashes", strobe: "rapid flashing", twinkle: "random sparkles",
  wipe: "fills the light with colour over the clip", eyes: "pairs of eyes that open, blink and close (Halloween)",
  fireworks: "bursts that bloom and fade", drip: "drops that swell, fall and splash (icicles)", candles: "every bulb its own candle",
  snow: "flakes (or rain) falling along the light", fairy: "old-fashioned coloured bulbs fading on and off",
  ocean: "rolling waves of blue", aurora: "drifting curtains of colour like the northern lights",
  flow: "soft patches of colour drifting and blending", sunrise: "a slow dawn (or sunset) over the clip",
  theatre: "one lit in every few, stepping along; can be rainbow", juggle: "coloured dots swinging with trails",
  ripple: "drops landing and rippling outwards", dissolve: "bulbs lighting one by one in random order, then going out",
  bounce: "bouncing balls, or popcorn", lighthouse: "a soft beam sweeping past", tetris: "blocks dropping and piling up",
  level: "lit up to a level that rises or falls over the clip", morph: "a band stretching to the far end then shrinking away",
  vumeter: "a level meter following the song's loudness",
  drumhits: "flashes on each hit of a drum (kick, snare, crash or hi-hat) found in the song's drums part; for the lights whose role is that drum",
  words: "pulses on each word as it's sung, from the song's lyrics, a new colour each line; for the vocals lights",
  sweep: "a band of colour crossing the house", housewipe: "fills the house with colour over the clip",
  wave: "a rainbow across the house", shockwave: "a ring spreading out from a point (big beats)",
  pinwheel: "spokes spinning round a point", curtain: "curtains opening or closing across the house",
  butterfly: "swirling waves of colour over the house", housesolid: "one colour on every light (good mixed)",
  housegradient: "colours blended across the house", housestripes: "stripes at any angle, still or moving (candy cane)",
  spiral: "stripes winding round a mega-tree matrix, turning over time; slanted moving stripes elsewhere (also on a matrix light itself)",
  plasma: "soft swirling blobs of colour that merge and move across the house (lava lamp, northern lights); also on a matrix light itself",
  singingface: "a cartoon character (snowman, pumpkin, gingerbread, Santa, ghost, reindeer, elf, Christmas tree, penguin, robin, teddy bear, skull, witch or black cat) whose mouth sings along with the vocals; for verses and choruses with singing",
  fire2d: "flames rising from the bottom of the grid", snowfall: "snow or rain falling down the grid",
  musicbars: "a bar per column rising and falling with the song's loudness, green to red",
  housechecks: "a chequerboard of colours", housewave: "the palette rolling across the house",
  housesparkle: "sparkles over every light", spotlight: "a soft light wandering over the house", housedots: "polka dots",
};

// Effects made for matrices that need your own words or pictures, which the AI can't supply.
const needsYou = (fx) => fx.params.some((p) => p.type === "text" || p.type === "picture");

// Every effect with its settings, as the AI sees them. Effects made for matrices are marked "matrix"
// and go only on matrix lights (on a strip they'd only show a slice); matrix false leaves them out.
export function effectsForAI({ matrix = true } = {}) {
  return Object.entries(EFFECTS).filter(([, fx]) => !fx.experimental && !fx.sceneOnly && !fx.phones && !(fx.grid && (needsYou(fx) || !matrix))).map(([key, fx]) => ({
    key, label: fx.label, ...(EFFECT_NOTES[key] ? { looks: EFFECT_NOTES[key] } : {}), ...(fx.house ? { house: true } : {}),
    ...(fx.grid ? { matrix: true } : {}),
    settings: fx.params.map((p) => ({
      key: p.key, type: p.type === "range" ? "number" : p.type,
      ...(p.min !== undefined ? { min: p.min, max: p.max } : {}),
      ...(p.options ? { options: p.options } : {}),
      default: p.default,
    })),
  }));
}

// The show as the AI sees it. lights: [{name, trackIndex, segments, house, slow, matrix: {w, h, shape}}], with the House lane
// as a light named "House" (only when lights are traced on the house photo); selection: {start, end, lights: [names]} or null.
export function buildContext({ show, lights, duration, selection = null, palettes = [], sounds = null }) {
  const effects = effectsForAI({ matrix: lights.some((l) => l.matrix) });
  const beats = show.beats || [];
  // The song's cues, where it has them: its drum hits (from its drums part) and its lyrics.
  const path = show.audio?.path;
  const drums = show.drums && (!show.drums.song || show.drums.song === path) ? show.drums : null;
  const lyr = show.lyrics && (!show.lyrics.song || show.lyrics.song === path) ? show.lyrics : null;
  const lineText = parseLyrics(lyr?.text);
  const lines = lyr && Array.isArray(lyr.lines) && lyr.lines.length === lineText.length
    ? lineText.map((l, i) => ({ start: r2(Number(lyr.lines[i].start) || 0), text: l.text })).slice(0, 150) : [];
  const count = (list, a, b) => (list || []).filter((t) => t >= a && t < b).length;
  return {
    song: {
      duration: r2(duration),
      tempo: show.tempo || null,
      // Long songs send bars only, to keep the request small.
      ...(beats.length <= 600 ? { beats: beats.map(r2) } : {}),
      bars: (show.bars || []).map(r2),
      sections: (show.sections || []).map((s) => ({
        start: r2(s.start), end: r2(s.end), label: s.label, energy: s.energy, ...(s.notes ? { notes: s.notes } : {}),
        // How many of each drum hit in it, and when its crashes land.
        ...(drums ? { drums: { kick: count(drums.kick, s.start, s.end), snare: count(drums.snare, s.start, s.end),
          crashes: (drums.crash || []).filter((t) => t >= s.start && t < s.end).slice(0, 12).map(r2) } } : {}),
        // What can be heard in it (sleigh bells, a choir…: sounds.js), where the song's been listened to.
        ...(sounds ? { sounds: soundsIn(sounds, s.start, s.end).filter((k) => !SOUNDS[k].mood).map((k) => SOUNDS[k].label) } : {}),
      })),
      ...(lines.length ? { lyrics: lines } : {}),
      ...(sounds ? { sounds: soundsIn(sounds).filter((k) => !SOUNDS[k].mood).map((k) => SOUNDS[k].label),
        mood: soundsIn(sounds).filter((k) => SOUNDS[k].mood).map((k) => SOUNDS[k].label) } : {}),
    },
    lights: lights.map((l) => ({ name: l.name, segments: l.segments, ...(l.house ? { house: true } : {}),
      ...(l.slow ? { slow: true } : {}), ...(l.matrix ? { matrix: l.matrix } : {}), ...(l.role ? { role: l.role } : {}) })),
    effects,
    palettes: palettes.map((p) => ({ name: p.name, colors: p.colors })),
    selection: selection && { start: r2(selection.start), end: r2(selection.end), lights: selection.lights },
    clips: Object.fromEntries(lights.map((l) => [l.name, (show.tracks[l.trackIndex]?.clips || []).slice(0, 60)
      .map((c) => ({ start: r2(c.start), end: r2(c.end), effect: c.effect }))])),
  };
}

// One setting's value from the AI's text, checked against the effect's definition; undefined if
// it isn't valid.
function settingValue(def, raw) {
  const text = String(raw ?? "").trim();
  if (def.type === "color") {
    const m = /^#?([0-9a-f]{6})$/i.exec(text);
    return m ? `#${m[1].toLowerCase()}` : undefined;
  }
  if (def.type === "number" || def.type === "range") {
    const v = Number(text);
    if (!Number.isFinite(v)) return undefined;
    return Math.min(Math.max(v, def.min ?? -Infinity), def.max ?? Infinity);
  }
  if (def.type === "select") return def.options.map(String).find((o) => o.toLowerCase() === text.toLowerCase());
  return undefined;
}

// Checks the AI's settings for an effect: {key: value} with only valid keys and values.
function checkSettings(fx, settings) {
  const out = {};
  for (const s of Array.isArray(settings) ? settings : []) {
    const def = fx.params.find((p) => p.key === s?.key);
    const v = def && settingValue(def, s.value);
    if (v !== undefined) out[def.key] = v;
  }
  return out;
}

const norm = (s) => String(s || "").trim().toLowerCase();

// The extras the AI may give a clip, checked: how it comes in and goes out, settings that change over
// it, and (on the House lane) how it mixes with the lights' own effects. Anything invalid is left out.
function extras(fx, c, length, light) {
  const out = {};
  for (const [field, key] of [["in", "transIn"], ["out", "transOut"]]) {
    const type = norm(c?.[field]?.type), secs = Number(c?.[field]?.seconds);
    if (TRANSITIONS.includes(type) && type !== "none" && Number.isFinite(secs) && secs > 0) {
      out[key] = type;
      out[`${key}Secs`] = r2(Math.min(secs, length, 30));
    }
  }
  const curves = {};
  for (const ch of Array.isArray(c?.changes) ? c.changes : []) {
    const def = fx.params.find((p) => p.key === ch?.key && (p.type === "number" || p.type === "range"));
    const to = def && settingValue(def, ch.to);
    if (to === undefined) continue;
    curves[def.key] = { to, shape: CURVE_SHAPES.includes(norm(ch.shape)) ? norm(ch.shape) : "steady" };
  }
  if (Object.keys(curves).length) out.curves = curves;
  const mix = norm(c?.mix);
  if (light.house && MIXES.includes(mix) && mix !== "cover") out.mix = mix;
  return out;
}

// Checks the AI's clips and turns them into real ones: [{trackIndex, clip}], plus how many were
// left out and why. lights is the same list buildContext had, with each light's trackIndex.
export function checkClips(reply, lights, duration) {
  const byName = new Map(lights.map((l) => [norm(l.name), l]));
  const placed = [], skipped = [];
  for (const c of Array.isArray(reply?.clips) ? reply.clips : []) {
    const light = byName.get(norm(c?.light));
    const fx = EFFECTS[c?.effect];
    if (!light) { skipped.push(`no light called "${c?.light}"`); continue; }
    if (!fx || fx.experimental || fx.sceneOnly) { skipped.push(`no effect called "${c?.effect}"`); continue; }
    if (fx.grid && (!light.matrix || needsYou(fx))) {
      skipped.push(light.matrix ? `${fx.label} needs your own words or pictures` : `${fx.label} only works on a matrix`);
      continue;
    }
    if (!laneTakes(c.effect, fx, light.house ? "house" : light.matrix ? "matrix" : "light")) { skipped.push(`${fx.label} can't go on ${light.name}`); continue; }
    const start = Math.max(0, Number(c.start)), end = Math.min(duration, Number(c.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.05) { skipped.push("a clip with bad times"); continue; }
    const clip = { effect: c.effect, start: r2(start), end: r2(end), ...defaultParams(c.effect), ...checkSettings(fx, c.settings),
      ...extras(fx, c, end - start, light) };
    // A mega-tree's strings are its columns, so effects run down them.
    if (light.matrix?.shape === "tree" && runsDownTree(fx)) clip.runs = "columns";
    placed.push({ trackIndex: light.trackIndex, clip });
  }
  return { placed, skipped };
}

// Puts checked clips on the show: each replaces what its light had in that stretch (clips that
// were there are trimmed or removed), while new clips on the same light can overlap each other.
export function placeClips(show, placed) {
  const before = new Map();
  for (const { trackIndex } of placed) before.set(trackIndex, [...show.tracks[trackIndex].clips]);
  for (const [t, old] of before) {
    let kept = old;
    for (const { trackIndex, clip: n } of placed) {
      if (trackIndex !== t) continue;
      const next = [];
      for (const c of kept) {
        if (c.end <= n.start || c.start >= n.end) { next.push(c); continue; }
        if (c.start < n.start) next.push(clipPiece(c, c.start, n.start));
        if (c.end > n.end) next.push(clipPiece(c, n.end, c.end));
      }
      kept = next;
    }
    const added = placed.filter((p) => p.trackIndex === t).map((p) => p.clip).sort((a, b) => a.start - b.start);
    show.tracks[t].clips = [...kept, ...added];
  }
}

// Checks the AI's presets and turns them into real ones: [{name, effect, params}], plus how many
// were left out and why. A preset keeps only the settings the AI chose, like one saved from a clip.
export function checkPresets(reply) {
  const presets = [], skipped = [];
  for (const p of Array.isArray(reply?.presets) ? reply.presets : []) {
    const fx = EFFECTS[p?.effect];
    if (!fx || fx.experimental || fx.sceneOnly) { skipped.push(`no effect called "${p?.effect}"`); continue; }
    const name = String(p.name || "").trim().slice(0, 60) || `AI ${fx.label.toLowerCase()}`;
    presets.push({ name, effect: p.effect, params: checkSettings(fx, p.settings) });
  }
  return { presets, skipped };
}

// Palettes from the AI: colours must be #rrggbb (a missing # is fine), at most 12 a palette, and a
// palette needs two to be worth keeping.
export function checkPalettes(reply) {
  const palettes = [], skipped = [];
  for (const p of Array.isArray(reply?.palettes) ? reply.palettes : []) {
    const colors = (Array.isArray(p?.colors) ? p.colors : [])
      .map((c) => String(c).trim().replace(/^#?/, "#").toLowerCase())
      .filter((c) => /^#[0-9a-f]{6}$/.test(c)).slice(0, 12);
    const name = String(p?.name || "").trim().slice(0, 60) || "AI palette";
    if (colors.length < 2) { skipped.push(`"${name}" had too few colours`); continue; }
    palettes.push({ name, colors });
  }
  return { palettes, skipped };
}
