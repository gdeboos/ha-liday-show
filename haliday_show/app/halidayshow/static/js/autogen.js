// Generates a first draft of a show from the song's analysis (beats, bars, sections), a colour
// palette and a style. Rule-based: quiet sections get slow, soft looks, loud ones fast looks that
// move on the beat, sections that repeat get the same looks, and looks change every few bars.
// With build, it lights the house the way a person would: a few lights in quiet parts, more as the
// music builds, and every light together only for the loudest parts and the chorus.

import { EFFECTS, HOUSE, clipPiece, isGroupTrack, newClip } from "./effects.js";
import { runsDownTree } from "./matrix.js";
import { applyPalette } from "./palettes.js";
import { parseLyrics } from "./lyrics.js";

// What a light does with its role (roles.js) in a lively stretch of the song, when the song gives it
// something to follow: a drum's light flashes on that drum's hits (Drum hits), a vocals light pulses on
// the words (Words), a bass light follows the music's level. Quiet stretches keep their calm looks.
const DRUM_OF = { kick: ["kick", "kick"], snare: ["snare", "snare"], crash: ["crash", "crash"] };
const HIT_STYLES = ["flash", "burst", "sparkle"];

// The song's cues from the show (analysis): its drum hits and sung words, and where its lyric lines
// start, with which lines come back (a chorus).
function songCues(analysis) {
  const drums = analysis.drums && typeof analysis.drums === "object" ? analysis.drums : null;
  const lyr = analysis.lyrics, forSong = !lyr?.song || !analysis.audio || lyr.song === analysis.audio.path;
  const words = forSong && Array.isArray(lyr?.words) ? lyr.words : [];
  const text = forSong ? parseLyrics(lyr?.text).map((l) => l.text.toLowerCase().replace(/[^a-z' ]/g, "").trim()) : [];
  const starts = forSong && Array.isArray(lyr?.lines) && lyr.lines.length === text.length ? lyr.lines.map((l) => Number(l.start) || 0) : [];
  const seen = new Map();
  for (const t of text) seen.set(t, (seen.get(t) || 0) + 1);
  const lines = starts.map((start, i) => ({ start, again: !!text[i] && seen.get(text[i]) > 1 }));
  const count = (list, a, b) => (list || []).filter((t) => t >= a && t < b).length;
  return {
    hits: (kind, a, b) => (drums ? count(drums[kind], a, b) : 0),
    words: (a, b) => words.filter((w) => w[0] >= a && w[0] < b).length,
    lines,
    // A section most of whose lines come back elsewhere in the song: a chorus, whatever it's called.
    sungChorus: (sec) => {
      const mine = lines.filter((l) => l.start >= sec.start && l.start < sec.end);
      return mine.length >= 2 && mine.filter((l) => l.again).length / mine.length >= 0.6;
    },
    lastCrash: drums?.crash?.length ? drums.crash[drums.crash.length - 1] : null,
  };
}

// How a style shifts a section's energy before picking looks, and how often looks change.
export const STYLES = {
  calm: { label: "Calm", bias: -0.25, phraseBars: 8 },
  balanced: { label: "Balanced", bias: 0, phraseBars: 4 },
  lively: { label: "Lively", bias: 0.2, phraseBars: 4 },
};

// Looks by energy. Each takes the beats per second and the light's segment count and returns an
// effect and its settings; colours come from the palette afterwards. Speeds are set from the tempo
// so movement lands on the beat: one step a beat, one lap or sweep a bar.
const LOOKS = {
  low: [
    { effect: "gradient", label: "Slow drift", params: () => ({ count: "3", speed: 0.1 }) },
    { effect: "pulse", label: "Breathe each bar", params: (bps) => ({ rate: bps / 4, background: "#000000" }) },
    { effect: "twinkle", label: "Gentle twinkle", params: () => ({ density: 20, rate: 2, background: "#000000" }) },
    { effect: "duo", label: "Still blocks", params: () => ({ layout: "split", speed: 0 }) },
    { effect: "cycle", label: "Slow colour fade", params: (bps) => ({ rate: bps / 8, blend: "fade" }) },
    { effect: "fairy", label: "Fairy lights", params: (bps) => ({ rate: bps / 8, density: 70, background: "#000000" }) },
    { effect: "ocean", label: "Gentle waves", params: () => ({ speed: 0.4, size: 1 }) },
    { effect: "aurora", label: "Aurora", params: () => ({ speed: 0.4, background: "#000000" }) },
    { effect: "flow", label: "Flowing colours", params: (bps, n) => ({ speed: 0.15, size: Math.max(4, Math.round(n / 3)) }) },
  ],
  mid: [
    { effect: "trio", label: "Marquee on the beat", params: (bps) => ({ layout: "alternate", size: 1, speed: bps }) },
    { effect: "chase", label: "Chase, a lap a bar", params: (bps, n) => ({ width: Math.min(50, Math.max(1, Math.round(n / 5))), speed: bps / 4 }) },
    { effect: "comet", label: "Comet, a lap a bar", params: (bps, n) => ({ length: Math.max(2, Math.round(n / 3)), speed: bps / 4 }) },
    { effect: "scanner", label: "Scanner, a sweep a bar", params: (bps, n) => ({ width: Math.max(1, n / 8), speed: bps / 4 }) },
    { effect: "cycle", label: "Colour change each beat", params: (bps) => ({ rate: bps, blend: "step" }) },
    { effect: "gradient", label: "Flowing gradient", params: () => ({ count: "3", speed: 0.5 }) },
    { effect: "theatre", label: "Theatre chase on the beat", params: (bps) => ({ every: 3, speed: bps, background: "#000000" }) },
    { effect: "juggle", label: "Juggle", params: (bps) => ({ speed: bps / 2, trail: 0.6, background: "#000000" }) },
    { effect: "dissolve", label: "Dissolve each bar", params: (bps) => ({ seconds: 2 / bps, background: "#000000" }) },
    { effect: "lighthouse", label: "Beam each bar", params: (bps) => ({ rate: bps / 4, glow: 15, background: "#000000" }) },
  ],
  high: [
    { effect: "cycle", label: "Colour flash each beat", params: (bps) => ({ rate: bps, blend: "step" }) },
    { effect: "duo", label: "Fast marquee", params: (bps) => ({ layout: "alternate", size: 1, speed: bps * 2 }) },
    { effect: "chase", label: "Fast chase", params: (bps) => ({ width: 2, speed: bps / 2 }) },
    { effect: "twinkle", label: "Sparkle storm", params: () => ({ density: 60, rate: 10, background: "#000000" }) },
    { effect: "pulse", label: "Pulse each beat", params: (bps) => ({ rate: bps, background: "#000000" }) },
    { effect: "trio", label: "Wide fast marquee", params: (bps) => ({ layout: "alternate", size: 2, speed: bps * 2 }) },
    { effect: "fireworks", label: "Fireworks on the beat", params: (bps, n) => ({ rate: bps, size: Math.max(3, Math.round(n / 6)), background: "#000000" }) },
    { effect: "ripple", label: "Ripples on the beat", params: (bps, n) => ({ rate: bps, speed: Math.max(5, n / 2), background: "#000000" }) },
    { effect: "theatre", label: "Fast theatre chase", params: (bps) => ({ every: 3, speed: bps * 2, background: "#000000" }) },
    { effect: "bounce", label: "Bouncing on the beat", params: (bps) => ({ balls: 4, speed: bps / 2, background: "#000000" }) },
  ],
};

// Looks for slow lights (see lightspeed.js): the whole light changing at once, or blocks and gradients
// that hardly move, so they look right at a few changes a second. Nothing faster than once a beat.
const SLOW_LOOKS = {
  low: [
    { effect: "gradient", label: "Slow drift", params: () => ({ count: "3", speed: 0.05 }) },
    { effect: "pulse", label: "Breathe each bar", params: (bps) => ({ rate: bps / 4, background: "#000000" }) },
    { effect: "duo", label: "Still blocks", params: () => ({ layout: "split", speed: 0 }) },
    { effect: "cycle", label: "Slow colour fade", params: (bps) => ({ rate: bps / 8, blend: "fade" }) },
  ],
  mid: [
    { effect: "cycle", label: "Colour change each beat", params: (bps) => ({ rate: bps, blend: "step" }) },
    { effect: "pulse", label: "Pulse each bar", params: (bps) => ({ rate: bps / 4, background: "#000000" }) },
    { effect: "cycle", label: "Colour fade each bar", params: (bps) => ({ rate: bps / 4, blend: "fade" }) },
    { effect: "duo", label: "Blocks, still", params: () => ({ layout: "split", speed: 0 }) },
  ],
  high: [
    { effect: "cycle", label: "Colour flash each beat", params: (bps) => ({ rate: bps, blend: "step" }) },
    { effect: "pulse", label: "Pulse each beat", params: (bps) => ({ rate: bps, background: "#000000" }) },
    { effect: "cycle", label: "Colour flash every two beats", params: (bps) => ({ rate: bps / 2, blend: "step" }) },
    { effect: "pulse", label: "Pulse every two beats", params: (bps) => ({ rate: bps / 2, background: "#000000" }) },
  ],
};

// Looks drawn across a matrix's grid, used there alongside the strip looks. Not Scrolling text or
// Picture: they need your words or pictures.
const GRID_LOOKS = {
  low: [
    { effect: "plasma", label: "Lava lamp", params: () => ({ size: 1, speed: 0.3 }) },
    { effect: "snowfall", label: "Gentle snowfall", params: () => ({ density: 10, speed: 3 }) },
    { effect: "spiral", label: "Slow spiral", params: () => ({ stripes: 2, twist: 1, speed: 0.15, soft: 40 }) },
  ],
  mid: [
    { effect: "spiral", label: "Spiral, a turn a bar", params: (bps) => ({ stripes: 2, twist: 1.5, speed: bps / 4, soft: 20 }) },
    { effect: "plasma", label: "Swirling plasma", params: () => ({ size: 1.5, speed: 1 }) },
    { effect: "snowfall", label: "Snowfall", params: () => ({ density: 25, speed: 6 }) },
  ],
  high: [
    { effect: "fire2d", label: "Fire", params: () => ({ speed: 1.5, height: 90 }) },
    { effect: "musicbars", label: "Music bars", params: () => ({ boost: 150 }) },
    { effect: "spiral", label: "Fast spiral", params: (bps) => ({ stripes: 3, twist: 2, speed: bps / 2, soft: 10 }) },
    { effect: "snowfall", label: "Driving rain", params: () => ({ style: "rain", density: 30, speed: 20 }) },
  ],
};

// A repeatable pseudo-random number in [0, 1) from any number of integers.
function hash(...xs) {
  let h = 2166136261;
  for (const x of xs) h = Math.imul(h ^ (x | 0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const textHash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

export function tier(energy, style = "balanced") {
  const e = energy + (STYLES[style]?.bias ?? 0);
  return e < 0.35 ? "low" : e < 0.7 ? "mid" : "high";
}

// The bar grid to place clips on: detected bars, else every fourth beat, else two-second blocks.
export function barGrid({ bars = [], beats = [], duration }) {
  let grid = bars.length >= 2 ? bars : beats.length >= 8 ? beats.filter((_, i) => i % 4 === 0) : [];
  if (!grid.length) for (let t = 0; t < duration; t += 2) grid.push(t);
  grid = grid.filter((t) => t > 0.05 && t < duration - 0.05);
  return [0, ...grid, duration];
}

function beatsPerSecond({ tempo, beats = [] }) {
  if (tempo > 0) return tempo / 60;
  if (beats.length >= 2) return (beats.length - 1) / (beats[beats.length - 1] - beats[0]);
  return 2;
}

const round = (t) => Math.round(t * 1000) / 1000;
const tidy = (params) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 100) / 100 : v]));

function clipFor(look, start, end, bps, n, colors, offset) {
  const clip = { ...newClip(look.effect, round(start), round(end)), ...tidy(look.params(bps, n)) };
  applyPalette(clip, colors, offset);
  return clip;
}

// analysis: {beats, bars, sections, tempo, duration}; lights: [{id, segments, slow, fits, grid, tree}], grid
// ({w, h}) for a matrix (it also gets GRID_LOOKS), tree for a mega-tree (strip looks run down its strings), slow for lights
// that can only change a few times a second (they get SLOW_LOOKS), fits(clip) false for a clip the light
// can't show (another of the section's looks is used instead);
// group: the light a part belongs to (parts of one light go dark or light up together; default its id);
// role: what the light reacts to (roles.js), for lively stretches: see roleLook;
// colors: the palette's colours. Returns {clips: {deviceId: [clip]}, house: [clip]}.
// maxBars caps how long one look runs (0: as long as the style likes, up to 16 bars in quiet parts).
// analysis may carry the song's cues: drums (its drum hits) and lyrics (show.lyrics: its lines and
// sung words), which put looks on the lines, find the chorus, and give lights with roles their moments.
// The House lane is saved for the biggest moments: the first and last chorus, and the final crash.
export function generateShow(analysis, lights, colors, { style = "balanced", seed = 1, house = false, build = false, maxBars = 0 } = {}) {
  const duration = analysis.duration;
  const cues = songCues(analysis);
  const bps = beatsPerSecond(analysis);
  const grid = barGrid(analysis);
  const sections = analysis.sections?.length ? analysis.sections : [{ start: 0, end: duration, label: "Song", energy: 0.6 }];
  const phraseBars = STYLES[style]?.phraseBars ?? 4;
  const clips = Object.fromEntries(lights.map((l) => [l.id, []]));
  const houseClips = [];
  let prevTier = null;
  const marks = []; // each section's start, for the House lane's few big moments
  const groups = [...new Set(lights.map((l) => l.group ?? l.id))];
  // Building up needs the song's sections; without them every light plays, as before.
  if (!analysis.sections?.length) build = false;
  // Every light gets its moment: if no section is loud or a chorus, the loudest one uses them all.
  const together = (sec, t) => t === "high" || sec.label === "Chorus" || cues.sungChorus(sec);
  const peak = sections.some((sec) => together(sec, tier(sec.energy ?? 0.5, style))) ? null
    : Math.max(...sections.map((sec) => sec.energy ?? 0.5));

  // A light's look from its role, for a lively stretch the song gives it something in; else null.
  const roleLook = (light, start, end, t, phrase, li) => {
    if (!light.role || light.slow) return null; // a slow light keeps its slow looks
    const beats = (end - start) * bps, offset = phrase + li;
    const make = (effect, params) => {
      const c = { ...newClip(effect, round(start), round(end)), ...params };
      applyPalette(c, colors, offset);
      return c;
    };
    if (light.role === "background") return t === "low" ? null : clipFor(LOOKS.low[(phrase + li) % LOOKS.low.length], start, end, bps, light.segments, colors, offset);
    if (t === "low") return null;
    const drum = DRUM_OF[light.role];
    if (drum) {
      const n = cues.hits(drum[0], start, end);
      // Kicks and snares need to be keeping time (one every other beat or so); a crash just has to be there.
      if (light.role === "crash" ? n < 1 : n < beats / 4) return null;
      return make("drumhits", { drum: drum[1], decay: light.role === "crash" ? 0.9 : 0.25,
        style: light.grid ? "burst" : HIT_STYLES[Math.floor(hash(seed, li, phrase) * HIT_STYLES.length)] });
    }
    if (light.role === "vocals" && !light.grid && cues.words(start, end) >= 3) return make("words", { decay: 0.35 });
    if (light.role === "bass" && t === "high") return make("vumeter", { from: "the middle", boost: 140, peak: "off" });
    return null;
  };

  sections.forEach((sec, si) => {
    const t = tier(sec.energy ?? 0.5, style);
    // Two looks per section, picked by its name so a repeated chorus looks the same each time.
    const key = textHash(sec.label || `s${si}`);
    const pick = (set) => {
      const a = Math.floor(hash(key, seed) * set.length);
      const b = (a + 1 + Math.floor(hash(key, seed, 7) * (set.length - 1))) % set.length;
      return [set[a], set[b]];
    };
    const fast = pick(LOOKS[t]), slow = pick(SLOW_LOOKS[t]), grid2d = pick(GRID_LOOKS[t]);
    // A matrix swaps the section's second look for one drawn across its grid.
    const onGrid = [fast[0], grid2d[0]];
    // Loud sections and the chorus move together on every light; the rest alternate across lights.
    const unison = together(sec, t);
    // Which lights play: by the section's name, so a repeated verse uses the same ones, and in an
    // order that holds for the whole section, so lights join rather than swap as it builds.
    const order = [...groups].sort((a, b) => hash(key, seed, textHash(String(a))) - hash(key, seed, textHash(String(b))));
    const lit = (phrase) => {
      if (!build || unison || (sec.energy ?? 0.5) === peak) return new Set(groups);
      const n = groups.length;
      if (t === "low") return new Set(order.slice(0, Math.max(1, Math.round(n / 3))));
      const target = Math.max(1, Math.ceil((n * 2) / 3));
      return new Set(order.slice(0, Math.min(target, Math.max(1, Math.ceil(target / 2)) + phrase)));
    };
    const bars = grid.filter((g) => g >= sec.start - 0.05 && g <= sec.end + 0.05);
    if (bars[0] > sec.start + 0.05) bars.unshift(sec.start);
    if (bars[bars.length - 1] < sec.end - 0.05) bars.push(sec.end);
    const step = Math.min(t === "low" ? phraseBars * 2 : phraseBars, maxBars > 0 ? maxBars : Infinity);
    // Looks change where a lyric line starts, when one starts within a bar of where they'd change.
    const barLen = bars.length > 1 ? (bars[bars.length - 1] - bars[0]) / (bars.length - 1) : 2;
    const onLine = (at) => {
      if (at <= sec.start + 0.05 || at >= sec.end - 0.05) return at;
      const near = cues.lines.map((l) => l.start).filter((x) => Math.abs(x - at) <= barLen && x > sec.start + 0.05 && x < sec.end - 0.05)
        .sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0];
      return near ?? at;
    };
    let carry = null; // where a phrase snapped too short to keep started: the next one starts there instead
    for (let k = 0, phrase = 0; k < bars.length - 1; k += step, phrase++) {
      const start = carry ?? (k ? onLine(bars[k]) : bars[k]), end = k + step < bars.length - 1 ? onLine(bars[k + step]) : bars[bars.length - 1];
      if (end - start < 0.2) { carry = start; continue; }
      carry = null;
      const on = lit(phrase);
      lights.forEach((light, li) => {
        if (!on.has(light.group ?? light.id)) return;
        const look = (light.slow ? slow : light.grid ? onGrid : fast)[(phrase + (unison ? 0 : li)) % 2];
        const make = (l) => {
          const c = clipFor(l, start, end, bps, light.segments, colors, unison ? li : phrase);
          if (light.tree && runsDownTree(EFFECTS[c.effect])) c.runs = "columns";
          return c;
        };
        let clip = roleLook(light, start, end, t, phrase, li) || make(look);
        if (light.fits && !light.fits(clip)) {
          for (const other of (light.slow ? SLOW_LOOKS : LOOKS)[t]) {
            const c = make(other);
            if (light.fits(c)) { clip = c; break; }
          }
        }
        clips[light.id].push(clip);
      });
    }
    marks.push({ si, start: sec.start, next: bars[1] ?? sec.end, unison, lift: si > 0 && { low: 0, mid: 1, high: 2 }[t] > { low: 0, mid: 1, high: 2 }[prevTier ?? "low"] });
    prevTier = t;
  });

  // The House lane lights every light, so it's kept for the biggest moments, at most three: a sweep as
  // the first all-lights section (the first chorus) comes in, a ring as the last one does, and a ring
  // on the song's final crash. A song with none of those gets a sweep into its biggest lift.
  if (house) {
    const big = marks.filter((m) => m.si > 0 && m.unison);
    const first = big[0] || marks.find((m) => m.lift), last = big.length > 1 ? big[big.length - 1] : null;
    if (first) {
      const sweep = newClip("sweep", round(first.start), round(first.next));
      Object.assign(sweep, { color: colors[first.si % colors.length], outside: "lights' own effects", width: 0.3,
        direction: first.si % 2 ? "left to right" : "out from centre" });
      houseClips.push(sweep);
    }
    const ring = (at, until, k) => Object.assign(newClip("shockwave", round(at), round(until)),
      { color: colors[k % colors.length], outside: "lights' own effects", rings: 1, width: 0.15, y: 100, mix: "add" });
    if (last) houseClips.push(ring(last.start, last.next, last.si + 1));
    const crash = cues.lastCrash;
    if (crash != null && crash > duration * 0.6 && !houseClips.some((c) => crash > c.start - 1 && crash < c.end + 1)) {
      houseClips.push(ring(crash, Math.min(duration, crash + 1.5), 2));
    }
  }

  // Fade in over the first bar and out over the last two when the song starts or ends quietly.
  const first = sections[0], last = sections[sections.length - 1];
  const keep = (list) => list.filter((c) => c.end - c.start >= 0.05);
  for (const light of lights) {
    let list = clips[light.id];
    // Only a light that's on at the very start fades in, and one on at the very end fades out.
    if (list.length && list[0].start <= first.start + 0.05 && tier(first.energy ?? 0.5, style) === "low") {
      // Up to the first bar line at least a second and a half in, past any pickup.
      const to = round(grid.find((g) => g >= 1.5) ?? duration);
      for (const c of list) c.start = round(Math.min(Math.max(c.start, to), c.end));
      list = [Object.assign(newClip("fade", 0, to), { from: "#000000", to: colors[0] }), ...keep(list)];
    }
    if (list.length && list[list.length - 1].end >= duration - 0.05 && tier(last.energy ?? 0.5, style) === "low") {
      const from = round(grid[Math.max(0, grid.length - 3)]);
      for (const c of list) if (c.end > from) c.end = round(Math.max(c.start, from));
      list = [...keep(list), Object.assign(newClip("fade", from, round(duration)), { from: colors[0], to: "#000000" })];
    }
    clips[light.id] = list;
  }

  // Changes at a section's start crossfade (two beats in a quiet section, one otherwise), and a light
  // coming on after being dark fades in, and one going dark fades out, over a beat. Phrase changes within
  // a section stay on the beat.
  const beat = 1 / bps;
  const startsAt = (t) => sections.find((sec) => Math.abs(sec.start - t) < 0.05 && sec.start > 0.05);
  for (const light of lights) {
    const list = clips[light.id];
    list.forEach((c, k) => {
      if (c.effect === "fade") return; // the opening and closing fades
      const prev = list[k - 1], next = list[k + 1];
      const len = c.end - c.start;
      const sec = startsAt(c.start);
      const joined = prev && Math.abs(prev.end - c.start) < 0.02;
      if (sec || (!joined && c.start > 0.05)) {
        const quiet = sec && tier(sec.energy ?? 0.5, style) === "low";
        c.transIn = "fade";
        c.transInSecs = round(Math.min(beat * (quiet ? 2 : 1), len / 3));
      }
      if (!(next && Math.abs(next.start - c.end) < 0.02) && c.end < duration - 0.05) {
        c.transOut = "fade";
        c.transOutSecs = round(Math.min(beat, len / 3));
      }
    });
  }
  return { clips, house: houseClips };
}

// Looks that suit a stretch of the song, for the effect chooser: the ones Generate would pick from
// for the section it falls in, with speeds set from the tempo (slow-light looks for a slow light).
// Returns the section (or null) and
// [{effect, label, params}].
export function suggestLooks(analysis, start, end, segments = 15, style = "balanced", slow = false) {
  const overlap = (s) => Math.min(s.end, end) - Math.max(s.start, start);
  const section = (analysis.sections || []).reduce((best, s) => (overlap(s) > 0 && (!best || overlap(s) > overlap(best)) ? s : best), null);
  const t = tier(section?.energy ?? 0.5, style);
  const bps = beatsPerSecond(analysis);
  return { section, tier: t, looks: (slow ? SLOW_LOOKS : LOOKS)[t].map((look) => ({ effect: look.effect, label: look.label, params: tidy(look.params(bps, segments)) })) };
}

// Puts generated clips on the show's tracks, replacing what the lights (and, with house clips,
// the House lane) had.
export function applyGenerated(show, result) {
  for (const tr of show.tracks) {
    if (tr.device === HOUSE) { if (result.house.length) tr.clips = result.house; }
    // Group lanes would cover the new look, so a whole new take clears them (Ctrl+Z brings them back).
    else if (isGroupTrack(tr.device)) tr.clips = [];
    else if (result.clips[tr.device]) tr.clips = result.clips[tr.device];
  }
}

// Generating one part of a show (a selection, or one of the song's sections) leaves the rest alone.
// clearPart: the clips with start–end taken out, cutting any that run across its edges.
export function clearPart(clips, start, end) {
  const out = [];
  for (const c of clips) {
    if (c.end <= start || c.start >= end) { out.push(c); continue; }
    if (c.start < start - 0.01) out.push(clipPiece(c, c.start, start));
    if (c.end > end + 0.01) out.push(clipPiece(c, end, c.end));
  }
  return out;
}

// partOf: the clips that fall in start–end, cut to it (slivers under 0.05 s are dropped).
export function partOf(clips, start, end) {
  return clips.filter((c) => Math.min(c.end, end) - Math.max(c.start, start) >= 0.05)
    .map((c) => (c.start >= start && c.end <= end ? c : clipPiece(c, Math.max(c.start, start), Math.min(c.end, end))));
}

// Puts a generated take on the show for start–end only, on the tracks (indexes) given: lights get
// the new clips there, group lanes are cleared there (they'd cover the new look), and the House lane
// gets the take's sweeps there when `house` is on. Everything outside the part, or on other tracks,
// stays as it was.
export function applyGeneratedPart(show, result, { start, end, tracks, house = false }) {
  show.tracks.forEach((tr, i) => {
    if (!tracks.has(i)) return;
    const fresh = tr.device === HOUSE ? (house ? result.house : null) : isGroupTrack(tr.device) ? [] : result.clips[tr.device];
    if (!fresh) return;
    tr.clips = [...clearPart(tr.clips, start, end), ...partOf(fresh, start, end)].sort((a, b) => a.start - b.start);
  });
}

// Cuts any clip longer than maxBars bars into pieces at bar lines, each later piece taking the next
// colours of the palette, so the look keeps changing (for the AI's clips: asking it for many short
// clips instead could run past how much it may write at once). bars: bar start times; without them,
// four beats of `bps` (beats a second) make a bar. Returns new clips; short ones are left as they are.
export function splitLong(clips, { maxBars, bars = [], bps = 2, colors = [] }) {
  if (!(maxBars > 0)) return clips;
  const out = [];
  for (const clip of clips) {
    // Where each piece may end: every maxBars-th bar line from the clip's start.
    let cuts;
    const inside = bars.filter((t) => t > clip.start + 0.05 && t < clip.end - 0.05);
    if (bars.length >= 2) cuts = inside.filter((_, i) => (i + 1) % maxBars === 0);
    else {
      const span = (maxBars * 4) / bps;
      cuts = [];
      for (let t = clip.start + span; t < clip.end - 0.05; t += span) cuts.push(t);
    }
    if (!cuts.length) { out.push(clip); continue; }
    [clip.start, ...cuts].forEach((start, k, all) => {
      const piece = { ...clip, start: round(start), end: round(all[k + 1] ?? clip.end) };
      if (k > 0 && colors.length) applyPalette(piece, colors, k);
      out.push(piece);
    });
  }
  return out;
}
