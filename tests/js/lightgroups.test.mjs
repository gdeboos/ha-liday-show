import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSegments, memberChoices, membersText, nameProblem, newGroupId, rangeTakes, tidyMembers }
  from "../../haliday_show/app/halidayshow/static/js/lightgroups.js";

const lights = [
  { id: "roof", name: "Roof", segments: 60 },
  { id: "ice", name: "Icicles", segments: 400, parts: [{ id: "l", name: "Left", from: 1, to: 200 }, { id: "r", name: "Right", from: 201, to: 400 }] },
];

test("members are lights and parts, in the Devices tab's order", () => {
  assert.deepEqual(memberChoices(lights).map((c) => c.id), ["roof", "ice", "ice#l", "ice#r"]);
  assert.deepEqual(tidyMembers(["ice#r", "gone", "roof"], lights), ["roof", "ice#r"]);
  assert.deepEqual(tidyMembers(["ice", "ice#l"], lights), ["ice"], "a part whose light is in already goes");
});

test("a group in words and in segments", () => {
  assert.equal(membersText(["roof", "ice#l"], lights), "Roof, Icicles · Left");
  assert.equal(membersText([], lights), "No lights yet");
  assert.equal(membersText(["roof", "ice#l", "ice#r"], lights, 1), "Roof and 2 more");
  assert.equal(groupSegments(["roof", "ice#r"], lights), 260);
  assert.equal(groupSegments(["ice"], lights), 400);
});

test("names are needed and free; ids come from them", () => {
  const groups = [{ id: "roof", name: "Roof" }];
  assert.equal(nameProblem(groups, "  "), "Give the group a name");
  assert.match(nameProblem(groups, "roof"), /already/);
  assert.equal(nameProblem(groups, "roof", "roof"), null);
  assert.equal(newGroupId(groups, "Roof"), "roof-2");
  assert.equal(newGroupId(groups, "Front & side!"), "front-side");
});

test("a selected stretch puts each kind of effect on the right lanes", () => {
  assert.equal(rangeTakes(false, "group", ["group"]), true);
  assert.equal(rangeTakes(true, "group", ["group"]), true);
  assert.equal(rangeTakes(false, "group", ["group", "light"]), false, "light effects go on the lights");
  assert.equal(rangeTakes(true, "group", ["house", "group"]), false, "House effects go on the House lane");
  assert.equal(rangeTakes(true, "group", ["group", "light"]), true);
  assert.equal(rangeTakes(true, "light", ["light"]), false);
});
