import { test } from "node:test";
import assert from "node:assert/strict";
import { REACT_DEFAULTS, lookChoices, reactOf } from "../../haliday_show/app/halidayshow/static/js/reactui.js";

test("an old scene has React to music off, with the server's defaults", () => {
  assert.deepEqual(reactOf({ name: "Glow" }), REACT_DEFAULTS);
  assert.equal(reactOf({ react: { on: true, quiet: 40 } }).quiet, 40);
  assert.equal(reactOf({ react: { on: true } }).strength, 60);
});

test("the strong bass and treble looks are any other scene, by name", () => {
  const scenes = [{ id: "glow", name: "Glow" }, { id: "thump", name: "Thump" }, { id: "air", name: "Air", baked: true }];
  assert.deepEqual(lookChoices(scenes, "glow"), [{ id: "air", name: "Air" }, { id: "thump", name: "Thump" }]);
});
