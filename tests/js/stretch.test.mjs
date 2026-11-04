import assert from "node:assert/strict";
import test from "node:test";

import { clearIn, piecesIn, placeStretch, rowLimits, rowsBy } from "../../haliday_show/app/halidayshow/static/js/stretch.js";

const clip = (effect, start, end) => ({ effect, start, end });
const span = (cs) => cs.map((c) => `${c.effect}@${c.start}-${c.end}`).sort();
const anyLane = (c) => ({ ...c });

test("pieces are cut at the stretch's edges", () => {
  const cs = [clip("a", 0, 4), clip("b", 4, 6), clip("c", 6, 12), clip("d", 12, 14)];
  assert.deepEqual(span(piecesIn(cs, 2, 10)), ["a@2-4", "b@4-6", "c@6-10"]);
  assert.deepEqual(span(clearIn(cs, 2, 10)), ["a@0-2", "c@10-12", "d@12-14"]);
});

test("rows move together and stay on the lanes on show", () => {
  const rows = [0, 1, 2, 5, 6];
  assert.deepEqual(rowsBy(rows, [1, 2], 2), [5, 6]);
  assert.equal(rowsBy(rows, [2, 5], 2), null);
  assert.deepEqual(rowLimits(rows, [1, 2]), [-1, 2]);
});

test("moving to another lane replaces what was there and leaves the rest", () => {
  const lanes = { 0: [clip("a", 0, 4), clip("b", 4, 8)], 1: [clip("x", 0, 10)] };
  const r = placeStretch({ lanes: (i) => lanes[i], moves: [{ from: 0, to: 1, pieces: piecesIn(lanes[0], 2, 6) }],
    start: 2, end: 6, dt: 0, onto: anyLane, lift: true });
  assert.deepEqual(span(r.lanes.get(0)), ["a@0-2", "b@6-8"]);
  assert.deepEqual(span(r.lanes.get(1)), ["a@2-4", "b@4-6", "x@0-2", "x@6-10"]);
  assert.equal(r.placed.length, 2);
});

test("moving along the same lane, and down several lanes at once", () => {
  const lanes = { 0: [clip("a", 0, 2)], 1: [clip("b", 0, 2)], 2: [clip("c", 0, 2)] };
  const along = placeStretch({ lanes: (i) => lanes[i], moves: [{ from: 0, to: 0, pieces: lanes[0] }],
    start: 0, end: 2, dt: 1, onto: anyLane, lift: true });
  assert.deepEqual(span(along.lanes.get(0)), ["a@1-3"]);
  // Lanes 0 and 1 move down one: lane 1's own effects move on to lane 2 rather than being lost.
  const down = placeStretch({ lanes: (i) => lanes[i], start: 0, end: 2, dt: 0, onto: anyLane, lift: true,
    moves: [{ from: 0, to: 1, pieces: lanes[0] }, { from: 1, to: 2, pieces: lanes[1] }] });
  assert.deepEqual(span(down.lanes.get(0)), []);
  assert.deepEqual(span(down.lanes.get(1)), ["a@0-2"]);
  assert.deepEqual(span(down.lanes.get(2)), ["b@0-2"]);
});

test("a paste copies and leaves the original", () => {
  const lanes = { 0: [clip("a", 0, 2)], 1: [] };
  const r = placeStretch({ lanes: (i) => lanes[i], moves: [{ from: 0, to: 1, pieces: lanes[0] }],
    start: 0, end: 2, dt: 5, onto: anyLane });
  assert.equal(r.lanes.has(0) ? r.lanes.get(0).length : lanes[0].length, 1);
  assert.deepEqual(span(r.lanes.get(1)), ["a@5-7"]);
});

test("effects a lane can't take stay put; a lane that takes none is left alone", () => {
  const lanes = { 0: [clip("house", 0, 2), clip("a", 2, 4)], 1: [clip("x", 0, 4)], 2: [clip("house", 0, 4)], 3: [clip("y", 0, 4)] };
  const onto = (c) => (c.effect === "house" ? null : c);
  const some = placeStretch({ lanes: (i) => lanes[i], moves: [{ from: 0, to: 1, pieces: lanes[0] }],
    start: 0, end: 4, dt: 0, onto, lift: true });
  assert.deepEqual(span(some.lanes.get(0)), ["house@0-2"]);
  assert.deepEqual(span(some.lanes.get(1)), ["a@2-4"]);
  assert.equal(some.left, 1);
  const none = placeStretch({ lanes: (i) => lanes[i], moves: [{ from: 2, to: 3, pieces: lanes[2] }],
    start: 0, end: 4, dt: 0, onto, lift: true });
  assert.equal(none.lanes.size, 0);
  assert.equal(none.skipped, 1);
});
