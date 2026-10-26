import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COLOURS, bestOn, contrast, mix, readability } from "../../haliday_show/app/halidayshow/static/public/colours.js";

test("contrast and mixing follow the usual sums", () => {
  assert.equal(Math.round(contrast("#ffffff", "#000000")), 21);
  assert.equal(mix("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(bestOn("#ffd36b"), "#111111");
  assert.equal(bestOn("#0b3d91"), "#ffffff");
});

test("the readability check names the pairs that are hard to read", () => {
  assert.deepEqual(readability(DEFAULT_COLOURS), []);
  const bad = readability({ ...DEFAULT_COLOURS, text: "#2a3a30" });
  assert.ok(bad.some((m) => m.startsWith("Text on the background")));
  assert.ok(bad.every((m) => /aim for 4\.5:1/.test(m)));
});
