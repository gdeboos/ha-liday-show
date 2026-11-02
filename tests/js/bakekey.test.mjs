import test from "node:test";
import assert from "node:assert/strict";
import { bakeNote, lightsBakeKey } from "../../haliday_show/app/halidayshow/static/js/bakekey.js";

test("the same lights give the same note, and the note suits the server", () => {
  const lights = [{ id: "roof", segments: 40, parts: [] }];
  assert.equal(bakeNote([lights, [], {}]), bakeNote([structuredClone(lights), [], {}]));
  assert.match(bakeNote([lights, [], {}]), /^[A-Za-z0-9_-]{1,64}$/);
  assert.match(bakeNote("x".repeat(100000)), /^[A-Za-z0-9_-]{1,64}$/);
});

test("any change to the lights gives another note", () => {
  const a = bakeNote([[{ id: "roof", segments: 40 }], [], {}]);
  assert.notEqual(a, bakeNote([[{ id: "roof", segments: 41 }], [], {}]));
  assert.notEqual(a, bakeNote([[{ id: "roof", segments: 40, reverse: true }], [], {}]));
  assert.notEqual(a, bakeNote([[{ id: "roof", segments: 40 }], [], { roof: [0.1, 0.2] }]));
});

test("what a bake depends on in each light includes a matrix's size and wiring, but not its name", () => {
  const panel = { id: "m", name: "Panel", segments: 256, parts: [], whole: true,
    matrix: { w: 16, h: 16, start: "top left", order: "rows", zigzag: false } };
  const key = (d) => lightsBakeKey([d]);
  assert.notEqual(key(panel), key({ ...panel, matrix: { ...panel.matrix, zigzag: true } }));
  assert.notEqual(key(panel), key({ ...panel, matrix: { ...panel.matrix, w: 8, h: 32 } }));
  assert.notEqual(key(panel), key({ ...panel, matrix: undefined }));
  assert.equal(key(panel), key({ ...panel, name: "Window" }));
});
