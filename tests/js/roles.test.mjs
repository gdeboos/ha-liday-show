import assert from "node:assert/strict";
import test from "node:test";

import { ROLES, cleanRoles, guessRoles, rolesFor } from "../../haliday_show/app/halidayshow/static/js/roles.js";

const lanes = [
  { id: "roof", segments: 300 }, { id: "door", segments: 20 }, { id: "tree", segments: 64, matrix: { w: 8, h: 8 } },
  { id: "porch", segments: 1, slow: true }, { id: "pillar#l", segments: 100 }, { id: "pillar#r", segments: 100 },
];

test("a guess for every light: the matrix sings, a slow light glows, the biggest carries the tune", () => {
  const g = guessRoles(lanes);
  assert.equal(g.tree, "vocals");
  assert.equal(g.porch, "background");
  assert.equal(g.roof, "melody");
  assert.deepEqual([g["pillar#l"], g["pillar#r"], g.door], ["kick", "snare", "crash"]);
  for (const r of Object.values(g)) assert.ok(r in ROLES);
});

test("a show's role beats the house's, which beats the guess; unknown roles are ignored", () => {
  const r = rolesFor(lanes, { door: "bass", roof: "nope" }, { door: "vocals", tree: "kick" });
  assert.equal(r.door, "vocals");
  assert.equal(r.tree, "kick");
  assert.equal(r.roof, "melody");
  assert.deepEqual(cleanRoles({ door: "bass", gone: "kick", roof: "x" }, ["door", "roof"]), { door: "bass" });
});
