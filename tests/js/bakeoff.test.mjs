import assert from "node:assert/strict";
import test from "node:test";
import { bake, newClip } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import { bakeOff, bakeLiveOff } from "../../haliday_show/app/halidayshow/static/js/bakeoff.js";

test("baking off the page gives exactly what baking on it does (here, without a worker)", async () => {
  const show = { duration: 2, tracks: [{ device: "a", clips: [{ ...newClip("rainbow", 0, 2) }] }] };
  const devices = { a: { segments: 5 } };
  const off = await bakeOff(show, devices, 10);
  assert.deepEqual(Array.from(off), Array.from(bake(show, devices, 10)));
  assert.equal(await bakeLiveOff(show, devices), null); // no live effects: nothing to bake
});
