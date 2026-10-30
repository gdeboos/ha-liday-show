import test from "node:test";
import assert from "node:assert/strict";
import { GLYPHS, splitGlyphs } from "../../haliday_show/app/halidayshow/static/js/glyphs.js";

test("symbols on buttons are picked out of the label", () => {
  assert.deepEqual(splitGlyphs("▶ Play"), [{ glyph: "▶" }, " Play"]);
  assert.deepEqual(splitGlyphs("⏩"), [{ glyph: "⏩" }]);
  assert.deepEqual(splitGlyphs("Play ▶️ now"), ["Play ", { glyph: "▶" }, " now"]);
  assert.deepEqual(splitGlyphs("⏸ Pause ■"), [{ glyph: "⏸" }, " Pause ", { glyph: "■" }]);
  assert.deepEqual(splitGlyphs("Next →"), ["Next →"]);
  assert.deepEqual(splitGlyphs(""), [""]);
});

test("every symbol has a drawing", () => {
  for (const [g, shapes] of Object.entries(GLYPHS)) assert.ok(shapes.length > 0, g);
});
