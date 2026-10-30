import test from "node:test";
import assert from "node:assert/strict";
import { browse, holds } from "../../haliday_show/app/halidayshow/static/js/folderbrowse.js";

const folders = [
  { id: "xmas", name: "Christmas", items: ["a"] },
  { id: "old", name: "Old", parent: "xmas", items: ["b"] },
];
const keys = ["a", "b", "c"];
const names = { a: "Jingle Bells", b: "Silent Night", c: "Thriller" };
const nameOf = (k) => names[k];

test("the top shows its folders and what's in no folder", () => {
  const top = browse({ folders, keys, nameOf });
  assert.deepEqual(top.items.map((i) => i.key), ["c"]);
  assert.deepEqual(top.subs.map((s) => [s.folder.id, s.items, s.folders]), [["xmas", 2, 1]]);
  assert.deepEqual(top.trail, []);
});

test("inside a folder, the path down to it", () => {
  const inner = browse({ folders, keys, at: "old", nameOf });
  assert.deepEqual(inner.trail.map((f) => f.name), ["Christmas", "Old"]);
  assert.deepEqual(inner.items.map((i) => i.key), ["b"]);
  assert.equal(browse({ folders, keys, at: "gone", nameOf }).at, "");
});

test("finding looks in every folder and says where each is", () => {
  const found = browse({ folders, keys, at: "xmas", find: "night", nameOf });
  assert.equal(found.finding, true);
  assert.deepEqual(found.items, [{ key: "b", where: "Christmas › Old" }]);
  assert.deepEqual(found.subs, []);
});

test("what a folder holds", () => {
  assert.equal(holds({ items: 3, folders: 1 }, "show"), "3 shows · 1 folder");
  assert.equal(holds({ items: 1, folders: 0 }, "show"), "1 show");
  assert.equal(holds({ items: 0, folders: 0 }, "show"), "Empty");
});
