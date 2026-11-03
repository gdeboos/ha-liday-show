import test from "node:test";
import assert from "node:assert/strict";
import { movePart } from "../../haliday_show/app/halidayshow/static/js/partorder.js";

const parts = [
  { id: "p1", name: "Drop", from: 1, to: 80 },
  { id: "p2", name: "Right", from: 81, to: 281 },
  { id: "p3", name: "Porch", from: 282, to: 400 },
];
const shown = (ps) => ps.map((p) => `${p.name} ${p.from}-${p.to}`);

test("a part swaps places with the next one, keeping its length and id", () => {
  assert.deepEqual(shown(movePart(parts, "p1", 1)), ["Right 1-201", "Drop 202-281", "Porch 282-400"]);
  let ps = movePart(parts, "p1", 1);
  ps = movePart(ps, "p1", 1);
  assert.deepEqual(shown(ps), ["Right 1-201", "Porch 202-320", "Drop 321-400"]);
  assert.equal(ps.find((p) => p.name === "Drop").id, "p1");
  assert.deepEqual(shown(movePart(parts, "p1", -1)), shown(parts)); // already first
});

test("unused stretches between parts stay where they are", () => {
  const gappy = [{ id: "a", name: "A", from: 5, to: 9 }, { id: "b", name: "B", from: 20, to: 22 }];
  assert.deepEqual(shown(movePart(gappy, "b", -1)), ["B 5-7", "A 18-22"]);
});
