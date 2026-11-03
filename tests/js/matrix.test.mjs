import assert from "node:assert/strict";
import test from "node:test";

import { MAX_MATRIX, RUNS, expandRuns, gridOf, gridUV, matrixTestFrame, runsOf, stripLength, toWire, wireOrder }
  from "../../haliday_show/app/halidayshow/static/js/matrix.js";

// A 3 x 2 grid, numbered in rows from the top left:  0 1 2 / 3 4 5
const m = (start, order, zigzag) => ({ w: 3, h: 2, start, order, zigzag });

test("the wiring order for every start corner, direction and zig-zag", () => {
  const cases = [
    [m("top left", "rows", false), [0, 1, 2, 3, 4, 5]],
    [m("top left", "rows", true), [0, 1, 2, 5, 4, 3]],
    [m("top right", "rows", false), [2, 1, 0, 5, 4, 3]],
    [m("bottom left", "rows", true), [3, 4, 5, 2, 1, 0]],
    [m("top left", "columns", false), [0, 3, 1, 4, 2, 5]],
    [m("top left", "columns", true), [0, 3, 4, 1, 2, 5]],
    [m("bottom right", "columns", true), [5, 2, 1, 4, 3, 0]],
  ];
  for (const [matrix, want] of cases) assert.deepEqual([...wireOrder(matrix)], want, JSON.stringify(matrix));
});

test("frames go to the wire in wiring order, and plain rows are left as they are", () => {
  const rgb = Uint8Array.from({ length: 18 }, (_, i) => i);
  const wired = toWire(rgb, m("top left", "rows", true));
  assert.deepEqual([...wired.subarray(9, 12)], [15, 16, 17]); // the 4th LED on the wire is grid spot 5
  assert.deepEqual([...wired.subarray(0, 9)], [...rgb.subarray(0, 9)]);
  assert.equal(toWire(rgb, m("top left", "rows", false)), rgb);
});

test("a strip effect runs along each row, down each column, or once round the whole grid", () => {
  const strip = (n) => Float32Array.from({ length: n * 3 }, (_, i) => Math.floor(i / 3) + 1);
  const spots = (out) => [...out].filter((_, i) => i % 3 === 0);
  const run = (runs) => {
    const out = new Float32Array(18);
    expandRuns(strip(stripLength(runs, 3, 2)), runs, 3, 2, out);
    return spots(out);
  };
  assert.deepEqual(RUNS, ["rows", "columns", "strip"]);
  assert.deepEqual(run("rows"), [1, 2, 3, 1, 2, 3]);
  assert.deepEqual(run("columns"), [1, 1, 1, 2, 2, 2]);
  assert.deepEqual(run("strip"), [1, 2, 3, 6, 5, 4]); // zig-zag, so it never jumps back across
  assert.equal(runsOf({}), "rows");
  assert.equal(runsOf({ runs: "columns" }), "columns");
  assert.equal(runsOf({ runs: "sideways" }), "rows");
});

test("only a light whose LEDs fill its grid is a matrix", () => {
  assert.equal(MAX_MATRIX, 4096);
  assert.deepEqual(gridOf({ segments: 6, matrix: { w: 3, h: 2 } }), { w: 3, h: 2 });
  assert.equal(gridOf({ segments: 7, matrix: { w: 3, h: 2 } }), null);
  assert.equal(gridOf({ segments: 6 }), null);
  assert.equal(gridOf(null), null);
});

test("each LED's place across and down the grid, with a single row or column in the middle", () => {
  assert.deepEqual(gridUV(5, 3, 2), [1, 1]);
  assert.deepEqual(gridUV(1, 3, 2), [0.5, 0]);
  assert.deepEqual(gridUV(0, 1, 1), [0.5, 0.5]);
  assert.deepEqual(gridUV(2, 1, 3), [0.5, 1]);
});

test("the wiring test lights the top left white, the top row red and the left column green", () => {
  const f = matrixTestFrame({ w: 3, h: 2 });
  const at = (i) => [...f.subarray(i * 3, i * 3 + 3)];
  assert.deepEqual(at(0), [255, 255, 255]);
  assert.deepEqual(at(2), [255, 0, 0]);
  assert.deepEqual(at(3), [0, 255, 0]);
  assert.deepEqual(at(4), [0, 0, 0]);
});

test("a matrix clip on the timeline is a row of grid snapshots, each the grid's shape", async () => {
  const { gridTiles } = await import("../../haliday_show/app/halidayshow/static/js/matrix.js");
  const tiles = gridTiles(100, 200, 30, { w: 32, h: 16 });
  assert.equal(tiles[0].x, 100);
  assert.equal(tiles[0].w, 60); // 30 high, twice as wide
  assert.ok(tiles.every((t) => t.x + t.w <= 200 + 1e-9));
  assert.equal(tiles.length, 2); // 60 + 2 gap + the last, trimmed
  assert.equal(tiles[1].w, 38);
  assert.equal(tiles[0].frac, 1);
  assert.ok(Math.abs(tiles[1].frac - 38 / 60) < 1e-9); // the part of the grid the trimmed one shows
  assert.equal(gridTiles(0, 63, 30, { w: 32, h: 16 }).length, 1); // a 1 px sliver after the gap is left out
  assert.equal(gridTiles(0, 3, 30, { w: 32, h: 16 }).length, 1); // but a very short clip still gets one
  const tall = gridTiles(0, 100, 30, { w: 8, h: 32 });
  assert.equal(tall[0].w, 8); // never narrower than 8 px
});
