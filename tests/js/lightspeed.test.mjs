import assert from "node:assert/strict";
import test from "node:test";

import { SLOW_PROTOCOLS, isSlow } from "../../haliday_show/app/halidayshow/static/js/lightspeed.js";

test("only the non-realtime protocols are slow", () => {
  assert.deepEqual(Object.keys(SLOW_PROTOCOLS).sort(), ["ha_light", "ha_switch", "whole"]);
  assert.equal(isSlow({ protocol: "whole" }), true);
  assert.equal(isSlow({ protocol: "ha_switch" }), true);
  for (const p of ["standard", "ddp", "e131", undefined]) assert.equal(isSlow({ protocol: p }), false);
  assert.equal(isSlow(undefined), false);
});

import { clipPace } from "../../haliday_show/app/halidayshow/static/js/lightspeed.js";
import { newClip } from "../../haliday_show/app/halidayshow/static/js/effects.js";

const lamp = { protocol: "ha_light", segments: 1 };
const clip = (effect, params) => ({ ...newClip(effect, 0, 10), ...params });

test("fast flashes are too fast for a Home Assistant light, slow fades are not", () => {
  assert.equal(clipPace(clip("strobe", { rate: 10 }), lamp).tooFast, true);
  assert.equal(clipPace(clip("cycle", { rate: 0.25, blend: "fade" }), lamp).tooFast, false);
  assert.equal(clipPace(clip("solid", {}), lamp).needed, 0);
});

test("only slow protocols are checked, and Whole light judges the average colour", () => {
  assert.equal(clipPace(clip("chase", { speed: 2 }), { protocol: "standard", segments: 30 }), null);
  // A chase barely moves the average colour, so it's fine on Whole light.
  assert.equal(clipPace(clip("chase", { speed: 2 }), { protocol: "whole", segments: 30 }).tooFast, false);
  assert.equal(clipPace(clip("strobe", { rate: 10 }), { protocol: "whole", segments: 30 }).tooFast, true);
});

test("colour changes are fine up to what the light manages, and smooth drifts only if slow enough", () => {
  assert.equal(clipPace(clip("cycle", { rate: 2, blend: "step" }), lamp).tooFast, false);
  assert.equal(clipPace(clip("cycle", { rate: 8, blend: "step" }), lamp).tooFast, true);
});

test("previews show what a slow light shows: stepped, and one colour on Whole light", async () => {
  const { asShown } = await import("../../haliday_show/app/halidayshow/static/js/lightspeed.js");
  const { renderTrack } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const fade = clip("fade", { from: "#000000", to: "#ff0000" });
  const at = (dev, t) => asShown(dev, t, (tt) => renderTrack([fade], tt, dev.segments));
  const realtime = { protocol: "standard", segments: 4 };
  assert.deepEqual(at(realtime, 1.05), renderTrack([fade], 1.05, 4)); // realtime: as it is
  const whole = { protocol: "whole", segments: 4 };
  assert.deepEqual(at(whole, 1.05), renderTrack([fade], 1.0, 4)); // 10 a second: the update at 1.0 s
  assert.deepEqual(at(whole, 1.05), at(whole, 1.09));
  // A chase on Whole light is its average colour on every segment.
  const chase = clip("chase", { width: 1, color: "#ffffff", background: "#000000" });
  const f = asShown(whole, 0.3, (tt) => renderTrack([chase], tt, 4));
  assert.deepEqual([...f], Array(4).fill([64, 64, 64]).flat());
});

test("a Home Assistant switch flags a beat flash that's faster than once a second", () => {
  const sw = { protocol: "ha_switch", segments: 1 };
  const flash = { ...newClip("pulse", 0, 4), params: { ...newClip("pulse", 0, 4).params } };
  const pace = clipPace(flash, sw);
  assert.equal(pace.label, "a Home Assistant switch");
  assert.equal(pace.can, 1);
});

test("a Home Assistant switch previews as plain on or off", async () => {
  const { asShown, switchOn } = await import("../../haliday_show/app/halidayshow/static/js/lightspeed.js");
  const sw = { protocol: "ha_switch", segments: 1 };
  assert.deepEqual([...asShown(sw, 0, () => new Uint8Array([200, 0, 0]))], [255, 255, 255]);
  assert.deepEqual([...asShown(sw, 0, () => new Uint8Array([60, 60, 60]))], [0, 0, 0]);
  assert.equal(switchOn(new Uint8Array([0, 128, 0])), true);
});
