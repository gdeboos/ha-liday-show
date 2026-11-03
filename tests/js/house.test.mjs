import assert from "node:assert/strict";
import test from "node:test";

import { House, arcNearest, archPoints, bulbLayout, panelBulbs, defaultPanel, treeBulbs, defaultTree, bulbPositions, bulbSegment, defaultDrops, icicleDrops, pinBulbs, segmentBulb, segmentPositions, spotColour }
  from "../../haliday_show/app/halidayshow/static/js/house.js";

const close = (a, b) => a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);

test("bulbs spread evenly along a path, round corners included", () => {
  // An L: 1 across then 1 down, so 5 bulbs land every half unit.
  const bulbs = bulbPositions([[0, 0], [1, 0], [1, 1]], 5);
  assert.ok(close(bulbs, [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1]]));
  assert.deepEqual(bulbPositions([[0.3, 0.4]], 2), [[0.3, 0.4], [0.3, 0.4]]);
  assert.deepEqual(bulbPositions([], 3), []);
});

test("bulbs map to segments from the plug, flipped by Reverse", () => {
  const segs = Array.from({ length: 8 }, (_, j) => bulbSegment(j, 8, 2, false));
  assert.deepEqual(segs, [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(bulbSegment(0, 8, 2, true), 1);
  assert.equal(bulbSegment(7, 8, 2, true), 0);
});

test("bulbs out of view take their place in the order but aren't drawn", () => {
  // Plug, an extension lead (no bulbs), 1 unit in view, 3 bulbs round the back, 2 units in view.
  const path = [[0, 0], [0, 1, 0], [1, 1], [2, 1, 3], [4, 1]];
  const bulbs = bulbLayout(path, 12);
  assert.equal(bulbs.length, 12);
  // 9 bulbs in view, shared 1:2 by length: 3 on the first run, then the 3 hidden, then 6.
  assert.ok(close(bulbs.slice(0, 3), [[0, 1], [0.5, 1], [1, 1]]));
  assert.deepEqual(bulbs.slice(3, 6), [null, null, null]);
  assert.ok(close(bulbs.slice(6), [[2, 1], [2.4, 1], [2.8, 1], [3.2, 1], [3.6, 1], [4, 1]]));
  // With nothing hidden it matches the plain spread.
  assert.ok(close(bulbLayout([[0, 0], [1, 0], [1, 1]], 5), bulbPositions([[0, 0], [1, 0], [1, 1]], 5)));
  // More bulbs marked hidden than the light has: the rest are simply hidden.
  assert.deepEqual(bulbLayout([[0, 0], [1, 0, 50]], 4), [null, null, null, null]);
});

test("icicle drops spread along the line with staggered lengths", () => {
  const drops = icicleDrops([[0, 0], [1, 0], [2, 0, 4]], 6, 60);
  assert.equal(drops.length, 6);
  assert.deepEqual(drops.slice(2).every((d) => d === null), true); // 4 out of view
  assert.ok(close(drops.slice(0, 2).map((d) => d.top), [[0, 0], [1, 0]]));
  assert.equal(drops[0].f, 1);
  assert.ok(drops[1].f < 1 && drops[1].n < drops[0].n);
});

test("never more drops than bulbs, and a new icicle light gets about five bulbs a drop", () => {
  // 603 drops asked of 201 bulbs: one bulb each, and only 201 drops.
  const drops = icicleDrops([[0, 0], [1, 0]], 603, 201);
  assert.equal(drops.length, 201);
  assert.ok(drops.every((d) => d.n === 1));
  assert.equal(defaultDrops({ segments: 201, bulbs: 201 }), 40);
  assert.equal(defaultDrops({ segments: 15 }), 12); // 4 bulbs a segment when the count isn't set
  assert.equal(defaultDrops({ segments: 1, bulbs: 2 }), 1);
});

test("each spot shows its share of the segments, blended", () => {
  // 4 segments: red, red, blue, blue. Two spots get one colour each; flipped by Reverse.
  const rgb = Uint8Array.from([200, 0, 0, 200, 0, 0, 0, 0, 100, 0, 0, 100]);
  assert.deepEqual(spotColour(0, 2, rgb, 4, false), [200, 0, 0]);
  assert.deepEqual(spotColour(1, 2, rgb, 4, false), [0, 0, 100]);
  assert.deepEqual(spotColour(0, 2, rgb, 4, true), [0, 0, 100]);
  // One spot blends them all; more spots than segments share a segment.
  assert.deepEqual(spotColour(0, 1, rgb, 4, false), [100, 0, 50]);
  assert.deepEqual(spotColour(7, 8, rgb, 4, false), [0, 0, 100]);
});

test("segment positions span the traced lights from 0 to 1", () => {
  const roof = { id: "roof", segments: 2, reverse: false };
  const spots = { id: "spots", segments: 2, reverse: true };
  // Roof bulbs from x 0.2 to 0.6 at y 0.3; two spots at y 0.9, reversed.
  const pos = segmentPositions([
    { dev: roof, bulbs: [[0.2, 0.3], [0.3, 0.3], [0.5, 0.3], [0.6, 0.3]] },
    { dev: spots, spots: [[0.4, 0.9], [0.8, 0.9]] },
  ]);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  // Roof segments sit at the middle of their bulbs: x 0.25 and 0.55, scaled over 0.25..0.8.
  assert.ok(near(pos.roof[0], [0, 0]));
  assert.ok(near(pos.roof[1], [0.3 / 0.55, 0]));
  // Reversed spots: segment 1 is the first spot (by the plug).
  assert.ok(near(pos.spots[1], [0.15 / 0.55, 1]));
  assert.ok(near(pos.spots[0], [1, 1]));
  assert.deepEqual(segmentPositions([]), {});
});

test("a pinned segment moves its first bulb along the path, the bulbs between spread evenly", () => {
  const line = [[0, 0], [1, 0]];
  const bulbs = bulbLayout(line, 11); // 0, 0.1, ... 1
  // 10 segments over 11 bulbs: segment 5's first bulb is bulb 6, at 0.6 until pinned at 0.9.
  assert.equal(segmentBulb(5, 11, 10, false), 6);
  assert.equal(bulbSegment(6, 11, 10, false), 5);
  const pinned = pinBulbs(line, bulbs, { 5: 0.9 }, 10, false);
  assert.deepEqual(pinned.map((p) => +p[0].toFixed(3)), [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.925, 0.95, 0.975, 1]);
  assert.ok(pinned.every((p) => p[1] === 0));
  // Reverse counts segments from the far end.
  assert.equal(segmentBulb(0, 11, 10, true), 10);
  // No pins leaves them as they were.
  assert.equal(pinBulbs(line, bulbs, {}, 10, false), bulbs);
});

test("pins follow corners and leave stretches out of view alone", () => {
  const path = [[0, 0], [1, 0], [1, 1]];
  assert.equal(arcNearest(path, [1.2, 0.5]), 0.75);
  const pinned = pinBulbs(path, bulbLayout(path, 5), { 1: 0.25 }, 4, false);
  assert.deepEqual(pinned.slice(0, 4), [[0, 0], [0.25, 0], [0.5, 0], [1, 0.25]]);
  // The ends of a run in view stay put, so a pin only moves bulbs in its own run.
  const hidden = [[0, 0], [1, 0], [1, 1, 4], [2, 1]];
  const before = bulbLayout(hidden, 12);
  const after = pinBulbs(hidden, before, { 1: 0.1 }, 6, false);
  assert.equal(after.filter((b) => !b).length, 4);
  const round = (list) => list.map((p) => p.map((v) => +v.toFixed(6)));
  assert.deepEqual(round(after.slice(-4)), round(before.slice(-4)));
  assert.deepEqual(after[3], [1, 0]);
});


test("a panel's LEDs fill its four corners in rows from the top left, even at an angle", () => {
  const corners = [[0.1, 0.2], [0.5, 0.1], [0.6, 0.5], [0.2, 0.6]];
  const b = panelBulbs(corners, 3, 2);
  assert.equal(b.length, 6);
  assert.deepEqual(b[0], [0.1, 0.2]);
  assert.deepEqual(b[2], [0.5, 0.1]);
  assert.deepEqual(b[5], [0.6, 0.5]);
  assert.deepEqual(b[3], [0.2, 0.6]);
  assert.deepEqual(b[1].map((v) => +v.toFixed(5)), [0.3, 0.15]);
  // One LED, or a single row, sits in the middle.
  assert.deepEqual(panelBulbs([[0, 0], [1, 0], [1, 1], [0, 1]], 1, 1), [[0.5, 0.5]]);
  assert.deepEqual(panelBulbs([[0, 0], [1, 0], [1, 1], [0, 1]], 2, 1), [[0, 0.5], [1, 0.5]]);
  // Its segment positions span the panel, so House patterns land across it.
  const pos = segmentPositions([{ dev: { id: "m", segments: 6 }, bulbs: b }]).m;
  assert.deepEqual(pos[0].map((v) => +v.toFixed(3)), [0, 0.2]);
});

test("a new panel is placed in the middle of the photo, the shape of its grid", () => {
  const [tl, tr, br, bl] = defaultPanel({ w: 32, h: 8 }, 2);
  assert.ok(Math.abs((tl[0] + br[0]) / 2 - 0.5) < 1e-9 && Math.abs((tl[1] + br[1]) / 2 - 0.5) < 1e-9);
  // 32 x 8 on a photo twice as wide as it is tall: four times as wide as tall on screen.
  assert.ok(Math.abs(((tr[0] - tl[0]) * 2) / (bl[1] - tl[1]) - 4) < 1e-9);
  assert.equal(tr[1], tl[1]);
  assert.equal(br[0], tr[0]);
});


test("a mega-tree's columns fan out from its top to its base, a string each", () => {
  const b = treeBulbs([[0.5, 0.1], [0.3, 0.9], [0.7, 0.9]], 3, 2);
  const r = (p) => p.map((v) => +v.toFixed(5));
  assert.deepEqual(r(b[3]), [0.3, 0.9]); // bottom of the first string: the base's left end
  assert.deepEqual(r(b[5]), [0.7, 0.9]);
  assert.deepEqual(r(b[4]), [0.5, 0.9]);
  // The top row sits just under the top, not all on one spot.
  assert.deepEqual(r(b[0]), [0.48, 0.18]);
  assert.deepEqual(r(b[1]), [0.5, 0.18]);
  const [top, left, right] = defaultTree(1.6);
  assert.ok(top[1] < left[1] && left[1] === right[1] && Math.abs((left[0] + right[0]) / 2 - top[0]) < 1e-9);
});

test("a one-string, one-row or one-LED tree still has somewhere to go", () => {
  const shape = [[0.5, 0.1], [0.3, 0.9], [0.7, 0.9]];
  const r = (list) => list.map((p) => p.map((v) => +v.toFixed(5)));
  assert.deepEqual(r(treeBulbs(shape, 1, 2)), [[0.5, 0.18], [0.5, 0.9]]); // one string, down the middle
  assert.deepEqual(r(treeBulbs(shape, 2, 1)), [[0.3, 0.9], [0.7, 0.9]]); // one row, on the base
  assert.deepEqual(r(treeBulbs(shape, 1, 1)), [[0.5, 0.9]]);
});

test("a matrix's shape on the photo is redrawn when its grid changes but its LED count doesn't", () => {
  const house = new House({ api: async () => ({}), status: () => {}, frameFor: () => null });
  const dev = { id: "m", segments: 24, matrix: { w: 4, h: 6 } };
  house.paths.m = [[0.5, 0.1], [0.3, 0.9], [0.7, 0.9]];
  house.styles.m = { style: "tree" };
  const before = house.bulbs(dev).map((p) => p.join());
  const after = house.bulbs({ ...dev, matrix: { w: 6, h: 4 } }).map((p) => p.join());
  assert.notDeepEqual(after, before);
});

test("arches stand on the traced line, or hang from it", () => {
  const line = [[0.1, 0.5], [0.9, 0.5]];
  const up = archPoints(line, 2, 0.1);
  assert.deepEqual(up[0], [0.1, 0.5]);
  assert.ok(Math.abs(up.at(-1)[1] - 0.5) < 1e-9);
  // The top of the first arch, a quarter of the way along, is 0.1 above the line; between the two
  // arches it's back on the line.
  const near = (x) => up.reduce((b, p) => (Math.abs(p[0] - x) < Math.abs(b[0] - x) ? p : b));
  assert.ok(Math.abs(near(0.3)[1] - 0.4) < 0.005);
  assert.ok(Math.abs(near(0.5)[1] - 0.5) < 0.005);
  const down = archPoints(line, 2, 0.1, true);
  assert.ok(Math.abs(down.reduce((b, p) => (Math.abs(p[0] - 0.3) < Math.abs(b[0] - 0.3) ? p : b))[1] - 0.6) < 0.005);
  // Bulbs follow the curve.
  const bulbs = bulbLayout(up, 9);
  assert.ok(bulbs.some(([, y]) => y < 0.45));
  assert.deepEqual(archPoints([[0.1, 0.5]], 3, 0.1), [[0.1, 0.5]]);
});

test("a mega-tree that goes all the way round: the back half's strings are drawn faint, behind the front", () => {
  const shape = [[0.5, 0.1], [0.3, 0.9], [0.7, 0.9]];
  const w = 8, b = treeBulbs(shape, w, 2, true);
  const base = b.slice(w); // the bottom row, string by string
  const r = (v) => +v.toFixed(5);
  assert.equal(r(base[0][0]), 0.3); // the first string at the left edge
  assert.equal(r(base[2][0]), 0.5); // a quarter of the way round: front and centre
  assert.equal(r(base[4][0]), 0.7); // halfway: the right edge
  // The back strings show between the front ones rather than hidden exactly behind them.
  const front = base.slice(0, 5).map((p) => r(p[0]));
  assert.ok(base.slice(5).every((p) => !front.includes(r(p[0])) && p[0] > 0.3 && p[0] < 0.7));
  assert.ok(base.slice(0, 5).every((p) => p[2] === undefined)); // the front half as before
  assert.ok(base.slice(5).every((p) => p[2] === 0.25)); // the back half faint
  assert.deepEqual(treeBulbs(shape, w, 2).map((p) => p.length), Array(16).fill(2)); // flat trees unchanged
});

test("the round view is saved with the tree's style", async () => {
  const { roundTree } = await import("../../haliday_show/app/halidayshow/static/js/house.js");
  assert.equal(roundTree({ style: "tree", round: true }), true);
  assert.equal(roundTree({ style: "tree" }), false);
  assert.equal(roundTree({ style: "panel", round: true }), false);
});

test("a matrix drawn as a line or arches lights its LEDs in wiring order along the line", async () => {
  const { wireOrder } = await import("../../haliday_show/app/halidayshow/static/js/matrix.js");
  const house = new House({ api: async () => ({}), status: () => {}, frameFor: () => null });
  const matrix = { w: 4, h: 2, start: "top left", order: "rows", zigzag: true };
  const dev = { id: "m", segments: 8, matrix };
  house.paths.m = [[0.1, 0.5], [0.8, 0.5]];
  const b = house.bulbs(dev);
  assert.equal(b.length, 8); // one bulb per LED
  const order = wireOrder(matrix), xs = b.map((p) => p[0]);
  // Along the line, from the plug: the wire's first LED, then its second...
  for (let k = 1; k < 8; k++) assert.ok(xs[order[k]] > xs[order[k - 1]], `LED ${k} along the wire`);
  assert.ok(xs[7] < xs[4]); // the second row zig-zags back, so its last grid spot comes first along the wire
  house.styles.m = { style: "arches", arches: 2, height: 0.1, down: false };
  const arch = house.bulbs(dev);
  assert.equal(arch.length, 8);
  assert.ok(arch[order[0]][0] < arch[order[7]][0]);
  // Changing the wiring moves them.
  const plainRows = house.bulbs({ ...dev, matrix: { ...matrix, zigzag: false } });
  assert.notDeepEqual(plainRows.map((p) => p.join()), arch.map((p) => p.join()));
});

test("a matrix line's bulbs: positions by grid spot, a stretch out of view, and plain lights unchanged", () => {
  const house = new House({ api: async () => ({}), status: () => {}, frameFor: () => null });
  const matrix = { w: 4, h: 2, start: "top left", order: "rows", zigzag: true };
  house.devices = [{ id: "m", segments: 8, matrix }];
  house.paths.m = [[0.1, 0.5], [0.4, 0.5], [0.8, 0.5, 2]]; // the last two LEDs along the wire out of view
  const b = house.bulbs(house.devices[0]);
  assert.equal(b.filter(Boolean).length, 6);
  assert.equal(b[4], null); // along the wire, LED 8 is grid spot 4 (the zig-zag back)
  assert.equal(b[5], null);
  const pos = house.positions();
  assert.ok(pos.m);
  // A light that isn't a matrix gets its bulbs as before.
  const strip = { id: "s", segments: 8 };
  house.paths.s = [[0.1, 0.5], [0.8, 0.5]];
  assert.equal(house.bulbs(strip).length, 32);
  // A matrix whose size doesn't match its LEDs isn't treated as one.
  assert.equal(house.bulbs({ id: "s", segments: 8, matrix: { w: 3, h: 3 } }).length, 32);
});
