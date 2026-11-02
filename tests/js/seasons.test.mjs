import assert from "node:assert/strict";
import test from "node:test";

import { awayIds, newSeason, seasonNames } from "../../haliday_show/app/halidayshow/static/js/seasons.js";

const seasons = [{ id: "halloween", name: "Halloween", out: false }, { id: "bonfire", name: "Bonfire Night", out: true },
  { id: "christmas", name: "Christmas", out: true }];

test("a prop is packed away only when every season it's in is packed away", () => {
  const devices = [{ id: "tree" }, { id: "ghost", seasons: ["halloween"] }, { id: "orange", seasons: ["halloween", "bonfire"] },
    { id: "old", seasons: ["gone"] }];
  assert.deepEqual([...awayIds(devices, seasons)], ["ghost"]);
});

test("a light's seasons by name, deleted ones left out, none meaning all year", () => {
  assert.equal(seasonNames({ seasons: ["christmas", "gone", "halloween"] }, seasons), "Halloween, Christmas"); // in the seasons' order
  assert.equal(seasonNames({}, seasons), "");
});

test("a new season gets an id from its name, different from the others", () => {
  assert.deepEqual(newSeason(seasons, " Bonfire  Night "), { id: "bonfire-night", name: "Bonfire Night", out: true });
  assert.deepEqual(newSeason([...seasons, { id: "easter", name: "Easter", out: true }], "Easter!").id, "easter-2");
});

test("a show lists its season's props and the all-year lights, and Any season lists every light", async () => {
  const { inSeason } = await import("../../haliday_show/app/halidayshow/static/js/seasons.js");
  const ghost = { id: "ghost", seasons: ["halloween"] }, tree = { id: "tree" };
  assert.ok(inSeason(tree, "christmas", seasons));
  assert.ok(!inSeason(ghost, "christmas", seasons));
  assert.ok(inSeason(ghost, "halloween", seasons));
  assert.ok(inSeason(ghost, undefined, seasons));
  assert.ok(inSeason(ghost, "deleted-season", seasons)); // a show whose season is gone is Any season
  assert.ok(inSeason({ id: "old", seasons: ["gone"] }, "christmas", seasons)); // only deleted seasons: all year
});
