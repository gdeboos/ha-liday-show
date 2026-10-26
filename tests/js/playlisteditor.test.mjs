import { test } from "node:test";
import assert from "node:assert/strict";
import { moved, inserted, dropIndex, strip, summary, playlistRows } from "../../haliday_show/app/halidayshow/static/js/playlisteditor.js";

test("moving a show lands it before the card it was dropped on", () => {
  const l = ["a", "b", "c", "d"];
  assert.deepEqual(moved(l, 0, 2), ["b", "a", "c", "d"]); // dropped above c
  assert.deepEqual(moved(l, 0, 4), ["b", "c", "d", "a"]); // dropped below the last
  assert.deepEqual(moved(l, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moved(l, 1, 1), l); // dropped where it was
  assert.deepEqual(moved(l, 1, 2), l); // just below itself is where it was too
  assert.deepEqual(moved(l, 9, 0), l);
  assert.deepEqual(l, ["a", "b", "c", "d"]); // not changed
});

test("a show can be in a playlist more than once, and moving one copy moves only that", () => {
  assert.deepEqual(moved(["a", "b", "a"], 2, 0), ["a", "a", "b"]);
});

test("adding puts a show where it's dropped, but not past the limit", () => {
  assert.deepEqual(inserted(["a", "b"], "x", 1), ["a", "x", "b"]);
  assert.deepEqual(inserted(["a", "b"], "x"), ["a", "b", "x"]);
  assert.deepEqual(inserted(["a", "b"], "x", 99), ["a", "b", "x"]);
  assert.deepEqual(inserted(["a", "b"], "x", 0, 2), ["a", "b"]);
});

test("a drop lands before the first card whose middle is below it", () => {
  assert.equal(dropIndex([10, 30, 50], 5), 0);
  assert.equal(dropIndex([10, 30, 50], 20), 1);
  assert.equal(dropIndex([10, 30, 50], 60), 3);
  assert.equal(dropIndex([], 60), 0);
});

const byId = {
  a: { id: "a", name: "A", duration: 60, baked: true },
  b: { id: "b", name: "B", duration: 120, baked: true },
  u: { id: "u", name: "Unsaved", duration: 30, baked: false },
};

test("the strip leaves out shows that won't play, with the pause after each", () => {
  const s = strip(["a", "u", "b", "gone"], byId, 10);
  assert.equal(s.seconds, 60 + 10 + 120 + 10);
  assert.equal(s.playing, 2);
  assert.deepEqual(s.blocks.map((b) => [b.id, b.k]), [["a", 0], ["b", 2]]);
  assert.equal(s.blocks[0].start, 0);
  assert.ok(Math.abs(s.blocks[1].start - 70 / 200) < 1e-9);
  assert.ok(Math.abs(s.blocks[1].width - 120 / 200) < 1e-9);
  assert.deepEqual(strip([], byId, 5), { seconds: 0, playing: 0, blocks: [] });
});

test("the summary says how long one time round takes", () => {
  assert.equal(summary(["a", "b"], byId, 5), "2 shows · 3:10 each time round");
  assert.equal(summary(["a", "u"], byId, 0), "2 shows · 1:00 each time round · 1 skipped");
  assert.equal(summary(["u"], byId, 0), "1 show, none saved yet, so nothing plays");
  assert.equal(summary([], byId, 0), "No shows yet");
});

test("each playlist row says what's in it and when it plays", () => {
  const rows = playlistRows([
    { id: "p1", name: "Xmas", shows: ["a"], gap: 0 },
    { id: "p2", name: "Night", shows: ["u"], gap: 5, schedule: { on: true, start: "17:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6], from: "", to: "" } },
  ], Object.values(byId));
  assert.deepEqual(rows.map((r) => r.playable), [true, false]);
  assert.equal(rows[0].details, "1 show · 1:00 each time round · plays when you press Play");
  assert.match(rows[1].details, /plays 17:00 to 22:00 every day$/);
});
