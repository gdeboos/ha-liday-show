import test from "node:test";
import assert from "node:assert/strict";
import { findEntities, haKind, kindCounts } from "../../haliday_show/app/halidayshow/static/js/hapicker.js";

const list = [
  { entity: "switch.christmas_projector", name: "Christmas Projector", colour: false },
  { entity: "light.porch", name: "Porch", colour: true },
  { entity: "switch.deboos_main_enabled", name: "DeBoos_Main Enabled", colour: false },
  { entity: "light.bedroom_ceiling_light", name: "Bedroom Ceiling Light", colour: false },
  { entity: "light.tree", name: "Christmas Tree", colour: true },
];

test("sorts colour lights, then other lights, then switches", () => {
  assert.deepEqual(findEntities(list).map((e) => e.entity),
    ["light.tree", "light.porch", "light.bedroom_ceiling_light", "switch.christmas_projector", "switch.deboos_main_enabled"]);
});

test("finds by every word, in the name or the entity id", () => {
  assert.deepEqual(findEntities(list, "christmas").map((e) => e.entity), ["light.tree", "switch.christmas_projector"]);
  assert.deepEqual(findEntities(list, "CEILING bed").map((e) => e.entity), ["light.bedroom_ceiling_light"]);
  assert.deepEqual(findEntities(list, "switch.deboos").map((e) => e.entity), ["switch.deboos_main_enabled"]);
  assert.deepEqual(findEntities(list, "nothing"), []);
});

test("filters by kind and counts each", () => {
  assert.deepEqual(findEntities(list, "", "switch").length, 2);
  assert.deepEqual(findEntities(list, "christmas", "colour").map((e) => e.entity), ["light.tree"]);
  assert.equal(haKind(list[3]), "light");
  assert.deepEqual(kindCounts(list), { "": 5, colour: 2, light: 1, switch: 2 });
});
