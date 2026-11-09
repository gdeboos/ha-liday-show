import test from "node:test";
import assert from "node:assert/strict";
import { pickerView } from "../../haliday_show/app/halidayshow/static/js/folders.js";

const folders = [
  { id: "xmas", name: "Christmas", items: ["c1", "c2"] },
  { id: "old", name: "Old", parent: "xmas", items: ["c3"] },
  { id: "aut", name: "Autumn", items: ["a1"] },
];
const items = [{ key: "a1", name: "Autumn 1" }, { key: "c1", name: "Christmas" }, { key: "c2", name: "Christmas 2" },
  { key: "c3", name: "Old tree" }, { key: "w", name: "Warm Glitter" }];

test("the top lists its folders, with what's inside however deep, then loose items", () => {
  const v = pickerView(folders, items);
  assert.deepEqual(v.path, []);
  assert.deepEqual(v.folders.map((f) => [f.folder.name, f.count]), [["Autumn", 1], ["Christmas", 3]]);
  assert.deepEqual(v.items.map((i) => i.key), ["w"]);
});

test("inside a folder: the path, its subfolders, its own items", () => {
  const v = pickerView(folders, items, "xmas");
  assert.deepEqual(v.path.map((f) => f.name), ["Christmas"]);
  assert.deepEqual(v.folders.map((f) => f.folder.name), ["Old"]);
  assert.deepEqual(v.items.map((i) => i.key), ["c1", "c2"]);
  assert.deepEqual(pickerView(folders, items, "gone").path, []);
});

test("finding searches every folder and says where each is", () => {
  const v = pickerView(folders, items, "aut", "christmas");
  assert.deepEqual(v.items.map((i) => [i.name, i.where]), [["Christmas", "Christmas"], ["Christmas 2", "Christmas"]]);
  assert.deepEqual(pickerView(folders, items, "", "old").items[0].where, "Christmas › Old");
});
