import assert from "node:assert/strict";
import test from "node:test";

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { DEMO_EXTRAS, DEMO_LIGHTS, DEMO_PARTS, canStartDemo, demoPartUrl, hasDemo, isDemoId, withoutDemo } from "../../haliday_show/app/halidayshow/static/js/demo.js";
import { savedLines } from "../../haliday_show/app/halidayshow/static/js/lyrics.js";
import { SAMPLE_SPOTS, placeOnSample } from "../../haliday_show/app/halidayshow/static/js/samplehouse.js";

test("every demo light is marked as the demo's and gets its own place on the sample house", () => {
  assert.ok(DEMO_LIGHTS.every((d) => isDemoId(d.id) && !d.ip));
  assert.ok(DEMO_LIGHTS.length <= SAMPLE_SPOTS.length);
  const { paths } = placeOnSample(DEMO_LIGHTS);
  assert.equal(Object.keys(paths).length, DEMO_LIGHTS.length);
  // Each goes where its name says.
  const at = (id) => SAMPLE_SPOTS.find((s) => JSON.stringify(s.points) === JSON.stringify(paths[id])).id;
  assert.equal(at("demo-icicles"), "eaves");
  assert.equal(at("demo-tree"), "tree");
  assert.equal(at("demo-path"), "path");
});

test("the demo is only offered with no lights, and removing it keeps your own", () => {
  assert.ok(canStartDemo([]));
  assert.ok(!canStartDemo([{ id: "mine" }]));
  assert.ok(hasDemo(DEMO_LIGHTS) && !hasDemo([{ id: "mine" }]));
  const house = { paths: { "demo-roof": [[0, 0]], mine: [[1, 1]] }, styles: { "demo-icicles": { style: "icicle" } },
    pins: { mine: { 1: 0.5 } } };
  assert.deepEqual(withoutDemo(house), { paths: { mine: [[1, 1]] }, styles: {}, pins: { mine: { 1: 0.5 } } });
});

test("the sample song's parts and extras ship with the app", () => {
  const at = (url) => `haliday_show/app/halidayshow/${url}`;
  for (const url of [...DEMO_PARTS.map(demoPartUrl), DEMO_EXTRAS]) {
    assert.ok(existsSync(at(url)), url);
    // In the repo, not just on this machine (*.mp3 is ignored by default).
    assert.equal(spawnSync("git", ["check-ignore", "-q", at(url)]).status, 1, `${url} is ignored by git`);
  }
  const extras = JSON.parse(readFileSync(at(DEMO_EXTRAS), "utf8"));
  assert.ok(extras.drums.kick.length && extras.sounds.step > 0);
  // The words line up with their text, word for word, so the song keeps them.
  const lines = savedLines(extras.lyrics);
  assert.ok(lines?.length > 10 && lines.every((l) => l.times?.length === l.words.length));
});
