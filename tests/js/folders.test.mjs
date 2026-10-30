import test from "node:test";
import assert from "node:assert/strict";
import {
  addFolder, childrenOf, countIn, deleteFolder, flatTree, folderOf, fromSongFolders, itemsIn, moveFolder, moveItems,
  moveProblem, nameProblem, pathText, pathTo, refOfKey, renameFolder, toSongFolders, within,
} from "../../haliday_show/app/halidayshow/static/js/folders.js";

const tree = [
  { id: "rock", name: "Rock", items: ["a"] },
  { id: "am", name: "Arctic Monkeys", parent: "rock", items: ["b", "c"] },
  { id: "xmas", name: "Christmas", items: [] },
  { id: "lost", name: "Lost", parent: "gone", items: ["d"] },
];

test("folders in a place, by name, and the path down to one", () => {
  assert.deepEqual(childrenOf(tree).map((f) => f.id), ["xmas", "lost", "rock"]);
  assert.deepEqual(childrenOf(tree, "rock").map((f) => f.id), ["am"]);
  assert.deepEqual(pathTo(tree, "am").map((f) => f.name), ["Rock", "Arctic Monkeys"]);
  assert.deepEqual(pathTo(tree, ""), []);
  assert.equal(pathText(tree, "c"), "Rock › Arctic Monkeys");
  assert.equal(pathText(tree, "z"), "");
  assert.deepEqual([...within(tree, "rock")], ["rock", "am"]);
  assert.deepEqual(flatTree(tree).map(({ folder, depth }) => `${depth}${folder.id}`), ["0xmas", "0lost", "0rock", "1am"]);
});

test("items in a place, and counts however deep", () => {
  const keys = ["a", "b", "c", "e"];
  assert.equal(folderOf(tree, "b"), "am");
  assert.deepEqual(itemsIn(keys, tree, ""), ["e"]);
  assert.deepEqual(itemsIn(keys, tree, "rock"), ["a"]);
  assert.deepEqual(countIn(tree, "rock", keys), { folders: 1, items: 3 });
});

test("names only clash with folders beside them", () => {
  assert.equal(nameProblem(tree, "arctic monkeys", "rock"), "There's already a folder called arctic monkeys here");
  assert.equal(nameProblem(tree, "Arctic Monkeys", ""), "");
  assert.equal(nameProblem(tree, "  "), "Give the folder a name");
  const { folders, id } = addFolder(tree, " New  one ", "rock");
  assert.deepEqual(folders.at(-1), { id: "new-one", name: "New one", items: [], parent: "rock" });
  assert.equal(id, "new-one");
  assert.equal(renameFolder(tree, "xmas", "Xmas").find((f) => f.id === "xmas").name, "Xmas");
});

test("moving items and folders, never a folder into itself", () => {
  assert.deepEqual(moveItems(tree, ["b"], "xmas").find((f) => f.id === "xmas").items, ["b"]);
  assert.deepEqual(moveItems(tree, ["a"], "").find((f) => f.id === "rock").items, []);
  assert.equal(moveProblem(tree, "rock", "am"), "A folder can't go inside itself");
  assert.equal(moveProblem(tree, "am", ""), "");
  assert.deepEqual(moveFolder(tree, "am", "").find((f) => f.id === "am"), { id: "am", name: "Arctic Monkeys", items: ["b", "c"] });
  assert.equal(moveFolder(tree, "xmas", "rock").find((f) => f.id === "xmas").parent, "rock");
  const deep = Array.from({ length: 8 }, (_, k) => ({ id: `d${k}`, name: "D", items: [], ...(k ? { parent: `d${k - 1}` } : {}) }));
  assert.equal(moveProblem([...deep, { id: "x", name: "X", items: [] }], "x", "d7"), "Folders go at most 8 deep");
});

test("deleting a folder moves what's in it up a level", () => {
  const out = deleteFolder(tree, "rock");
  assert.equal(out.find((f) => f.id === "am").parent, undefined);
  assert.equal(out.some((f) => f.id === "rock"), false);
  const nested = deleteFolder([...tree, { id: "inner", name: "Inner", parent: "am", items: ["x"] }], "am");
  assert.equal(nested.find((f) => f.id === "inner").parent, "rock");
  assert.deepEqual(nested.find((f) => f.id === "rock").items, ["a", "b", "c"]);
  const clash = deleteFolder([{ id: "p", name: "P", items: [] }, { id: "q", name: "Q", parent: "p", items: [] }, { id: "q2", name: "Q", items: [] }], "p");
  assert.equal(clash.find((f) => f.id === "q").name, "Q (2)");
});

test("song folders turn into keys and back", () => {
  const saved = [{ id: "r", name: "R", parent: "x", songs: [{ source: "media", path: "a:b.mp3" }] }];
  const keyed = fromSongFolders(saved);
  assert.deepEqual(keyed, [{ id: "r", name: "R", parent: "x", items: ["media:a:b.mp3"] }]);
  assert.deepEqual(toSongFolders(keyed), saved);
  assert.deepEqual(refOfKey("media:x/y.mp3"), { source: "media", path: "x/y.mp3" });
});
