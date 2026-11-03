import assert from "node:assert/strict";
import test from "node:test";

import { EFFECTS, newClip, renderTrack } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import { BLOCK_EFFECTS } from "../../haliday_show/app/halidayshow/static/js/playlisteditor.js";
import { SCENE_EFFECTS, changeEffect, sceneShow } from "../../haliday_show/app/halidayshow/static/js/housescenes.js";
import { effectsForAI } from "../../haliday_show/app/halidayshow/static/js/aiclips.js";
import { paletteKeys } from "../../haliday_show/app/halidayshow/static/js/palettes.js";

test("WLED's own effect: a still stand-in in its colours, offered only where it's asked for", () => {
  const clip = { ...newClip("wled", 0, 10), color: "#ff0000", color2: "#00ff00", color3: "#0000ff" };
  const a = renderTrack([clip], 1, 3), b = renderTrack([clip], 7, 3);
  assert.deepEqual(a, b); // the preview can't show WLED's effect, so it doesn't pretend to move
  assert.deepEqual([...a.subarray(0, 3)], [255, 0, 0]);
  assert.deepEqual([...a.subarray(6, 9)], [0, 0, 255]);
  assert.ok(!BLOCK_EFFECTS.includes("wled") && !SCENE_EFFECTS.includes("wled")); // the scene editor adds it on WLED rows
  assert.ok(!effectsForAI().some((e) => e.key === "wled"));
  assert.deepEqual(paletteKeys("wled"), ["color", "color2", "color3"]); // palettes colour it
});

test("a scene light switched to WLED's own effect keeps its colours and saves flat settings", () => {
  const look = changeEffect({ effect: "duo", params: { color: "#123456", color2: "#abcdef" } }, "wled");
  assert.equal(look.effect, "wled");
  assert.equal(look.params.color, "#123456");
  assert.ok(Object.values(look.params).every((v) => typeof v === "number" || typeof v === "string")); // fits the server's check
  const show = sceneShow({ mode: "basic", lights: { w: look } }, [{ id: "w", segments: 10 }], 1);
  assert.equal(show.tracks[0].clips[0].effect, "wled"); // baked as the stand-in; the player sends it no frames
  assert.ok(EFFECTS.wled.wledOwn);
});

test("the server's default colours for WLED's own effect match the editor's", async () => {
  const fs = await import("node:fs");
  const py = fs.readFileSync(new URL("../../haliday_show/app/halidayshow/wled.py", import.meta.url), "utf8");
  for (const p of EFFECTS.wled.params.filter((q) => q.type === "color")) assert.ok(py.includes(`"${p.key}": "${p.default}"`), p.key);
});

test("Same for every light and Each part on its own never copy WLED's own effect elsewhere", async () => {
  const { setSame, setByParts } = await import("../../haliday_show/app/halidayshow/static/js/housescenes.js");
  const own = { effect: "wled", params: { fx: 5, color: "#ff0000" } };
  const lights = [{ id: "w", kind: "wled", segments: 10 }, { id: "g", segments: 10 }];
  const same = setSame({ mode: "basic", lights: { w: structuredClone(own) } }, true, lights);
  assert.equal(same.all.effect, "trio");
  assert.equal(same.all.params.color, "#ff0000"); // its colours carry over
  const split = setByParts({ mode: "basic", lights: { w: structuredClone(own) } },
    { id: "w", parts: [{ id: "a", from: 1, to: 5 }, { id: "b", from: 6, to: 10 }] }, true);
  assert.ok(Object.values(split.lights).every((l) => l.effect === "trio"));
});
