import assert from "node:assert/strict";
import test from "node:test";

import { bake, newClip } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import { PHONES, colourAt, hasPhonesLane, mainColour, phoneCount, phonesJoin } from "../../haliday_show/app/halidayshow/static/js/phones.js";

const headerOf = (blob) => {
  const hlen = new DataView(blob.buffer).getUint32(5);
  return JSON.parse(new TextDecoder().decode(blob.subarray(9, 9 + hlen)));
};

test("the house's main colour: lit bulbs averaged, as bright as the brightest", () => {
  assert.deepEqual(mainColour([new Uint8Array([0, 0, 0, 0, 0, 0])]), [0, 0, 0]);
  // One bright red prop on a dark house: the phones are bright red.
  assert.deepEqual(mainColour([new Uint8Array([255, 0, 0]), new Uint8Array([0, 0, 0, 2, 2, 2])]), [255, 0, 0]);
  // Red and green half each: yellow, at the brightest bulb's level.
  assert.deepEqual(mainColour([new Uint8Array([200, 0, 0, 0, 200, 0])]), [200, 200, 0]);
  // A fade on every light fades the phones.
  assert.deepEqual(mainColour([new Uint8Array([0, 0, 50, 0, 0, 50])]), [0, 0, 50]);
});

test("each bake carries a colour for phones ten times a second", () => {
  const show = { duration: 2, tracks: [{ device: "a", clips: [{ ...newClip("solid", 0, 1), color: "#ff0000" }] }] };
  const h = headerOf(bake(show, { a: { segments: 3 } }, 40));
  assert.equal(h.phones.fps, 10);
  assert.equal(h.phones.colours.length, phoneCount(80, 40) * 6);
  assert.deepEqual(colourAt(h.phones.colours, 0.5), [255, 0, 0]);
  assert.deepEqual(colourAt(h.phones.colours, 1.5), [0, 0, 0]); // the clip has ended
  assert.deepEqual(colourAt(h.phones.colours, 9), [0, 0, 0]); // past the end
  assert.equal(h.frames, 80);
});

test("a Phones lane replaces the house colour, dark in its gaps, and is never a light", () => {
  const show = { duration: 2, tracks: [
    { device: "a", clips: [{ ...newClip("solid", 0, 2), color: "#ff0000" }] },
    { device: PHONES, clips: [{ ...newClip("solid", 1, 2), color: "#0000ff" }] },
  ] };
  assert.ok(hasPhonesLane(show));
  const h = headerOf(bake(show, { a: { segments: 3 }, [PHONES]: { segments: 1, phones: true } }, 40));
  assert.deepEqual(h.tracks, [{ device: "a", segments: 3 }]);
  assert.deepEqual(colourAt(h.phones.colours, 0.5), [0, 0, 0]);
  assert.deepEqual(colourAt(h.phones.colours, 1.5), [0, 0, 255]);
});

test("phones join a show while the switch is on, unless it stays out", () => {
  assert.equal(phonesJoin({}, false), false);
  assert.equal(phonesJoin({}, true), true);
  assert.equal(phonesJoin({ phones: false }, true), false);
});

test("House colour on a Phones lane shows the house's main colour, only there", async () => {
  const { EFFECTS } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const { laneTakes } = await import("../../haliday_show/app/halidayshow/static/js/matrix.js");
  const show = { duration: 2, tracks: [
    { device: "a", clips: [{ ...newClip("solid", 0, 2), color: "#00ff00" }] },
    { device: PHONES, clips: [newClip("housecolour", 0, 1), { ...newClip("solid", 1, 2), color: "#0000ff" }] },
  ] };
  const h = headerOf(bake(show, { a: { segments: 3 }, [PHONES]: { segments: 1, phones: true } }, 40));
  assert.deepEqual(colourAt(h.phones.colours, 0.5), [0, 255, 0]); // the house's colour
  assert.deepEqual(colourAt(h.phones.colours, 1.5), [0, 0, 255]); // designed by hand
  assert.ok(laneTakes("housecolour", EFFECTS.housecolour, "phones"));
  for (const lane of ["light", "group", "house", "matrix"]) assert.ok(!laneTakes("housecolour", EFFECTS.housecolour, lane));
  // A phone's screen is a matrix: light and matrix effects, Plasma and Spiral, but no whole-loop ones.
  assert.ok(laneTakes("solid", EFFECTS.solid, "phones") && laneTakes("plasma", EFFECTS.plasma, "phones"));
  assert.ok(laneTakes("fire2d", EFFECTS.fire2d, "phones") && laneTakes("picture", EFFECTS.picture, "phones"));
  assert.ok(!laneTakes("wled", EFFECTS.wled, "phones") && !laneTakes("sweep", EFFECTS.sweep, "phones"));
  // Phones draw the lane themselves, so the house's own colour comes too.
  assert.deepEqual(colourAt(h.phones.house, 1.5), [0, 255, 0]);
});


test("a phone's screen is the lane drawn as an upright matrix", async () => {
  const { phoneScreen } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const { PHONE_GRID } = await import("../../haliday_show/app/halidayshow/static/js/phones.js");
  const n = PHONE_GRID.w * PHONE_GRID.h;
  const red = phoneScreen([{ ...newClip("solid", 0, 1), color: "#ff0000" }], 0.5);
  assert.equal(red.length, n * 3);
  assert.deepEqual([...red.subarray(0, 3)], [255, 0, 0]);
  assert.deepEqual([...phoneScreen([newClip("housecolour", 0, 1)], 0.5, [1, 2, 200]).subarray(0, 3)], [1, 2, 200]);
  assert.deepEqual([...phoneScreen([{ ...newClip("solid", 0, 1), color: "#ff0000" }], 0.5, null, 0.5).subarray(0, 3)], [128, 0, 0]);
  assert.ok(phoneScreen([], 0.5).every((v) => v === 0)); // dark in the gaps
});
