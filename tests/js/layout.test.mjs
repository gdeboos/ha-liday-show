import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const { loadLayout, PHONE_FOLDED } = await import("../../haliday_show/app/halidayshow/static/js/layout.js");

test("on a phone, Preview and House start folded", () => {
  store.clear();
  assert.deepEqual(loadLayout(true).collapsed, PHONE_FOLDED);
  assert.deepEqual(loadLayout(false).collapsed, []);
});

test("once panels have been folded or unfolded, a phone keeps that", () => {
  store.set("halidayshow.layout", JSON.stringify({ place: { inspector: "left" }, collapsed: [] }));
  assert.deepEqual(loadLayout(true).collapsed, []);
  store.set("halidayshow.layout", JSON.stringify({ place: { inspector: "left" }, collapsed: ["song"] }));
  assert.deepEqual(loadLayout(true).collapsed, ["song"]);
});

test("the Music and Playlist editors keep their own layouts", async () => {
  const { EDITORS } = await import("../../haliday_show/app/halidayshow/static/js/layout.js");
  store.clear();
  store.set("halidayshow.layout", JSON.stringify({ place: { inspector: "left" }, frame: "columns" }));
  const music = loadLayout(false, EDITORS.music);
  assert.equal(music.place.selection, "right");
  assert.equal(music.frame, "classic");
  assert.deepEqual(music.order, EDITORS.music.order);
  store.set("halidayshow.layout.playlist", JSON.stringify({ place: { shows: "right", order: "hidden", nope: "top" } }));
  const pl = loadLayout(false, EDITORS.playlist);
  assert.equal(pl.place.shows, "right");
  assert.equal(pl.place.order, "middle", "the running order can't be hidden");
  assert.ok(!("nope" in pl.place));
  assert.equal(loadLayout(false).place.inspector, "left");
});

test("on a phone, the Music editor's Splice and Smoothing and the Playlist editor's blocks start folded", async () => {
  const { EDITORS } = await import("../../haliday_show/app/halidayshow/static/js/layout.js");
  store.clear();
  assert.deepEqual(loadLayout(true, EDITORS.music).collapsed, ["splice", "smoothing"]);
  assert.deepEqual(loadLayout(true, EDITORS.playlist).collapsed, ["blocks"]);
  for (const spec of Object.values(EDITORS)) {
    assert.deepEqual(Object.keys(spec.place).sort(), Object.keys(spec.panels).sort());
    assert.deepEqual([...spec.order].sort(), Object.keys(spec.panels).sort());
  }
});
