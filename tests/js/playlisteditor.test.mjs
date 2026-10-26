import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_EFFECTS, bakeKey, blockLabel, blockShow, dropIndex, fits, inserted, itemsOf, loopLength, moved, newBlock,
  playlistRows, seconds, strip, summary,
} from "../../haliday_show/app/halidayshow/static/js/playlisteditor.js";
import { bake, EFFECTS } from "../../haliday_show/app/halidayshow/static/js/effects.js";

const show = (id) => ({ type: "show", id });

test("moving a card lands it before the card it was dropped on", () => {
  const l = ["a", "b", "c", "d"];
  assert.deepEqual(moved(l, 0, 2), ["b", "a", "c", "d"]); // dropped above c
  assert.deepEqual(moved(l, 0, 4), ["b", "c", "d", "a"]); // dropped below the last
  assert.deepEqual(moved(l, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moved(l, 1, 1), l); // dropped where it was
  assert.deepEqual(moved(l, 1, 2), l); // just below itself is where it was too
  assert.deepEqual(moved(l, 9, 0), l);
  assert.deepEqual(l, ["a", "b", "c", "d"]); // not changed
});

test("adding puts a card where it's dropped, but not past the limits", () => {
  assert.deepEqual(inserted([show("a"), show("b")], show("x"), 1).map((x) => x.id), ["a", "x", "b"]);
  assert.deepEqual(inserted([show("a")], show("x")).map((x) => x.id), ["a", "x"]);
  const hundred = Array.from({ length: 100 }, (_, k) => show(`s${k}`));
  assert.equal(fits(hundred, show("x")), false); // 100 shows at most
  assert.equal(fits(hundred, newBlock("off")), true); // but blocks still fit
  assert.equal(inserted(hundred, show("x")).length, 100);
  const full = Array.from({ length: 200 }, () => newBlock("pause"));
  assert.equal(fits(full, newBlock("off")), false);
});

test("a drop lands before the first card whose middle is below it", () => {
  assert.equal(dropIndex([10, 30, 50], 5), 0);
  assert.equal(dropIndex([10, 30, 50], 20), 1);
  assert.equal(dropIndex([10, 30, 50], 60), 3);
  assert.equal(dropIndex([], 60), 0);
});

test("a playlist from before blocks reads as each show and its pause", () => {
  assert.deepEqual(itemsOf({ shows: ["a", "b"], gap: 5 }), [show("a"), { type: "pause", id: "pause-1", seconds: 5 },
    show("b"), { type: "pause", id: "pause-2", seconds: 5 }]);
  assert.deepEqual(itemsOf({ shows: ["a"], gap: 0 }), [show("a")]);
  const items = [show("a")];
  assert.equal(itemsOf({ shows: ["x"], gap: 5, items }), items);
});

test("new blocks have their own ids and sensible starting settings", () => {
  const a = newBlock("colour", 1), b = newBlock("colour", 1);
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^colour-[0-9a-z]+-[0-9a-z]+$/); // what playlists.py accepts as an id
  assert.deepEqual([a.seconds, a.colour], [10, "#ff0000"]);
  const e = newBlock("effect");
  assert.equal(e.effect, "twinkle");
  assert.equal(e.params.density, 30);
  assert.ok(BLOCK_EFFECTS.includes("rainbow") && !BLOCK_EFFECTS.includes("fade") && !BLOCK_EFFECTS.includes("scene"));
  assert.ok(BLOCK_EFFECTS.every((k) => !EFFECTS[k].house));
});

test("blocks are labelled with what they do and for how long", () => {
  assert.equal(blockLabel({ type: "pause", seconds: 5 }), "Pause · 5 s");
  assert.equal(blockLabel({ type: "off", seconds: 90 }), "Off · 1 min 30 s");
  assert.equal(blockLabel({ type: "effect", effect: "rainbow", seconds: 120 }), "Effect: Rainbow · 2 min");
  assert.equal(seconds(2.25), "2.3 s");
});

const byId = {
  a: { id: "a", name: "A", duration: 60, baked: true },
  b: { id: "b", name: "B", duration: 120, baked: true },
  u: { id: "u", name: "Unsaved", duration: 30, baked: false },
};

test("the strip shows every show and block for as long as each plays", () => {
  const items = [show("a"), { type: "colour", id: "c", seconds: 20, colour: "#00ff00" }, show("u"), show("b"), show("gone")];
  const s = strip(items, byId);
  assert.equal(s.seconds, 60 + 20 + 120);
  assert.equal(s.playing, 2);
  assert.deepEqual(s.blocks.map((b) => [b.type, b.k]), [["show", 0], ["colour", 1], ["show", 3]]);
  assert.equal(s.blocks[1].colour, "#00ff00");
  assert.ok(Math.abs(s.blocks[2].start - 80 / 200) < 1e-9);
  assert.deepEqual(strip([], byId), { seconds: 0, playing: 0, blocks: [] });
});

test("the summary says how long one time round takes", () => {
  assert.equal(summary([show("a"), { type: "pause", id: "p", seconds: 5 }, show("b")], byId), "2 shows, 1 block · 3:05 each time round");
  assert.equal(summary([show("a"), show("u")], byId), "2 shows · 1:00 each time round · 1 show skipped");
  assert.equal(summary([show("u")], byId), "1 show, no show saved yet, so nothing plays");
  assert.equal(summary([newBlock("off")], byId), "No shows yet: add one to play");
  assert.equal(summary([], byId), "No shows yet");
});

test("each playlist row says what's in it and when it plays", () => {
  const rows = playlistRows([
    { id: "p1", name: "Xmas", shows: ["a"], gap: 0 },
    { id: "p2", name: "Night", items: [show("u")], schedule: { on: true, start: "17:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6], from: "", to: "" } },
  ], Object.values(byId));
  assert.deepEqual(rows.map((r) => r.playable), [true, false]);
  assert.equal(rows[0].details, "1 show · 1:00 each time round · plays when you press Play");
  assert.match(rows[1].details, /plays 17:00 to 22:00 every day$/);
});

const lights = [{ id: "roof", segments: 2 },
  { id: "pillars", segments: 4, parts: [{ id: "l", from: 1, to: 2 }, { id: "r", from: 3, to: 4 }] },
  { id: "tree", segments: 2, whole: false, parts: [{ id: "t", from: 1, to: 2 }] }];

test("a block bakes as one clip on every light", () => {
  const off = blockShow({ type: "off" }, lights, 1);
  assert.deepEqual(off.tracks.map((t) => t.device), ["roof", "pillars", "tree#t"]);
  assert.equal(off.tracks[0].clips[0].color, "#000000");
  assert.equal(blockShow({ type: "colour", colour: "#123456" }, lights, 1).tracks[0].clips[0].color, "#123456");
  const fx = blockShow({ type: "effect", effect: "pulse", params: { rate: 2 } }, lights, 30).tracks[0].clips[0];
  assert.deepEqual([fx.effect, fx.rate, fx.end, fx.background], ["pulse", 2, 30, "#000000"]);
  // And bakes through effects.js like a show.
  const devices = { roof: lights[0], pillars: { ...lights[1], light: lights[1] }, "tree#t": { id: "tree#t", parent: "tree", segments: 2 }, tree: lights[2] };
  const blob = bake(blockShow({ type: "colour", colour: "#ff0000" }, lights, 1), devices, 10);
  assert.ok(blob.byteLength > 10 * 3 * (2 + 4 + 2));
});

test("a long effect goes round where it looks most like the start", () => {
  // A pulse once every 7 seconds looks the same again at 56 s (8 times round).
  const look = (t) => [Math.round(127 * (1 + Math.cos((2 * Math.PI * t) / 7)))];
  assert.equal(loopLength({ type: "effect", seconds: 600 }, 10, look), 56);
  assert.equal(loopLength({ type: "effect", seconds: 20 }, 10, look), 20); // short: baked whole
  assert.equal(loopLength({ type: "colour", seconds: 600 }, 10, look), 1); // still: one second
});

test("a block's frames need baking again only when what they show changes", () => {
  const b = { type: "colour", id: "c", seconds: 10, colour: "#ff0000" };
  assert.equal(bakeKey(b, "L"), bakeKey({ ...b, seconds: 99 }, "L"));
  assert.notEqual(bakeKey(b, "L"), bakeKey({ ...b, colour: "#00ff00" }, "L"));
  assert.notEqual(bakeKey(b, "L"), bakeKey(b, "M")); // lights changed
  const e = { type: "effect", id: "e", seconds: 20, effect: "pulse", params: {} };
  assert.notEqual(bakeKey(e, "L"), bakeKey({ ...e, seconds: 30 }, "L"));
  assert.equal(bakeKey({ ...e, seconds: 120 }, "L"), bakeKey({ ...e, seconds: 600 }, "L"));
});
