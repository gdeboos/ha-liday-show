import assert from "node:assert/strict";
import test from "node:test";

import { applyHouse, newClip, renderTrack } from "../../haliday_show/app/halidayshow/static/js/effects.js";

const N = 200;
const red = (extra = {}) => ({ ...newClip("solid", 0, 10), color: "#ff0000", ...extra });
const lit = (frame) => [...Array(N).keys()].filter((i) => frame[i * 3 + 1] > 0); // green only comes from glitter

test("without glitter a clip looks exactly as before", () => {
  const plain = renderTrack([red()], 2.5, N);
  assert.deepEqual(renderTrack([red({ glitter: 0 })], 2.5, N), plain);
  assert.equal(lit(plain).length, 0);
});

test("glitter sparkles some lights white over the effect, the same every time", () => {
  const a = renderTrack([red({ glitter: 60 })], 2.5, N);
  const b = renderTrack([red({ glitter: 60 })], 2.5, N);
  assert.deepEqual(a, b); // preview and bake match
  const n = lit(a).length;
  assert.ok(n > 5 && n < N / 2, `${n} sparkles`);
  assert.ok(lit(a).every((i) => a[i * 3] >= a[i * 3 + 1])); // white over red stays at least as red
  assert.ok([...Array(N).keys()].filter((i) => !lit(a).includes(i)).every((i) => a[i * 3] === 255));
});

test("more glitter means more sparkles, and they move", () => {
  const few = lit(renderTrack([red({ glitter: 20 })], 2.5, N)).length;
  const many = lit(renderTrack([red({ glitter: 100 })], 2.5, N)).length;
  assert.ok(many > few * 2, `${few} then ${many}`);
  assert.notDeepEqual(lit(renderTrack([red({ glitter: 60 })], 2.5, N)), lit(renderTrack([red({ glitter: 60 })], 4.1, N)));
});

test("glitter takes its colour and the clip's brightness", () => {
  const gold = renderTrack([red({ glitter: 100, glitterColor: "#00ff00" })], 2.5, N);
  const i = lit(gold)[0];
  assert.ok(gold[i * 3 + 2] === 0); // green glitter adds no blue
  const dim = renderTrack([red({ glitter: 100, brightness: 50 })], 2.5, N);
  assert.ok(Math.max(...lit(dim).map((j) => dim[j * 3 + 1])) <= 128);
});

test("a moved clip sparkles the same way, as the glitter keeps the clip's own time", () => {
  const here = renderTrack([red({ glitter: 60 })], 2.5, N);
  const later = renderTrack([{ ...red({ glitter: 60 }), start: 5, end: 15 }], 7.5, N);
  assert.deepEqual(here, later);
});

test("House lane clips can glitter too", () => {
  const pos = [...Array(N).keys()].map((i) => [i / N, 0.5]);
  const clip = { ...newClip("housewipe", 0, 10), glitter: 100 };
  const out = applyHouse([clip], 9.9, pos, new Uint8Array(N * 3));
  const plain = applyHouse([{ ...clip, glitter: 0 }], 9.9, pos, new Uint8Array(N * 3));
  assert.notDeepEqual(out, plain);
});

test("a scene light keeps its glitter when its effect changes", async () => {
  const { changeEffect, clipFor } = await import("../../haliday_show/app/halidayshow/static/js/housescenes.js");
  const look = { effect: "solid", params: { color: "#ff0000", glitter: 40 } };
  assert.equal(changeEffect(look, "twinkle").params.glitter, 40);
  assert.equal(clipFor(look, 0, 1).glitter, 40); // and the bake sees it
});
