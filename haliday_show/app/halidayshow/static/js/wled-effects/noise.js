// FastLED's Perlin noise (noise.cpp, FastLED 3.6, as WLED 0.15.5 builds it: FASTLED_NOISE_FIXED, no
// average overflow), translated to JavaScript for the WLED effect previews. Numbers follow the C types.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2013 FastLED (see LICENSE-FastLED here)

import { qadd8, scale8, scale16 } from "./engine.js";

const p = Uint8Array.from([151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,151]);
const P = (x) => p[x & 0xFF];
const P1 = (x) => p[(x & 0xFF) + 1]; // P(A+1) with A a uint8_t, which may read p[256]

const s16 = (v) => ((v & 0xFFFF) ^ 0x8000) - 0x8000;
const s8 = (v) => ((v & 0xFF) ^ 0x80) - 0x80;

const avg15 = (i, j) => s16((i >> 1) + (j >> 1) + (i & 1));
const avg7 = (i, j) => s8((i >> 1) + (j >> 1) + (i & 1));

function ease16InOutQuad(i) {
  const j = i & 0x8000 ? 65535 - i : i;
  const jj2 = (scale16(j, j) << 1) & 0xFFFF;
  return i & 0x8000 ? 65535 - jj2 : jj2;
}
function ease8InOutQuad(i) {
  const j = i & 0x80 ? 255 - i : i;
  const jj2 = (scale8(j, j) << 1) & 0xFF;
  return i & 0x80 ? 255 - jj2 : jj2;
}
function lerp15by16(a, b, frac) {
  if (b > a) return s16(a + scale16((b - a) & 0xFFFF, frac));
  return s16(a - scale16((a - b) & 0xFFFF, frac));
}
function lerp7by8(a, b, frac) {
  if (b > a) return s8(a + scale8((b - a) & 0xFF, frac));
  return s8(a - scale8((a - b) & 0xFF, frac));
}

function grad16_3(hash, x, y, z) {
  hash &= 15;
  let u = hash < 8 ? x : y;
  let v = hash < 4 ? y : hash === 12 || hash === 14 ? x : z;
  if (hash & 1) u = s16(-u);
  if (hash & 2) v = s16(-v);
  return avg15(u, v);
}
function grad16_2(hash, x, y) {
  hash &= 7;
  let u, v;
  if (hash < 4) { u = x; v = y; } else { u = y; v = x; }
  if (hash & 1) u = s16(-u);
  if (hash & 2) v = s16(-v);
  return avg15(u, v);
}
function grad16_1(hash, x) {
  hash &= 15;
  let u, v;
  if (hash > 8) { u = x; v = x; } else if (hash < 4) { u = x; v = 1; } else { u = 1; v = x; }
  if (hash & 1) u = s16(-u);
  if (hash & 2) v = s16(-v);
  return avg15(u, v);
}
function grad8_3(hash, x, y, z) {
  hash &= 0xF;
  let u = hash & 8 ? y : x;
  let v = hash < 4 ? y : hash === 12 || hash === 14 ? x : z;
  if (hash & 1) u = s8(-u);
  if (hash & 2) v = s8(-v);
  return avg7(u, v);
}
function grad8_2(hash, x, y) {
  let u, v;
  if (hash & 4) { u = y; v = x; } else { u = x; v = y; }
  if (hash & 1) u = s8(-u);
  if (hash & 2) v = s8(-v);
  return avg7(u, v);
}
function grad8_1(hash, x) {
  let u, v;
  if (hash & 8) { u = x; v = x; } else if (hash & 4) { u = 1; v = x; } else { u = x; v = 1; }
  if (hash & 1) u = s8(-u);
  if (hash & 2) v = s8(-v);
  return avg7(u, v);
}

const N16 = 0x8000, N8 = 0x80;

function inoise16_raw3(x, y, z) {
  x >>>= 0; y >>>= 0; z >>>= 0;
  const X = (x >>> 16) & 0xFF, Y = (y >>> 16) & 0xFF, Z = (z >>> 16) & 0xFF;
  const A = (P(X) + Y) & 0xFF, AA = (P(A) + Z) & 0xFF, AB = (P1(A) + Z) & 0xFF;
  const B = (P1(X) + Y) & 0xFF, BA = (P(B) + Z) & 0xFF, BB = (P1(B) + Z) & 0xFF;
  let u = x & 0xFFFF, v = y & 0xFFFF, w = z & 0xFFFF;
  const xx = (u >> 1) & 0x7FFF, yy = (v >> 1) & 0x7FFF, zz = (w >> 1) & 0x7FFF;
  u = ease16InOutQuad(u); v = ease16InOutQuad(v); w = ease16InOutQuad(w);
  const X1 = lerp15by16(grad16_3(P(AA), xx, yy, zz), grad16_3(P(BA), s16(xx - N16), yy, zz), u);
  const X2 = lerp15by16(grad16_3(P(AB), xx, s16(yy - N16), zz), grad16_3(P(BB), s16(xx - N16), s16(yy - N16), zz), u);
  const X3 = lerp15by16(grad16_3(P1(AA), xx, yy, s16(zz - N16)), grad16_3(P1(BA), s16(xx - N16), yy, s16(zz - N16)), u);
  const X4 = lerp15by16(grad16_3(P1(AB), xx, s16(yy - N16), s16(zz - N16)), grad16_3(P1(BB), s16(xx - N16), s16(yy - N16), s16(zz - N16)), u);
  return lerp15by16(lerp15by16(X1, X2, v), lerp15by16(X3, X4, v), w);
}
function inoise16_raw2(x, y) {
  x >>>= 0; y >>>= 0;
  const X = (x >>> 16) & 0xFF, Y = (y >>> 16) & 0xFF;
  const A = (P(X) + Y) & 0xFF, AA = P(A), AB = P1(A);
  const B = (P1(X) + Y) & 0xFF, BA = P(B), BB = P1(B);
  let u = x & 0xFFFF, v = y & 0xFFFF;
  const xx = (u >> 1) & 0x7FFF, yy = (v >> 1) & 0x7FFF;
  u = ease16InOutQuad(u); v = ease16InOutQuad(v);
  const X1 = lerp15by16(grad16_2(P(AA), xx, yy), grad16_2(P(BA), s16(xx - N16), yy), u);
  const X2 = lerp15by16(grad16_2(P(AB), xx, s16(yy - N16)), grad16_2(P(BB), s16(xx - N16), s16(yy - N16)), u);
  return lerp15by16(X1, X2, v);
}
function inoise16_raw1(x) {
  x >>>= 0;
  const X = (x >>> 16) & 0xFF;
  const A = P(X), AA = P(A), B = P1(X), BA = P(B);
  let u = x & 0xFFFF;
  const xx = (u >> 1) & 0x7FFF;
  u = ease16InOutQuad(u);
  return lerp15by16(grad16_1(P(AA), xx), grad16_1(P(BA), s16(xx - N16)), u);
}

// inoise16(x[, y[, z]]): 0..65535
export function inoise16(x, y, z) {
  // uint32_t sums and products, returned as uint16_t
  if (z !== undefined) return (Math.imul(inoise16_raw3(x, y, z) + 19052, 440) >>> 8) & 0xFFFF;
  if (y !== undefined) return (Math.imul(inoise16_raw2(x, y) + 17308, 484) >>> 8) & 0xFFFF;
  return ((inoise16_raw1(x) + 17308) << 1) & 0xFFFF;
}

export function inoise8_raw(x, y, z) {
  x &= 0xFFFF;
  if (y === undefined) {
    const X = x >> 8, A = P(X), AA = P(A), B = P1(X), BA = P(B);
    let u = x & 0xFF;
    const xx = (u >> 1) & 0x7F;
    u = ease8InOutQuad(u);
    return lerp7by8(grad8_1(P(AA), xx), grad8_1(P(BA), s8(xx - N8)), u);
  }
  y &= 0xFFFF;
  if (z === undefined) {
    const X = x >> 8, Y = y >> 8;
    const A = (P(X) + Y) & 0xFF, AA = P(A), AB = P1(A);
    const B = (P1(X) + Y) & 0xFF, BA = P(B), BB = P1(B);
    let u = x & 0xFF, v = y & 0xFF;
    const xx = (u >> 1) & 0x7F, yy = (v >> 1) & 0x7F;
    u = ease8InOutQuad(u); v = ease8InOutQuad(v);
    const X1 = lerp7by8(grad8_2(P(AA), xx, yy), grad8_2(P(BA), s8(xx - N8), yy), u);
    const X2 = lerp7by8(grad8_2(P(AB), xx, s8(yy - N8)), grad8_2(P(BB), s8(xx - N8), s8(yy - N8)), u);
    return lerp7by8(X1, X2, v);
  }
  z &= 0xFFFF;
  const X = x >> 8, Y = y >> 8, Z = z >> 8;
  const A = (P(X) + Y) & 0xFF, AA = (P(A) + Z) & 0xFF, AB = (P1(A) + Z) & 0xFF;
  const B = (P1(X) + Y) & 0xFF, BA = (P(B) + Z) & 0xFF, BB = (P1(B) + Z) & 0xFF;
  let u = x & 0xFF, v = y & 0xFF, w = z & 0xFF;
  const xx = (u >> 1) & 0x7F, yy = (v >> 1) & 0x7F, zz = (w >> 1) & 0x7F;
  u = ease8InOutQuad(u); v = ease8InOutQuad(v); w = ease8InOutQuad(w);
  const X1 = lerp7by8(grad8_3(P(AA), xx, yy, zz), grad8_3(P(BA), s8(xx - N8), yy, zz), u);
  const X2 = lerp7by8(grad8_3(P(AB), xx, s8(yy - N8), zz), grad8_3(P(BB), s8(xx - N8), s8(yy - N8), zz), u);
  const X3 = lerp7by8(grad8_3(P1(AA), xx, yy, s8(zz - N8)), grad8_3(P1(BA), s8(xx - N8), yy, s8(zz - N8)), u);
  const X4 = lerp7by8(grad8_3(P1(AB), xx, s8(yy - N8), s8(zz - N8)), grad8_3(P1(BB), s8(xx - N8), s8(yy - N8), s8(zz - N8)), u);
  return lerp7by8(lerp7by8(X1, X2, v), lerp7by8(X3, X4, v), w);
}

// inoise8(x[, y[, z]]): 0..255
export function inoise8(x, y, z) {
  const n = s8(inoise8_raw(x, y, z) + 64);
  return qadd8(n & 0xFF, n & 0xFF);
}
