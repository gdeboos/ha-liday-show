// Previews of a WLED's own effects for the editor: runs WLED's effect code (effects.js) frame by frame,
// as the WLED would, up to the moment being shown. Effects not ported yet get a moving stand-in made
// from their palette and colours.
//
// SPDX-License-Identifier: EUPL-1.2
// Copyright (c) 2016-present Christian Schwinne and individual WLED contributors
// This folder is under the EUPL 1.2 (see LICENSE here), not the MIT licence of the rest of HA-liday Show.

import { ColorFromPalette, DEFAULT_PALETTE, FRAMETIME, B, G, R, Segment, getSeed, setSeed, strip } from "./engine.js";
import { MODES } from "./effects.js";

export const isPorted = (fx) => Object.hasOwn(MODES, Number(fx));

// Stand-in for effects not ported yet: their palette (or their colours) drifting along the light.
function standIn(s) {
  const shift = Math.floor((strip.now * ((s.speed >> 4) + 1)) / 256);
  for (let i = 0; i < s.len; i++) {
    const at = s.len > 1 ? Math.floor((i * 255) / (s.len - 1)) : 0;
    s.setPixelColor(i, s.color_from_palette((at + shift) & 0xFF, false, true, 0));
  }
}

const hex = (v, d) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? parseInt(v.slice(1), 16) : d);
const byte = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(255, Math.round(Number(v)))) : d);

function settings(p) {
  return {
    fx: byte(p.fx, 0), speed: byte(p.speed, 128), intensity: byte(p.intensity, 128), palette: byte(p.palette, 0),
    colors: [hex(p.color, 0xFF0000), hex(p.color2, 0xFFFFFF), hex(p.color3, 0x00B000)],
  };
}

const MAX_SIMS = 256;
const CATCH_UP_MS = 20000; // further ahead than this, start afresh a little before (scrubbing a long scene)
const sims = new Map();

function freshSim(n, set, from) {
  const ported = isPorted(set.fx);
  // A stand-in blends through the colours when the palette is "Default", like WLED's "Colors Only".
  const seg = new Segment(n, { mode: set.fx, speed: set.speed, intensity: set.intensity,
    palette: ported || set.palette ? set.palette : 5, colors: set.colors });
  return { seg, draw: ported ? MODES[set.fx] : standIn, next: from, seed: 1337, at: -1, out: new Uint8Array(n * 3) };
}

// The colours (r, g, b per light, as the editor shows them) a WLED shows `t` seconds into its effect.
export function wledFrame(p, t, n) {
  const set = settings(p);
  const key = `${n}|${set.fx}|${set.speed}|${set.intensity}|${set.palette}|${set.colors.join(",")}`;
  const target = Math.max(0, Math.floor(t * 1000));
  let sim = sims.get(key);
  if (sim) { sims.delete(key); sims.set(key, sim); } // most recently used last, so a big bake keeps its lights
  if (sim && sim.at === target) return sim.out;
  if (!sim || target < sim.at || target - sim.next > CATCH_UP_MS) {
    const from = target > CATCH_UP_MS ? Math.floor((target - 5000) / FRAMETIME) * FRAMETIME : 0;
    sim = freshSim(n, set, from);
    sims.delete(key);
    if (sims.size >= MAX_SIMS) sims.delete(sims.keys().next().value);
    sims.set(key, sim);
  }
  const saved = getSeed();
  setSeed(sim.seed);
  const { seg } = sim;
  // WLED draws an effect on the first frame after the delay it asked for (FX_fcn.cpp, WS2812FX::service).
  while (sim.next <= target) {
    strip.now = sim.next;
    const delay = sim.draw(seg) ?? FRAMETIME;
    seg.call++;
    sim.next += Math.max(1, Math.ceil(delay / FRAMETIME)) * FRAMETIME;
  }
  sim.seed = getSeed();
  setSeed(saved);
  const out = sim.out;
  for (let i = 0; i < n; i++) {
    const c = seg.px[i];
    out[i * 3] = R(c);
    out[i * 3 + 1] = G(c);
    out[i * 3 + 2] = B(c);
  }
  sim.at = target;
  return out;
}

// The editor asks for one light at a time; keep the last frame so a light's pixels cost one run.
let last = { p: null, t: -1, n: -1, out: null };
export function wledPixel(p, t, n, i) {
  if (last.p !== p || last.t !== t || last.n !== n) last = { p, t, n, out: wledFrame(p, t, n) };
  return [last.out[i * 3], last.out[i * 3 + 1], last.out[i * 3 + 2]];
}

// What palette `pal` looks like for the light's effect and colours in `p`, as n colours (r, g, b each):
// for the WLED palette window. Default is the effect's own palette where WLED gives it one; otherwise
// the effect draws in your three colours, so that's what it shows.
export function wledPaletteColours(p, pal, n) {
  const set = settings(p), out = new Uint8Array(n * 3);
  if (pal === 0 && DEFAULT_PALETTE[set.fx] === undefined) {
    for (let i = 0; i < n; i++) {
      const c = set.colors[Math.min(2, Math.floor((i * 3) / n))];
      out.set([R(c), G(c), B(c)], i * 3);
    }
    return out;
  }
  const seg = new Segment(1, { mode: set.fx, palette: pal, colors: set.colors });
  for (let i = 0; i < n; i++) out.set(ColorFromPalette(seg.pal, n > 1 ? Math.floor((i * 255) / (n - 1)) : 0, 255, true), i * 3);
  return out;
}
