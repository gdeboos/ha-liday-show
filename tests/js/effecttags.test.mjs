import test from "node:test";
import assert from "node:assert/strict";
import { EFFECTS } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import { FILTERS, matches, tagsOf } from "../../haliday_show/app/halidayshow/static/js/effecttags.js";

test("every effect but WLED's own has at least one tag, and only known ones", () => {
  const known = new Set(FILTERS.map(([t]) => t));
  for (const [key, fx] of Object.entries(EFFECTS)) {
    const tags = tagsOf(key, fx);
    if (key !== "wled") assert.ok(tags.size, `${key} has no tags`);
    for (const t of tags) assert.ok(known.has(t), `${key}: ${t}`);
  }
});

test("filters narrow by every tag picked, and by name", () => {
  assert.ok(matches("twinkle", EFFECTS.twinkle, ["sparkles", "calm"]));
  assert.ok(!matches("strobe", EFFECTS.strobe, ["calm"]));
  assert.ok(matches("vumeter", EFFECTS.vumeter, ["music"]));
  assert.ok(matches("chase", EFFECTS.chase, [], "cha"));
  assert.ok(!matches("chase", EFFECTS.chase, [], "rain"));
  assert.ok(matches("theatre", EFFECTS.theatre, ["moves"], "theatre chase"));
});
