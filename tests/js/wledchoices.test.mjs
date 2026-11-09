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

test("a WLED's palettes: Default, then those from your colours, then A to Z", async () => {
  const { wledPaletteChoices } = await import("../../haliday_show/app/halidayshow/static/js/wledchoices.js");
  const names = ["Default", "* Random Cycle", "* Color 1", "Party", "Cloud", "", "Aurora"];
  assert.deepEqual(wledPaletteChoices(names).map((e) => e.name), ["Default", "* Random Cycle", "* Color 1", "Aurora", "Cloud", "Party"]);
  assert.deepEqual(wledPaletteChoices(names, "clo").map((e) => e.id), [4]);
});

test("a palette's colours for the palette window", async () => {
  const { wledPaletteColours } = await import("../../haliday_show/app/halidayshow/static/js/wled-effects/index.js");
  const p = { fx: 2, color: "#ff0000", color2: "#00ff00", color3: "#0000ff" };
  // Default on an effect without a palette of its own: your three colours.
  assert.deepEqual(Array.from(wledPaletteColours(p, 0, 3)), [255, 0, 0, 0, 255, 0, 0, 0, 255]);
  // "* Color 1": the first colour all along.
  assert.deepEqual(Array.from(wledPaletteColours(p, 2, 2)), [255, 0, 0, 255, 0, 0]);
  // Default on Fire 2012 is WLED's Fire palette, which starts black.
  assert.deepEqual(Array.from(wledPaletteColours({ ...p, fx: 66 }, 0, 4)).slice(0, 3), [0, 0, 0]);
});
