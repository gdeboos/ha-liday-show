// A small copy of the parts of WLED (and of the FastLED library it uses) that its effects draw with, so
// the editor can preview a WLED's own effects by running WLED's code. Translated to JavaScript from
// WLED 0.15.5 (wled00/FX_fcn.cpp, colors.cpp, wled_math.cpp, util.cpp, FX.cpp) and FastLED 3.6 (lib8tion,
// colorutils, colorpalettes, hsv2rgb; MIT licence, Copyright (c) 2013 FastLED). Numbers follow the C
// types: values are masked to 8, 16 or 32 bits where the C code would wrap.
//
// SPDX-License-Identifier: EUPL-1.2
// Copyright (c) 2016-present Christian Schwinne and individual WLED contributors
// This folder is under the EUPL 1.2 (see LICENSE here), not the MIT licence of the rest of HA-liday Show.

import { GRADIENTS } from "./palettes.js";
import { EXTRAS } from "./defaults.js";

export const FRAMETIME = 23; // 1000 / 42 fps, WLED's default frame rate
export const NUM_COLORS = 3;
export const STARBURST_MAX_FRAG = 10; // ESP32 build

// strip.now: the effect clock in ms. FastLED's beat functions read it too (WLED's get_millisecond_timer).
export const strip = { now: 0 };

// ---- FastLED lib8tion -------------------------------------------------------------------------------

let seed = 1337; // FastLED's rand16seed; each preview keeps its own (see Sim)
export const getSeed = () => seed;
export const setSeed = (v) => { seed = v & 0xFFFF; };

export function random16(a, b) {
  seed = (seed * 2053 + 13849) & 0xFFFF;
  if (a === undefined) return seed;
  if (b === undefined) return Math.floor((seed * (a & 0xFFFF)) / 65536);
  a &= 0xFFFF; b &= 0xFFFF; // uint16_t arguments
  return (a + Math.floor((seed * ((b - a) & 0xFFFF)) / 65536)) & 0xFFFF;
}
export function random8(a, b) {
  seed = (seed * 2053 + 13849) & 0xFFFF;
  const r = ((seed & 0xFF) + (seed >> 8)) & 0xFF;
  if (a === undefined) return r;
  if (b === undefined) return ((r * (a & 0xFF)) >> 8) & 0xFF;
  a &= 0xFF; b &= 0xFF; // uint8_t arguments
  return (a + (((r * ((b - a) & 0xFF)) >> 8) & 0xFF)) & 0xFF;
}

export const scale8 = (i, s) => (((i & 0xFF) * (1 + (s & 0xFF))) >> 8) & 0xFF;
export const scale8_video = (i, s) => ((((i & 0xFF) * (s & 0xFF)) >> 8) + ((i & 0xFF) && (s & 0xFF) ? 1 : 0)) & 0xFF;
export const scale16 = (i, s) => Math.floor(((i & 0xFFFF) * (1 + (s & 0xFFFF))) / 65536) & 0xFFFF;
export const qadd8 = (a, b) => Math.min(255, (a & 0xFF) + (b & 0xFF));
export const qsub8 = (a, b) => Math.max(0, (a & 0xFF) - (b & 0xFF));

export function triwave8(i) {
  i &= 0xFF;
  if (i & 0x80) i = 255 - i;
  return (i << 1) & 0xFF;
}
function ease8InOutCubic(i) {
  const ii = scale8(i, i), iii = scale8(ii, i);
  const r1 = 3 * ii - 2 * iii;
  return r1 & 0x100 ? 255 : r1 & 0xFF;
}
export const cubicwave8 = (i) => ease8InOutCubic(triwave8(i));
function ease8InOutQuad(i) {
  i &= 0xFF;
  const j = i & 0x80 ? 255 - i : i;
  const jj2 = (scale8(j, j) << 1) & 0xFF;
  return i & 0x80 ? 255 - jj2 : jj2;
}
export const quadwave8 = (i) => ease8InOutQuad(triwave8(i));

export function beat88(bpm88, timebase = 0) {
  return Math.floor(((strip.now - timebase) * (bpm88 & 0xFFFF) * 280) / 65536) & 0xFFFF;
}
export const beat16 = (bpm, timebase = 0) => beat88(bpm < 256 ? bpm << 8 : bpm, timebase);
export const beat8 = (bpm, timebase = 0) => beat16(bpm, timebase) >> 8;

// ---- WLED maths (wled_math.cpp, util.cpp, FX.cpp) ---------------------------------------------------

export function sin16_t(theta) {
  theta &= 0xFFFF;
  let scale = 1;
  if (theta > 0x7FFF) { theta = 0xFFFF - theta; scale = -1; }
  const precal = theta * (0x7FFF - theta);
  const result = Math.trunc((precal * (4 * 0x7FFF)) / (1342095361 - precal));
  return result * scale;
}
export const cos16_t = (theta) => sin16_t((theta + 0x4000) & 0xFFFF);
export function sin8_t(theta) {
  let s = sin16_t(((theta & 0xFF) * 257) & 0xFFFF) + 0x7FFF + 128;
  return Math.min(s, 0xFFFF) >> 8;
}
export const cos8_t = (theta) => sin8_t((theta + 64) & 0xFF);
export const sin_gap = (i) => (i & 0x100 ? 0 : sin8_t((i + 192) & 0xFF));
export function triwave16(i) {
  i &= 0xFFFF;
  return i < 0x8000 ? i * 2 : 0xFFFF - (i - 0x8000) * 2;
}

export function beatsin88_t(bpm88, lowest, highest, timebase = 0, phase = 0) {
  const beat = beat88(bpm88, timebase);
  const s = (sin16_t((beat + phase) & 0xFFFF) + 32768) & 0xFFFF;
  return (lowest + scale16(s, (highest - lowest) & 0xFFFF)) & 0xFFFF;
}
export function beatsin16_t(bpm, lowest, highest, timebase = 0, phase = 0) {
  const beat = beat16(bpm, timebase);
  const s = (sin16_t((beat + phase) & 0xFFFF) + 32768) & 0xFFFF;
  return (lowest + scale16(s, (highest - lowest) & 0xFFFF)) & 0xFFFF;
}
export function beatsin8_t(bpm, lowest, highest, timebase = 0, phase = 0) {
  const beat = beat8(bpm, timebase);
  const s = sin8_t((beat + phase) & 0xFF);
  return ((lowest & 0xFF) + scale8(s, (highest - lowest) & 0xFF)) & 0xFF;
}

// Arduino's map(): integer, truncating towards zero.
export const map = (x, inMin, inMax, outMin, outMax) => Math.trunc(((x - inMin) * (outMax - outMin)) / (inMax - inMin)) + outMin;

export function get_random_wheel_index(pos) {
  let r = 0, d = 0;
  while (d < 42) {
    r = random8();
    const x = Math.abs(pos - r), y = 255 - x;
    d = Math.min(x, y);
  }
  return r;
}

// ---- Colours: 0xWWRRGGBB as in WLED ----------------------------------------------------------------

export const RGBW32 = (r, g, b, w = 0) => (((w & 0xFF) << 24) | ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF)) >>> 0;
export const R = (c) => (c >>> 16) & 0xFF;
export const G = (c) => (c >>> 8) & 0xFF;
export const B = (c) => c & 0xFF;
export const W = (c) => (c >>> 24) & 0xFF;
export const BLACK = 0, WHITE = 0x00FFFFFF;

export function color_blend(c1, c2, blend, b16 = false) {
  if (blend === 0) return c1;
  const max = b16 ? 0xFFFF : 0xFF, shift = b16 ? 16 : 8;
  if (blend === max) return c2;
  const mix = (a, b) => Math.floor((b * blend + a * (max - blend)) / (1 << shift));
  return RGBW32(mix(R(c1), R(c2)), mix(G(c1), G(c2)), mix(B(c1), B(c2)), mix(W(c1), W(c2)));
}
export function color_add(c1, c2, fast = false) {
  if (c1 === BLACK) return c2;
  if (c2 === BLACK) return c1;
  if (fast) return RGBW32(qadd8(R(c1), R(c2)), qadd8(G(c1), G(c2)), qadd8(B(c1), B(c2)), qadd8(W(c1), W(c2)));
  const r = R(c1) + R(c2), g = G(c1) + G(c2), b = B(c1) + B(c2), w = W(c1) + W(c2);
  const m = Math.max(r, g, b, w);
  if (m < 256) return RGBW32(r, g, b, w);
  return RGBW32(Math.floor((r * 255) / m), Math.floor((g * 255) / m), Math.floor((b * 255) / m), Math.floor((w * 255) / m));
}
export function color_fade(c, amount, video = false) {
  amount &= 0xFF;
  if (c === BLACK || amount + (video ? 1 : 0) === 0) return BLACK;
  const f = (v) => (video ? ((v * amount) >> 8) + (v && amount ? 1 : 0) : (v * amount) >> 8);
  return RGBW32(f(R(c)), f(G(c)), f(B(c)), f(W(c)));
}

// WLED corrects the colours you pick (and its simple palettes) with gamma 2.8 before drawing; its
// gradient palettes and colour wheel aren't. The preview leaves gamma out altogether (see Segment), as
// HA-liday Show's previews show the values a light is sent, so picked colours look as picked and the rest
// as WLED sends them.
const GAMMA = 2.8;
const gammaT = Uint8Array.from({ length: 256 }, (_, i) => Math.floor(Math.pow(i / 255, GAMMA) * 255 + 0.5));
export const gamma8 = (v) => gammaT[v & 0xFF];
export const gamma32 = (c) => RGBW32(gammaT[R(c)], gammaT[G(c)], gammaT[B(c)], gammaT[W(c)]);

// CRGB as [r, g, b].
export const crgb = (c) => [R(c), G(c), B(c)];
export const fromCRGB = (c) => RGBW32(c[0], c[1], c[2], 0);
export const getAverageLight = (c) => scale8(c[0], 85) + scale8(c[1], 85) + scale8(c[2], 85);
export const nscale8_video = (c, s) => c.map((v) => scale8_video(v, s));
export const addCRGB = (a, b) => [qadd8(a[0], b[0]), qadd8(a[1], b[1]), qadd8(a[2], b[2])];
export const nscale8 = (c, s) => c.map((v) => scale8(v, s));
export const maxCRGB = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];

// FastLED's hsv2rgb_rainbow.
export function hsv2rgb_rainbow(hue, sat, val) {
  hue &= 0xFF;
  const offset8 = (hue & 0x1F) << 3, third = scale8(offset8, 85);
  let r, g, b;
  if (!(hue & 0x80)) {
    if (!(hue & 0x40)) {
      if (!(hue & 0x20)) { r = 255 - third; g = third; b = 0; } else { r = 171; g = 85 + third; b = 0; }
    } else if (!(hue & 0x20)) {
      const twothirds = scale8(offset8, 170); r = 171 - twothirds; g = 170 + third; b = 0;
    } else { r = 0; g = 255 - third; b = third; }
  } else if (!(hue & 0x40)) {
    if (!(hue & 0x20)) { const twothirds = scale8(offset8, 170); r = 0; g = 171 - twothirds; b = 85 + twothirds; } else { r = third; g = 0; b = 255 - third; }
  } else if (!(hue & 0x20)) { r = 85 + third; g = 0; b = 171 - third; } else { r = 170 + third; g = 0; b = 85 - third; }
  if (sat !== 255) {
    if (sat === 0) { r = g = b = 255; } else {
      const desat = scale8_video(255 - sat, 255 - sat), satscale = 255 - desat;
      if (r) r = scale8(r, satscale); if (g) g = scale8(g, satscale); if (b) b = scale8(b, satscale);
      r = (r + desat) & 0xFF; g = (g + desat) & 0xFF; b = (b + desat) & 0xFF;
    }
  }
  if (val !== 255) {
    const v = scale8_video(val, val);
    if (v === 0) { r = g = b = 0; } else { if (r) r = scale8(r, v); if (g) g = scale8(g, v); if (b) b = scale8(b, v); }
  }
  return [r & 0xFF, g & 0xFF, b & 0xFF];
}

// ---- Palettes (16 entries of [r, g, b], as FastLED's CRGBPalette16) ----------------------------------

export function fill_gradient_RGB(entries, startpos, c1, endpos, c2) {
  if (endpos < startpos) { [startpos, endpos] = [endpos, startpos]; [c1, c2] = [c2, c1]; }
  const divisor = endpos - startpos || 1;
  const delta = [0, 1, 2].map((k) => Math.trunc(((c2[k] - c1[k]) << 7) / divisor) * 2);
  const acc = [c1[0] << 8, c1[1] << 8, c1[2] << 8];
  for (let i = startpos; i <= endpos; i++) {
    entries[i] = [acc[0] >> 8, acc[1] >> 8, acc[2] >> 8];
    for (let k = 0; k < 3; k++) acc[k] = (((acc[k] + delta[k]) % 65536) + 65536) % 65536;
  }
}
export function paletteOf(...cols) {
  const e = new Array(16);
  if (cols.length === 1) e.fill(cols[0]);
  else if (cols.length === 2) fill_gradient_RGB(e, 0, cols[0], 15, cols[1]);
  else if (cols.length === 3) { fill_gradient_RGB(e, 0, cols[0], 8, cols[1]); fill_gradient_RGB(e, 8, cols[1], 15, cols[2]); }
  else if (cols.length === 4) {
    fill_gradient_RGB(e, 0, cols[0], 5, cols[1]); fill_gradient_RGB(e, 5, cols[1], 10, cols[2]); fill_gradient_RGB(e, 10, cols[2], 15, cols[3]);
  } else for (let i = 0; i < 16; i++) e[i] = cols[i];
  return e.map((c) => [...c]);
}
const hexes = (...h) => h.map((v) => [(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF]);
export function gradientPalette(bytes) {
  const e = new Array(16).fill(null).map(() => [0, 0, 0]);
  const count = bytes.length / 4;
  let lastSlot = -1, ent = 0;
  let start = [bytes[1], bytes[2], bytes[3]], indexstart = 0;
  while (indexstart < 255) {
    ent++;
    const indexend = bytes[ent * 4], end = [bytes[ent * 4 + 1], bytes[ent * 4 + 2], bytes[ent * 4 + 3]];
    let istart8 = Math.floor(indexstart / 16), iend8 = Math.floor(indexend / 16);
    if (count < 16) {
      if (istart8 <= lastSlot && lastSlot < 15) { istart8 = lastSlot + 1; if (iend8 < istart8) iend8 = istart8; }
      lastSlot = iend8;
    }
    fill_gradient_RGB(e, istart8, start, iend8, end);
    indexstart = indexend;
    start = end;
  }
  return e;
}

// FastLED's colorpalettes.cpp
const P = {
  party: hexes(0x5500AB, 0x84007C, 0xB5004B, 0xE5001B, 0xE81700, 0xB84700, 0xAB7700, 0xABAB00, 0xAB5500, 0xDD2200, 0xF2000E, 0xC2003E, 0x8F0071, 0x5F00A1, 0x2F00D0, 0x0007F9),
  cloud: hexes(0x0000FF, 0x00008B, 0x00008B, 0x00008B, 0x00008B, 0x00008B, 0x00008B, 0x00008B, 0x0000FF, 0x00008B, 0x87CEEB, 0x87CEEB, 0xADD8E6, 0xFFFFFF, 0xADD8E6, 0x87CEEB),
  lava: hexes(0x000000, 0x800000, 0x000000, 0x800000, 0x8B0000, 0x8B0000, 0x800000, 0x8B0000, 0x8B0000, 0x8B0000, 0xFF0000, 0xFFA500, 0xFFFFFF, 0xFFA500, 0xFF0000, 0x8B0000),
  ocean: hexes(0x191970, 0x00008B, 0x191970, 0x000080, 0x00008B, 0x0000CD, 0x2E8B57, 0x008080, 0x5F9EA0, 0x0000FF, 0x008B8B, 0x6495ED, 0x7FFFD4, 0x2E8B57, 0x00FFFF, 0x87CEFA),
  forest: hexes(0x006400, 0x006400, 0x556B2F, 0x006400, 0x008000, 0x228B22, 0x6B8E23, 0x008000, 0x2E8B57, 0x66CDAA, 0x32CD32, 0x9ACD32, 0x90EE90, 0x7CFC00, 0x66CDAA, 0x228B22),
  rainbow: hexes(0xFF0000, 0xD52A00, 0xAB5500, 0xAB7F00, 0xABAB00, 0x56D500, 0x00FF00, 0x00D52A, 0x00AB55, 0x0056AA, 0x0000FF, 0x2A00D5, 0x5500AB, 0x7F0081, 0xAB0055, 0xD5002B),
  stripe: hexes(0xFF0000, 0x000000, 0xAB5500, 0x000000, 0xABAB00, 0x000000, 0x00FF00, 0x000000, 0x00AB55, 0x000000, 0x0000FF, 0x000000, 0x5500AB, 0x000000, 0xAB0055, 0x000000),
};
const gradients = GRADIENTS.map((g) => gradientPalette(g));
export const PALETTE_COUNT = 13 + GRADIENTS.length;

// Which palette "Default" (0) means for an effect (Segment::loadPalette).
export const DEFAULT_PALETTE = { 66: 35, 67: 26, 69: 9, 70: 20, 71: 43, 72: 35, 73: 26, 87: 11, 104: 35, 78: 3 };

// FastLED's ColorFromPalette for a 16-entry palette.
export function ColorFromPalette(pal, index, brightness = 255, blend = true) {
  index &= 0xFF; brightness &= 0xFF;
  const hi4 = index >> 4, lo4 = index & 0x0F;
  let [r, g, b] = pal[hi4];
  if (lo4 && blend) {
    const next = pal[hi4 === 15 ? 0 : hi4 + 1], f2 = lo4 << 4, f1 = 255 - f2;
    r = scale8(r, f1) + scale8(next[0], f2); g = scale8(g, f1) + scale8(next[1], f2); b = scale8(b, f1) + scale8(next[2], f2);
  }
  if (brightness !== 255) {
    if (brightness) {
      const s = brightness + 1;
      if (r) r = scale8(r, s); if (g) g = scale8(g, s); if (b) b = scale8(b, s);
    } else r = g = b = 0;
  }
  return [r & 0xFF, g & 0xFF, b & 0xFF];
}

// ---- A segment: WLED's Segment and its SEGENV, for one light -----------------------------------------

export class Segment {
  constructor(len, { mode = 0, speed = 128, intensity = 128, palette = 0, colors = [0xFF0000, 0, 0] } = {}) {
    this.len = len;
    this.px = new Uint32Array(len);
    this.mode = mode;
    this.speed = speed & 0xFF;
    this.intensity = intensity & 0xFF;
    // The effect's own extras, which the WLED loads as HA-liday Show switches it to the effect (fxdef);
    // otherwise WLED's segment defaults.
    const x = EXTRAS[mode] || {};
    this.custom1 = x.c1 ?? 128; this.custom2 = x.c2 ?? 128; this.custom3 = x.c3 ?? 16;
    this.check1 = !!x.o1; this.check2 = !!x.o2; this.check3 = !!x.o3;
    this.palette = palette;
    this.colors = colors.map((c) => c >>> 0);
    this.gcolors = this.colors; // SEGCOLOR(): WLED's are gamma-corrected; the preview keeps them as picked
    this.pal = this.loadPalette(palette);
    // SEGENV
    this.call = 0; this.step = 0; this.aux0 = 0; this.aux1 = 0; this.data = null; this.state = null;
  }

  SEGCOLOR(i) { return this.gcolors[i]; }

  loadPalette(pal) {
    if (pal > PALETTE_COUNT - 1) pal = 0;
    if (pal === 0) pal = DEFAULT_PALETTE[this.mode] ?? 0;
    const g = this.colors.map((c) => crgb(c)); // as picked (WLED gamma-corrects these)
    switch (pal) {
      case 0: case 6: return P.party;
      case 1: { // WLED makes a new random palette every so often; a fixed one from the same recipe stands in
        const s = getSeed(); setSeed(4242);
        const p = paletteOf(...[0, 1, 2, 3].map(() => hsv2rgb_rainbow(random8(), 255, random8(128, 255))));
        setSeed(s); return p;
      }
      case 2: return paletteOf(g[0]);
      case 3: return paletteOf(g[0], g[0], g[1], g[1]);
      case 4: return paletteOf(g[2], g[1], g[0]);
      case 5: return this.colors[2]
        ? paletteOf(g[0], g[0], g[0], g[0], g[0], g[1], g[1], g[1], g[1], g[1], g[2], g[2], g[2], g[2], g[2], g[0])
        : paletteOf(g[0], g[0], g[0], g[0], g[0], g[0], g[0], g[0], g[1], g[1], g[1], g[1], g[1], g[1], g[1], g[1]);
      case 7: return P.cloud;
      case 8: return P.lava;
      case 9: return P.ocean;
      case 10: return P.forest;
      case 11: return P.rainbow;
      case 12: return P.stripe;
      default: return gradients[pal - 13] ?? P.party;
    }
  }

  allocateData(n) {
    if (!this.data || this.data.length !== n) this.data = new Uint8Array(n);
    return true;
  }

  setPixelColor(i, c, g, b, w = 0) {
    if (g !== undefined) c = RGBW32(c, g, b, w);
    i = Math.trunc(i);
    if (i >= 0 && i < this.len) this.px[i] = c >>> 0;
  }
  getPixelColor(i) { return i >= 0 && i < this.len ? this.px[i] : 0; }
  fill(c) { this.px.fill(c >>> 0); }
  blendPixelColor(i, c, blend) { this.setPixelColor(i, color_blend(this.getPixelColor(i), c, blend)); }
  addPixelColor(i, c, fast = false) { this.setPixelColor(i, color_add(this.getPixelColor(i), c, fast)); }

  fade_out(rate) {
    rate = (256 - (rate & 0xFF)) >> 1;
    const mapped = Math.floor(256 / (rate + 1)), bg = this.colors[1];
    for (let x = 0; x < this.len; x++) {
      let color = this.px[x];
      if (color === bg) continue;
      for (let sh = 0; sh < 32; sh += 8) {
        const c2 = (bg >>> sh) & 0xFF, c1 = (color >>> sh) & 0xFF;
        let delta = Math.trunc(((c2 - c1) * mapped) / 256);
        if (delta === 0) delta += c2 === c1 ? 0 : c2 > c1 ? 1 : -1;
        color = ((color & ~(0xFF << sh)) | (((c1 + delta) & 0xFF) << sh)) >>> 0;
      }
      this.px[x] = color;
    }
  }
  fadeToBlackBy(by) {
    if (!by) return;
    for (let x = 0; x < this.len; x++) this.px[x] = color_fade(this.px[x], 255 - by);
  }

  color_from_palette(i, mapping, wrap, mcol, pbri = 255) {
    const color = mcol < NUM_COLORS ? this.gcolors[mcol] : 0;
    if (this.palette === 0 && mcol < NUM_COLORS) return pbri === 255 ? color : color_fade(color, pbri, true);
    let index = i;
    if (mapping && this.len > 1) index = Math.floor((i * 255) / (this.len - 1));
    if (!wrap) index = scale8(index, 240); // WLED's palette blending default: wrap only when asked
    const c = ColorFromPalette(this.pal, index, pbri, true);
    return RGBW32(c[0], c[1], c[2], W(color));
  }
  color_wheel(pos) {
    pos &= 0xFF;
    if (this.palette) return this.color_from_palette(pos, false, true, 0);
    pos = 255 - pos;
    if (pos < 85) return RGBW32(255 - pos * 3, 0, pos * 3);
    if (pos < 170) { pos -= 85; return RGBW32(0, pos * 3, 255 - pos * 3); }
    pos -= 170;
    return RGBW32(pos * 3, 255 - pos * 3, 0);
  }
}
