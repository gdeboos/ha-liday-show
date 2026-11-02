import { test } from "node:test";
import assert from "node:assert/strict";
import { REACT_DEFAULTS, lookChoices, reactOf, reactSummary } from "../../haliday_show/app/halidayshow/static/js/reactui.js";

test("an old scene has React to music off, with the server's defaults", () => {
  assert.deepEqual(reactOf({ name: "Glow" }), REACT_DEFAULTS);
  assert.equal(reactOf({ react: { on: true, quiet: 40 } }).quiet, 40);
  assert.equal(reactOf({ react: { on: true } }).strength, 60);
});

test("the strong bass and treble looks are any other scene, by name", () => {
  const scenes = [{ id: "glow", name: "Glow" }, { id: "thump", name: "Thump" }, { id: "air", name: "Air", baked: true }];
  assert.deepEqual(lookChoices(scenes, "glow"), [{ id: "air", name: "Air" }, { id: "thump", name: "Thump" }]);
});

test("the line says what it does", () => {
  const names = { thump: "Thump" };
  assert.equal(reactSummary(REACT_DEFAULTS), "Off");
  assert.equal(reactSummary({ ...REACT_DEFAULTS, on: true }), "Louder is brighter (down to 20%) · flashes on beats");
  assert.equal(reactSummary({ ...REACT_DEFAULTS, on: true, flash: false, bass: "thump", treble: "gone" }, (id) => names[id]),
    "Louder is brighter (down to 20%) · strong bass: Thump · strong treble: a deleted scene");
});
