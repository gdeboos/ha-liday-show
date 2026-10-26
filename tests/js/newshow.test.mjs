import test from "node:test";
import assert from "node:assert/strict";
import { freeName, startChoices } from "../../haliday_show/app/halidayshow/static/js/newshow.js";

test("freeName keeps a free name and numbers a taken one", () => {
  assert.equal(freeName("Jingle bells", ["Xmas 1"]), "Jingle bells");
  assert.equal(freeName("Jingle bells", ["jingle bells"]), "Jingle bells 2");
  assert.equal(freeName("Jingle bells", ["Jingle bells", "Jingle bells 2"]), "Jingle bells 3");
  assert.equal(freeName("  ", []), "Untitled show");
});

test("startChoices offers empty always, and generating only with a song and lights", () => {
  const ok = startChoices({ song: true, lights: true, ai: true });
  assert.deepEqual(ok.map((c) => c.value), ["empty", "rules", "ai"]);
  assert.ok(ok.every((c) => !c.disabled));
  const noSong = startChoices({ song: false, lights: true, ai: true });
  assert.equal(noSong[0].disabled, false);
  assert.ok(noSong.slice(1).every((c) => c.disabled && /song/.test(c.why)));
  const noLights = startChoices({ song: true, lights: false, ai: false });
  assert.deepEqual(noLights.map((c) => c.value), ["empty", "rules"]);
  assert.match(noLights[1].why, /Setup → Devices/);
});
