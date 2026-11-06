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
