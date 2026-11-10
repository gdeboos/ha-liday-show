import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, escapeHtml, findItems, folderView, positionNow, swatch, whenText }
  from "../../custom_components/haliday_show/frontend/cardlib.js";

const shows = [{ id: "a", name: "Jingle" }, { id: "b", name: "Spooky" }, { id: "c", name: "Arctic" }, { id: "d", name: "Loose" }];
const folders = [
  { id: "f1", name: "Christmas", items: ["a", "Arctic"] },
  { id: "f2", name: "Halloween", items: ["b"] },
  { id: "f3", name: "Old", items: [], parent: "f1" },
];

test("folders: the top, inside a folder, and nested", () => {
  const top = folderView(shows, folders);
  assert.deepEqual(top.path, []);
  assert.deepEqual(top.folders.map((f) => [f.name, f.count]), [["Christmas", 3], ["Halloween", 1]]);
  assert.deepEqual(top.items.map((i) => i.id), ["d"]);
  const xmas = folderView(shows, folders, "f1");
  assert.deepEqual(xmas.items.map((i) => i.name), ["Arctic", "Jingle"]);  // by id or by name
  assert.deepEqual(xmas.folders.map((f) => f.name), ["Old"]);
  assert.deepEqual(folderView(shows, folders, "f3").path.map((p) => p.name), ["Christmas", "Old"]);
  assert.deepEqual(folderView(shows, folders, "gone").path, []);  // a deleted folder: back to the top
});

test("folders: a loop can't hang the card", () => {
  const loop = [{ id: "x", name: "X", items: [], parent: "y" }, { id: "y", name: "Y", items: [], parent: "x" }];
  assert.ok(folderView([], loop, "x").path.length <= 20);
});

test("find, clock, swatch and escaping", () => {
  assert.deepEqual(findItems(shows, "  ARC ").map((i) => i.id), ["c"]);
  assert.deepEqual(findItems(shows, ""), []);
  assert.equal(clock(187), "3:07");
  assert.equal(clock(3723), "1:02:03");
  assert.equal(swatch(["#ff0000"]), "#ff0000");
  assert.equal(swatch(["#ff0000", "#00ff00"]), "linear-gradient(135deg, #ff0000, #00ff00)");
  assert.equal(swatch(["red; x"]), "var(--secondary-background-color)");
  assert.equal(escapeHtml(`<b a="1">&'`), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;");
});

test("position moves on from the last report, up to the end", () => {
  const at = Date.parse("2026-11-10T20:00:00Z");
  const attrs = { media_position: 10, media_position_updated_at: "2026-11-10T20:00:00Z", media_duration: 30 };
  assert.equal(positionNow(attrs, at + 5000), 15);
  assert.equal(positionNow(attrs, at + 60000), 30);
  assert.equal(positionNow({}, at), 0);
});

test("when the next row starts", () => {
  const now = new Date(2026, 10, 10, 12, 0);
  assert.equal(whenText(new Date(2026, 10, 10, 17, 30).toISOString(), now), "Tonight at 5:30pm");
  assert.equal(whenText(new Date(2026, 10, 11, 9, 0).toISOString(), now), "Tomorrow at 9am");
  assert.equal(whenText(new Date(2026, 10, 14, 16, 0).toISOString(), now), "Sat 14 Nov at 4pm");
  assert.equal(whenText(null, now), "");
});

import { framesByLight, houseDevices } from "../../custom_components/haliday_show/frontend/cardlib.js";
import { fromWire, gridOf } from "../../haliday_show/app/halidayshow/static/js/matrix.js";
import { partGrid, partSize } from "../../haliday_show/app/halidayshow/static/js/parts.js";

test("house view: parts drawn apart only when the trace is split", () => {
  const pillars = { id: "p", name: "Pillars", segments: 300, bulbs: 600,
    parts: [{ id: "l", name: "Left", from: 1, to: 100 }, { id: "r", name: "Right", from: 101, to: 300 }] };
  const m = { gridOf, partSize, partGrid };
  const split = houseDevices([pillars], {}, m);
  assert.deepEqual(split.map((d) => [d.id, d.segments, d.bulbs, d.parent]), [["p#l", 100, 200, "p"], ["p#r", 200, 400, "p"]]);
  assert.deepEqual(houseDevices([pillars], { p: [[0, 0], [1, 1]] }, m).map((d) => d.id), ["p"]);  // traced whole
});

test("house view: a live frame split by light, matrices back in grid order", () => {
  const strip = { id: "s", segments: 2 };
  const grid = { id: "g", segments: 4, matrix: { w: 2, h: 2, start: "top left", order: "rows", zigzag: true } };
  const rgb = Uint8Array.from([1, 1, 1, 2, 2, 2, 10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]);
  const frame = { tracks: [{ device: "s", segments: 2 }, { device: "g", segments: 4 }], rgb: Buffer.from(rgb).toString("base64") };
  const got = framesByLight(frame, [strip, grid], { gridOf, fromWire });
  assert.deepEqual([...got.get("s")], [1, 1, 1, 2, 2, 2]);
  assert.deepEqual([...got.get("g")].filter((_, i) => i % 3 === 0), [10, 20, 40, 30]);  // the zig-zag row turned back
  assert.equal(framesByLight({ rgb: "" }, [], {}).size, 0);
});
