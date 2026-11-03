import assert from "node:assert/strict";
import test from "node:test";

import { gatherPart, joinParts, partAt, partCells, partGrid, partSize, pickPart, rectsOverlap, scatterPart, spreadParts, wholeSegments }
  from "../../haliday_show/app/halidayshow/static/js/parts.js";

const panel = { id: "m", segments: 32, matrix: { w: 8, h: 4 },
  parts: [{ id: "a", name: "Left", x: 0, y: 0, w: 2, h: 2 }, { id: "b", name: "Right", x: 5, y: 1, w: 3, h: 3 }] };
const strip = { id: "s", segments: 10, parts: [{ id: "a", name: "A", from: 2, to: 4 }, { id: "b", name: "B", from: 7, to: 10 }] };

test("a matrix part's LEDs are its rectangle, row by row", () => {
  assert.deepEqual([...partCells(panel, panel.parts[0])], [0, 1, 8, 9]);
  assert.deepEqual([...partCells(panel, panel.parts[1])], [13, 14, 15, 21, 22, 23, 29, 30, 31]);
  assert.equal(partSize(panel.parts[1]), 9);
  assert.deepEqual(partGrid(panel.parts[1]), { w: 3, h: 3 });
  assert.equal(partGrid(strip.parts[0]), null);
  assert.deepEqual([...partCells(strip, strip.parts[0])], [1, 2, 3]);
});

test("colours go between a part and its light both ways", () => {
  const full = new Uint8Array(32 * 3).map((_, i) => i % 256);
  const part = gatherPart(full, panel, panel.parts[0]);
  assert.deepEqual([...part.subarray(6, 9)], [24, 25, 26]); // its third LED is the light's LED 8
  const back = scatterPart(new Uint8Array(4 * 3).fill(200), panel, panel.parts[0], new Uint8Array(32 * 3));
  assert.deepEqual([0, 1, 8, 9].map((i) => back[i * 3]), [200, 200, 200, 200]);
  assert.equal(back[2 * 3], 0);
  // Strips as before.
  const s = new Uint8Array(30).map((_, i) => i);
  assert.deepEqual([...gatherPart(s, strip, strip.parts[0])], [...s.subarray(3, 12)]);
  assert.deepEqual(pickPart(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"], panel, panel.parts[0]), ["p0", "p1", "p8", "p9"]);
});

test("a split matrix's own lane is the whole matrix; a strip's is its parts end to end", () => {
  assert.equal(wholeSegments(panel), 32);
  assert.equal(wholeSegments(strip), 7);
  const full = new Uint8Array(32 * 3).fill(9);
  assert.deepEqual(joinParts(panel, full), full);
  assert.equal(spreadParts(panel, full).length, 96);
  const joined = joinParts(strip, new Uint8Array(30).map((_, i) => i));
  assert.equal(joined.length, 21);
  assert.deepEqual([...spreadParts(strip, joined).subarray(3, 12)], [3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("which part an LED is in, and overlapping rectangles", () => {
  assert.equal(partAt(panel, 9), 0);
  assert.equal(partAt(panel, 31), 1);
  assert.equal(partAt(panel, 4), -1);
  assert.equal(partAt(strip, 2), 0);
  assert.ok(rectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 }));
  assert.ok(!rectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 }));
});

test("dragging out a new part on the grid", async () => {
  const { addRectPart, rectText } = await import("../../haliday_show/app/halidayshow/static/js/parts.js");
  const { part } = addRectPart(panel.parts, { x: 4, y: 3 }, { x: 2, y: 2 });
  assert.deepEqual(part, { id: "p1", name: "Part 1", x: 2, y: 2, w: 3, h: 2 });
  assert.equal(addRectPart(panel.parts, { x: 1, y: 1 }, { x: 3, y: 3 }).clash.name, "Left");
  assert.equal(rectText(part), "columns 3–5, rows 3–4");
  assert.equal(rectText({ x: 0, y: 7, w: 1, h: 1 }), "column 1, row 8");
});

test("a split matrix plays its own lane across the grid and each part in its rectangle", async () => {
  const { composeLight, newClip } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const light = { ...panel, whole: true };
  const solid = (c) => [{ ...newClip("solid", 0, 10), color: c }];
  const tracks = { m: { clips: solid("#ff0000") }, "m#a": { clips: solid("#00ff00") } };
  const out = composeLight(light, (id) => tracks[id], 1);
  const at = (i) => [...out.subarray(i * 3, i * 3 + 3)];
  assert.deepEqual(at(9), [0, 255, 0]); // in Left
  assert.deepEqual(at(4), [255, 0, 0]); // outside every part: the whole lane
  assert.deepEqual(at(31), [255, 0, 0]); // Right has no clip running, so the whole lane shows
  // Parts only: outside them, off.
  const only = composeLight({ ...light, whole: false }, (id) => tracks[id], 1);
  assert.deepEqual([...only.subarray(4 * 3, 4 * 3 + 3)], [0, 0, 0]);
  assert.deepEqual([...only.subarray(9 * 3, 9 * 3 + 3)], [0, 255, 0]);
  // A grid effect fills the part's own rectangle.
  const fire = { m: { clips: [] }, "m#b": { clips: [newClip("fire2d", 0, 10)] } };
  const lit = composeLight(light, (id) => fire[id], 2);
  const inB = [13, 14, 15, 21, 22, 23, 29, 30, 31].some((i) => lit[i * 3] > 0);
  assert.ok(inB);
  assert.ok([0, 1, 2, 3, 4, 8].every((i) => lit[i * 3] === 0));
});

test("share files carry a matrix's rectangle parts", async () => {
  const { makeShare, readShare } = await import("../../haliday_show/app/halidayshow/static/js/sharing.js");
  const show = { name: "S", duration: 10, tracks: [{ device: "m#b", clips: [{ effect: "solid", start: 0, end: 2 }] }] };
  const file = readShare(JSON.stringify(makeShare(show, [{ ...panel, kind: "wled" }])));
  assert.deepEqual(file.lights[0].parts, [{ key: "P1", name: "Left", x: 0, y: 0, w: 2, h: 2 }, { key: "P2", name: "Right", x: 5, y: 1, w: 3, h: 3 }]);
  assert.equal(file.tracks[0].part, "P2");
});
