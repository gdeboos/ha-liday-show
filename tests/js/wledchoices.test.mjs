import assert from "node:assert/strict";
import test from "node:test";

import { wledEffectChoices } from "../../haliday_show/app/halidayshow/static/js/wledchoices.js";

test("a WLED's effects: Solid first, then A to Z, reserved slots left out, split by how well they preview", () => {
  const names = ["Solid", "Blink", "", "Aurora", "Wipe"];
  names[139] = "GEQ"; // sound-reactive: only a rough preview
  const { drawn, rough } = wledEffectChoices(names);
  assert.deepEqual(drawn.map((e) => e.name), ["Solid", "Aurora", "Blink", "Wipe"]);
  assert.deepEqual(drawn.map((e) => e.id), [0, 3, 1, 4]);
  assert.deepEqual(rough, [{ id: 139, name: "GEQ" }]);
});

test("finding an effect by part of its name", () => {
  const { drawn, rough } = wledEffectChoices(["Solid", "Blink", "Breathe", "Fire 2012"], "  bR ");
  assert.deepEqual(drawn.map((e) => e.name), ["Breathe"]);
  assert.equal(rough.length, 0);
  assert.deepEqual(wledEffectChoices(null), { drawn: [], rough: [] });
});
