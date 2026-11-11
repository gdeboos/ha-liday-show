import assert from "node:assert/strict";
import { test } from "node:test";

import { elsewhere, isPlan, liveWarning, onlyElsewhere, pickedProfile, withProfile } from "../../haliday_show/app/halidayshow/static/js/profiles.js";

const view = {
  live: "now",
  profiles: [
    { id: "now", name: "Now", lights: ["a", "b"], groups: ["g1"], live: true },
    { id: "p1", name: "Next year", lights: ["b", "c"], groups: ["g1", "g2"], live: false },
  ],
};

test("only the profile routes are asked about a profile", () => {
  assert.equal(withProfile("api/devices", "p1"), "api/devices?profile=p1");
  assert.equal(withProfile("api/house/photo?v=3", "p1"), "api/house/photo?v=3&profile=p1");
  assert.equal(withProfile("api/devices/test", "p1"), "api/devices/test");
  assert.equal(withProfile("api/shows", "p1"), "api/shows");
  assert.equal(withProfile("api/house", null), "api/house");
});

test("the picked profile falls back to the live one", () => {
  assert.equal(pickedProfile(view, "p1"), "p1");
  assert.equal(pickedProfile(view, "gone"), "now");
  assert.equal(pickedProfile(null, "p1"), null);
  assert.ok(isPlan(view, "p1"));
  assert.ok(!isPlan(view, "now"));
});

test("lanes of other profiles' lights and groups are hidden", () => {
  const onNow = elsewhere(view, "now");
  assert.ok(onlyElsewhere("c", onNow));
  assert.ok(onlyElsewhere("c#top", onNow));
  assert.ok(onlyElsewhere("@group:g2", onNow));
  assert.ok(!onlyElsewhere("b", onNow));
  assert.ok(!onlyElsewhere("@group:g1", onNow));
  assert.ok(!onlyElsewhere("gone", onNow)); // a removed light still shows, so its effects can be found
  const onPlan = elsewhere(view, "p1");
  assert.ok(onlyElsewhere("a", onPlan) && !onlyElsewhere("c", onPlan));
  assert.equal(elsewhere({ live: "now", profiles: [view.profiles[0]] }, "now").size, 0);
});

test("Make this the live one says what changes", () => {
  const text = liveWarning(view, "p1");
  assert.match(text, /Make Next year the live one\?/);
  assert.match(text, /1 light only in Next year starts playing/);
  assert.match(text, /1 light only in Now stops/);
});
