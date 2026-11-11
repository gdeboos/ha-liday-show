// A light's parts: on a strip, a run of its segments ({id, name, from, to}, 1-based, inclusive); on
// a matrix, a rectangle of its grid ({id, name, x, y, w, h}, 0-based from the top left). Everything
// that moves colours between a part and its light goes through here, so both kinds work alike.

import { gridOf } from "./matrix.js";

export const isRectPart = (p) => !!p && p.from === undefined && Number.isInteger(p.w) && Number.isInteger(p.h);
// A shaped prop's bit ({id, name, leds}, shapes.js): any of its LEDs, scattered, and bits may overlap.
export const isBitPart = (p) => Array.isArray(p?.leds);
export const partSize = (p) => (isBitPart(p) ? p.leds.length : isRectPart(p) ? p.w * p.h : p.to - p.from + 1);
// What gets a lane of its own under a light: its parts, or a shaped prop's bits. (A shape is checked
// by its field alone here: Home Assistant's House card loads this file without shapes.js.)
export const lanesOf = (light) => (light?.parts?.length ? light.parts : light?.shape && light.bits?.length ? light.bits : []);
// Whether a light's lanes are windows on the whole light (a matrix or a shaped prop) rather than end to end.
const windows = (light) => !!gridOf(light) || !!light?.shape;
// A matrix part plays as a little matrix of its own (plain rows), so grid effects fill it.
export const partGrid = (p) => (isRectPart(p) ? { w: p.w, h: p.h } : null);

// The light's LEDs (0-based; grid order on a matrix) a part covers, in the part's own order: along
// the run, or row by row across the rectangle from its top left.
export function partCells(light, p) {
  if (isBitPart(p)) return Int32Array.from(p.leds);
  if (!isRectPart(p)) return Int32Array.from({ length: Math.max(0, p.to - p.from + 1) }, (_, i) => p.from - 1 + i);
  const W = gridOf(light)?.w ?? light.matrix?.w ?? 1, out = new Int32Array(p.w * p.h);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) out[y * p.w + x] = (p.y + y) * W + p.x + x;
  return out;
}

// A part's colours out of a frame of the whole light, and back in.
export function gatherPart(full, light, p, out = new Uint8Array(partSize(p) * 3)) {
  if (!isRectPart(p) && !isBitPart(p)) { out.set(full.subarray((p.from - 1) * 3, p.to * 3)); return out; }
  const cells = partCells(light, p);
  for (let k = 0; k < cells.length; k++) {
    const g = cells[k] * 3;
    out[k * 3] = full[g]; out[k * 3 + 1] = full[g + 1]; out[k * 3 + 2] = full[g + 2];
  }
  return out;
}
export function scatterPart(rgb, light, p, full) {
  if (!isRectPart(p) && !isBitPart(p)) { full.set(rgb.subarray(0, partSize(p) * 3), (p.from - 1) * 3); return full; }
  const cells = partCells(light, p);
  for (let k = 0; k < cells.length; k++) {
    const g = cells[k] * 3;
    full[g] = rgb[k * 3]; full[g + 1] = rgb[k * 3 + 1]; full[g + 2] = rgb[k * 3 + 2];
  }
  return full;
}
// Any per-LED list (house positions, say) cut down to a part's LEDs.
export const pickPart = (list, light, p) => (isRectPart(p) || isBitPart(p) ? Array.from(partCells(light, p), (i) => list[i]) : list.slice(p.from - 1, p.to));

// A split light's own lane: a strip's parts end to end, or a matrix whole (its parts are windows on it).
export const wholeSegments = (light) => (windows(light) ? light.segments : light.parts.reduce((n, p) => n + partSize(p), 0));
export function joinParts(light, full) {
  if (windows(light)) return full.slice(0, light.segments * 3);
  const out = new Uint8Array(wholeSegments(light) * 3);
  let k = 0;
  for (const p of light.parts) { gatherPart(full, light, p, out.subarray(k, k + partSize(p) * 3)); k += partSize(p) * 3; }
  return out;
}
export function spreadParts(light, rgb) {
  if (windows(light)) return rgb.slice(0, light.segments * 3);
  const out = new Uint8Array(light.segments * 3);
  let k = 0;
  for (const p of light.parts) { scatterPart(rgb.subarray(k, k + partSize(p) * 3), light, p, out); k += partSize(p) * 3; }
  return out;
}

// Which part (its index) covers LED `i` (0-based), or -1.
export function partAt(light, i) {
  const W = gridOf(light)?.w;
  return (light.parts || []).findIndex((p) => (isRectPart(p)
    ? W && i % W >= p.x && i % W < p.x + p.w && Math.floor(i / W) >= p.y && Math.floor(i / W) < p.y + p.h
    : i >= p.from - 1 && i < p.to));
}

// Whether two rectangles share an LED.
export const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// A new matrix part from a drag between two grid spots ({x, y}, either way round): {part}, or
// {clash: the part it would overlap}.
export function addRectPart(parts, a, b) {
  const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
  const clash = parts.find((p) => isRectPart(p) && rectsOverlap(p, r));
  if (clash) return { clash };
  let n = 1;
  while (parts.some((p) => p.id === `p${n}` || p.name === `Part ${n}`)) n++;
  return { part: { id: `p${n}`, name: `Part ${n}`, ...r } };
}

// Where a matrix part is, in words: "columns 1–4, rows 2–3" (counted from 1, from the top left).
export const rectText = (p) => {
  const span = (a, n) => (n === 1 ? `${a + 1}` : `${a + 1}–${a + n}`);
  return `${p.w === 1 ? "column" : "columns"} ${span(p.x, p.w)}, ${p.h === 1 ? "row" : "rows"} ${span(p.y, p.h)}`;
};
