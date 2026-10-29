import test from "node:test";
import assert from "node:assert/strict";
import { bakeNote } from "../../haliday_show/app/halidayshow/static/js/bakekey.js";

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
