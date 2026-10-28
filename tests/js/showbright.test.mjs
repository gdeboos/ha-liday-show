import assert from "node:assert/strict";
import test from "node:test";

import { HOUSE, bake, dim, newClip, showLevel } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import { lightLevel, lightsInShow, setLightLevel, setWholeLevel, wholeLevel } from "../../haliday_show/app/halidayshow/static/js/showbright.js";

const frame0 = (blob) => {
  const hlen = new DataView(blob.buffer).getUint32(5);
  return [...blob.subarray(9 + hlen, 9 + hlen + 6)];
};

test("an old show with no brightness plays at full strength", () => {
  assert.equal(showLevel({}, "a"), 1);
  assert.equal(showLevel(undefined, "a"), 1);
  assert.equal(showLevel({ brightness: "odd" }, "a"), 1);
});

test("whole-show and per-light levels multiply", () => {
  const show = { brightness: 50, lightBrightness: { a: 50 } };
  assert.equal(showLevel(show, "a"), 0.25);
  assert.equal(showLevel(show, "b"), 0.5);
});

test("bake dims each light by the show's levels", () => {
  const show = { duration: 1, brightness: 50, lightBrightness: { b: 50 }, tracks: [
    { device: "a", clips: [{ ...newClip("solid", 0, 1), color: "#ff8000", brightness: 100 }] },
    { device: "b", clips: [{ ...newClip("solid", 0, 1), color: "#ff8000", brightness: 100 }] },
  ] };
  const blob = bake(show, { a: { segments: 1 }, b: { segments: 1 } }, 10);
  assert.deepEqual(frame0(blob), [128, 64, 0, 64, 32, 0]);
});

test("a light's level covers its parts' tracks too", () => {
  const show = { duration: 1, lightBrightness: { tree: 50 }, tracks: [
    { device: "tree#p1", clips: [{ ...newClip("solid", 0, 1), color: "#ffffff", brightness: 100 }] },
  ] };
  const tree = { id: "tree", segments: 2, parts: [{ id: "p1", from: 1, to: 2 }] };
  const devices = { tree, "tree#p1": { parent: "tree", segments: 2, from: 1, to: 2 } };
  const blob = bake(show, devices, 10);
  assert.deepEqual(frame0(blob), [128, 128, 128, 128, 128, 128]);
});

test("dim leaves a frame alone at full level", () => {
  const rgb = new Uint8Array([10, 20, 30]);
  assert.equal(dim(rgb, 1), rgb);
  assert.deepEqual([...rgb], [10, 20, 30]);
});

test("lightsInShow lists each physical light once, parts folded into their light", () => {
  const show = { tracks: [{ device: HOUSE }, { device: "tree#p1" }, { device: "roof" }, { device: "tree" }, { device: "gone" }] };
  const devices = { tree: {}, "tree#p1": { parent: "tree" }, roof: {} };
  assert.deepEqual(lightsInShow(show, devices), ["tree", "roof"]);
});

test("levels at 100 are left out, so an undimmed show saves as before", () => {
  const show = {};
  setWholeLevel(show, 70);
  setLightLevel(show, "a", "40");
  assert.deepEqual(show, { brightness: 70, lightBrightness: { a: 40 } });
  assert.equal(wholeLevel(show), 70);
  assert.equal(lightLevel(show, "a"), 40);
  assert.equal(lightLevel(show, "b"), 100);
  setWholeLevel(show, 100);
  setLightLevel(show, "a", 100);
  assert.deepEqual(show, {});
  setWholeLevel(show, 0); // the slider stops at 1%, so a show is never saved fully dark
  assert.equal(show.brightness, 1);
});
