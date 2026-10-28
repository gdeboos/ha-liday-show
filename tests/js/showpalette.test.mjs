import assert from "node:assert/strict";
import test from "node:test";

import { refreshShowPalette, setShowPalette, showPalette } from "../../haliday_show/app/halidayshow/static/js/showpalette.js";

test("a show follows its palette by name, and keeps a copy for when it's gone", () => {
  const mine = [{ name: "Ours", colors: ["#111111", "#222222"] }];
  const show = setShowPalette({}, mine[0]);
  assert.deepEqual(showPalette(show, mine), { name: "Ours", colors: ["#111111", "#222222"] });
  mine[0].colors = ["#333333"]; // edited
  assert.deepEqual(showPalette(show, mine).colors, ["#333333"]);
  assert.ok(refreshShowPalette(show, mine));
  assert.ok(!refreshShowPalette(show, mine));
  assert.deepEqual(showPalette(show, []).colors, ["#333333"]); // deleted: the last colours it had
  assert.equal(showPalette({}, mine), null);
  assert.equal(showPalette(setShowPalette(show, null), mine), null);
  assert.equal(show.palette, undefined);
});
