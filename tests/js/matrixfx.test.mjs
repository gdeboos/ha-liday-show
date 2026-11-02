import assert from "node:assert/strict";
import test from "node:test";

import { bake, composeLight, newClip } from "../../haliday_show/app/halidayshow/static/js/effects.js";

const px = (buf, i) => [...buf.subarray(i * 3, i * 3 + 3)];
// A 4 x 3 panel, as the Devices tab saves it.
const panel = (wiring = {}) => ({ id: "m", segments: 12, matrix: { w: 4, h: 3, start: "top left", order: "rows", zigzag: false, ...wiring } });
const wipe = (runs) => ({ ...newClip("wipe", 0, 4), color: "#ffffff", background: "#000000", ...(runs ? { runs } : {}) });
const frame = (light, clip, t) => composeLight(light, (id) => (id === "m" ? { device: "m", clips: [clip] } : null), t);
const lit = (out, i) => px(out, i)[0] > 0;

test("a strip effect plays the same along every row by default", () => {
  const out = frame(panel(), wipe(), 2);
  const row = (y) => [0, 1, 2, 3].map((x) => lit(out, y * 4 + x));
  assert.deepEqual(row(0), [true, true, false, false]);
  assert.deepEqual(row(1), row(0));
  assert.deepEqual(row(2), row(0));
});

test("down each column, every column plays it the same", () => {
  const out = frame(panel(), wipe("columns"), 2);
  const col = (x) => [0, 1, 2].map((y) => lit(out, y * 4 + x));
  assert.deepEqual(col(0), [true, true, false]);
  for (const x of [1, 2, 3]) assert.deepEqual(col(x), col(0));
});

test("as one strip it zig-zags through the rows", () => {
  const out = frame(panel(), wipe("strip"), 2); // half of 12 LEDs: the top row and the right half of the next
  assert.deepEqual([0, 1, 2, 3].map((x) => lit(out, x)), [true, true, true, true]);
  assert.deepEqual([4, 5, 6, 7].map((i) => lit(out, i)), [false, false, true, true]);
});

test("House patterns are drawn across the grid", () => {
  const grad = { ...newClip("housegradient", 0, 4), color: "#ff0000", color2: "#0000ff", count: "2", direction: "left to right" };
  const out = frame(panel(), grad, 1);
  assert.deepEqual(px(out, 0), px(out, 8)); // the same colour down the left column
  assert.ok(px(out, 0)[0] > px(out, 3)[0] && px(out, 3)[2] > px(out, 0)[2]); // red on the left, blue on the right
});

test("a light whose LEDs don't fill its grid plays as a strip", () => {
  const odd = { ...panel(), segments: 13 };
  const out = frame(odd, wipe(), 2);
  assert.ok(lit(out, 5) && !lit(out, 8)); // the first half of 13, in a line
});

test("baking puts a matrix's frames into its wiring order", () => {
  const show = { duration: 1, tracks: [{ device: "m", clips: [{ ...wipe("strip"), start: 0, end: 1 }] }] };
  const read = (light) => {
    const blob = bake(show, { m: light }, 2);
    const hlen = new DataView(blob.buffer).getUint32(5);
    return blob.subarray(9 + hlen + 12 * 3); // the second frame, at 0.5 s: half of the strip lit
  };
  const rows = read(panel()), zig = read(panel({ zigzag: true }));
  // Grid spots 6 and 7 (the right of the second row) are lit; zig-zag wiring reaches them 5th and 6th.
  assert.deepEqual([4, 5, 6, 7].map((i) => lit(rows, i)), [false, false, true, true]);
  assert.deepEqual([4, 5, 6, 7].map((i) => lit(zig, i)), [true, true, false, false]);
});
