import test from "node:test";
import assert from "node:assert/strict";
import { addFolder, deleteFolder, folderNameProblem, folderOf, inFolders, moveSong, renameFolder } from "../../haliday_show/app/halidayshow/static/js/songfolders.js";

const ref = (path) => ({ source: "media", path });
const fam = (path) => ({ original: { key: `media:${path}`, name: path } });

test("songs go into their folders, with the rest left loose", () => {
  const folders = [{ id: "xmas", name: "Christmas", songs: [ref("a"), ref("gone")] }, { id: "aut", name: "Autumn", songs: [ref("b")] }];
  const { groups, loose } = inFolders([fam("a"), fam("b"), fam("c")], folders);
  assert.deepEqual(groups.map((g) => [g.folder.name, g.families.map((f) => f.original.name)]), [["Autumn", ["b"]], ["Christmas", ["a"]]]);
  assert.deepEqual(loose.map((f) => f.original.name), ["c"]);
  assert.equal(folderOf(folders, "media:b"), "aut");
  assert.equal(folderOf(folders, "media:c"), "");
});

test("moving, naming and deleting folders", () => {
  let { folders, id } = addFolder([], "  Christmas  songs ");
  assert.deepEqual(folders, [{ id: "christmas-songs", name: "Christmas songs", songs: [] }]);
  ({ folders } = addFolder(folders, "Christmas songs!"));
  assert.equal(folders[1].id, "christmas-songs-2");
  folders = moveSong(folders, ref("a"), id);
  folders = moveSong(folders, ref("a"), "christmas-songs-2");
  assert.deepEqual(folders.map((f) => f.songs.length), [0, 1]);
  folders = moveSong(folders, ref("a"), "");
  assert.deepEqual(folders.map((f) => f.songs.length), [0, 0]);
  assert.equal(folderNameProblem(folders, "christmas SONGS"), "There's already a folder called christmas SONGS");
  assert.equal(folderNameProblem(folders, "christmas songs", id), "");
  assert.equal(folderNameProblem(folders, "  "), "Give the folder a name");
  assert.equal(renameFolder(folders, id, "Xmas")[0].name, "Xmas");
  assert.deepEqual(deleteFolder(folders, id).map((f) => f.id), ["christmas-songs-2"]);
});

test("samples split into their folders, in name order, and the rest", async () => {
  const { itemsInFolders } = await import("../../haliday_show/app/halidayshow/static/js/songfolders.js");
  const a = { source: "media", path: "haliday_show/Samples/a.wav" }, b = { source: "media", path: "haliday_show/Samples/b.wav" };
  const c = { source: "media", path: "haliday_show/Samples/c.wav" };
  const folders = [{ id: "z", name: "Zebra", songs: [a] }, { id: "v", name: "voices", songs: [b, { source: "media", path: "gone.wav" }] }];
  const { groups, loose } = itemsInFolders([a, b, c], folders);
  assert.deepEqual(groups.map((g) => [g.folder.name, g.items.map((i) => i.path.slice(-5))]), [["voices", ["b.wav"]], ["Zebra", ["a.wav"]]]);
  assert.deepEqual(loose, [c]);
});
