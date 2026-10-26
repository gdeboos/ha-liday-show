import assert from "node:assert/strict";
import test from "node:test";

import { clampVolume, createVolume, gainFor, loadVolume, saveVolume } from "../../haliday_show/app/halidayshow/static/js/volume.js";

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test("clamps to 0–100 and falls back to full for junk", () => {
  assert.equal(clampVolume(-5), 0);
  assert.equal(clampVolume(150), 100);
  assert.equal(clampVolume("42.4"), 42);
  assert.equal(clampVolume("loud"), 100);
});

test("gain follows a squared curve from silent to full", () => {
  assert.equal(gainFor(0), 0);
  assert.equal(gainFor(100), 1);
  assert.equal(gainFor(50), 0.25);
});

test("remembers the level and survives broken storage", () => {
  const s = memory();
  assert.equal(loadVolume(s), 100);
  saveVolume(30, s);
  assert.equal(loadVolume(s), 30);
  const broken = { getItem() { throw new Error("nope"); }, setItem() { throw new Error("nope"); } };
  assert.equal(loadVolume(broken), 100);
  assert.doesNotThrow(() => saveVolume(10, broken));
  assert.equal(loadVolume(undefined), 100);
});

test("moving one slider updates the other and every output", () => {
  const s = memory();
  const slider = () => {
    const handlers = {};
    return { value: "", addEventListener: (t, f) => (handlers[t] = f), fire: (t) => handlers[t]() };
  };
  const a = slider(), b = slider();
  const gains = { a: null, b: null };
  const vol = createVolume(s);
  vol.bind(a, (g) => (gains.a = g));
  vol.bind(b, (g) => (gains.b = g));
  assert.equal(a.value, "100");
  assert.equal(gains.b, 1);
  a.value = "50";
  a.fire("input");
  assert.equal(b.value, "50");
  assert.deepEqual(gains, { a: 0.25, b: 0.25 });
  assert.equal(loadVolume(s), 100, "saved only when the drag ends");
  a.fire("change");
  assert.equal(loadVolume(s), 50);
  assert.equal(createVolume(s).level, 50);
});
