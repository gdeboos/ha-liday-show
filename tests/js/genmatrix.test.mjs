import assert from "node:assert/strict";
import test from "node:test";

import { EFFECTS } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import { generateShow } from "../../haliday_show/app/halidayshow/static/js/autogen.js";
import { ON_A_MATRIX, laneTakes } from "../../haliday_show/app/halidayshow/static/js/matrix.js";

const analysis = {
  duration: 96, tempo: 120,
  beats: Array.from({ length: 192 }, (_, i) => i * 0.5),
  bars: Array.from({ length: 48 }, (_, i) => i * 2),
  sections: [
    { start: 0, end: 32, label: "Verse", energy: 0.4 },
    { start: 32, end: 64, label: "Chorus", energy: 0.9 },
    { start: 64, end: 96, label: "Bridge", energy: 0.55 },
  ],
};
const colors = ["#ff0000", "#00ff00", "#0000ff"];
const lights = [
  { id: "roof", segments: 60 },
  { id: "panel", segments: 512, grid: { w: 32, h: 16 } },
  { id: "tree", segments: 400, grid: { w: 16, h: 25 }, tree: true },
];
const used = (list) => list.map((c) => c.effect);
const usable = (k) => (EFFECTS[k].grid && !EFFECTS[k].params.some((p) => p.type === "text" || p.type === "picture")) || ON_A_MATRIX.includes(k);

test("Generate uses matrix effects on matrices, and never on strips", () => {
  for (let seed = 1; seed <= 6; seed++) {
    const { clips } = generateShow(analysis, lights, colors, { seed });
    assert.ok(used(clips.roof).every((e) => laneTakes(e, EFFECTS[e], "light")), used(clips.roof).join());
    for (const id of ["panel", "tree"]) assert.ok(used(clips[id]).every((e) => laneTakes(e, EFFECTS[e], "matrix")));
  }
  const all = [1, 2, 3, 4, 5, 6].flatMap((seed) => {
    const { clips } = generateShow(analysis, lights, colors, { seed });
    return [...used(clips.panel), ...used(clips.tree)];
  });
  assert.ok(all.some(usable), "some matrix looks");
  assert.ok(all.some((e) => !usable(e) && e !== "fade"), "and some strip looks too");
  assert.ok(!all.includes("text") && !all.includes("picture")); // they need your words or pictures
});

test("strip looks on a mega-tree run down its strings; elsewhere they keep rows", () => {
  const { clips } = generateShow(analysis, lights, colors, { seed: 3 });
  for (const c of clips.tree) {
    const fx = EFFECTS[c.effect];
    if (!fx.house && !fx.grid && c.effect !== "fade") assert.equal(c.runs, "columns", c.effect);
    else assert.equal(c.runs, undefined);
  }
  assert.ok(clips.panel.every((c) => c.runs === undefined));
  assert.ok(clips.roof.every((c) => c.runs === undefined));
});

test("a show with no matrices generates exactly as before", () => {
  const strips = [{ id: "roof", segments: 60 }, { id: "path", segments: 30 }];
  const a = generateShow(analysis, strips, colors, { seed: 2 });
  const b = generateShow(analysis, strips.map((l) => ({ ...l, grid: null, tree: false })), colors, { seed: 2 });
  assert.deepEqual(a, b);
  assert.ok(Object.values(a.clips).flat().every((c) => !EFFECTS[c.effect].grid));
});

test("which lanes take which effects", () => {
  assert.ok(laneTakes("plasma", EFFECTS.plasma, "matrix"));
  assert.ok(!laneTakes("plasma", EFFECTS.plasma, "light"));
  assert.ok(!laneTakes("sweep", EFFECTS.sweep, "matrix"));
  assert.ok(laneTakes("sweep", EFFECTS.sweep, "house"));
  assert.ok(!laneTakes("chase", EFFECTS.chase, "house"));
  assert.ok(laneTakes("chase", EFFECTS.chase, "matrix") && laneTakes("fire2d", EFFECTS.fire2d, "light"));
  assert.ok(laneTakes("sweep", EFFECTS.sweep, "group"));
});

test("a clip pasted or copied onto another lane", async () => {
  const { clipForLane } = await import("../../haliday_show/app/halidayshow/static/js/matrix.js");
  const chase = { effect: "chase", start: 0, end: 4 };
  assert.equal(clipForLane(chase, EFFECTS.chase, { lane: "matrix", tree: true }).runs, "columns"); // strip → tree
  assert.equal(clipForLane(chase, EFFECTS.chase, { lane: "matrix", tree: true, fromMatrix: true }).runs, undefined); // keeps its Runs
  assert.equal(clipForLane({ ...chase, runs: "strip" }, EFFECTS.chase, { lane: "matrix", tree: true }).runs, "strip");
  assert.equal(clipForLane(chase, EFFECTS.chase, { lane: "matrix" }).runs, undefined); // a panel keeps rows
  assert.equal(clipForLane(chase, EFFECTS.chase, { lane: "house" }), null);
  const plasma = { effect: "plasma", start: 0, end: 4 };
  assert.equal(clipForLane(plasma, EFFECTS.plasma, { lane: "light" }), null); // not onto a strip
  assert.deepEqual(clipForLane(plasma, EFFECTS.plasma, { lane: "matrix", tree: true }), plasma);
  assert.ok(clipForLane(plasma, EFFECTS.plasma, { lane: "group" }));
});
