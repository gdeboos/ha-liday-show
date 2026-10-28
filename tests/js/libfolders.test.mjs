import assert from "node:assert/strict";
import test from "node:test";

import { addLibraryFolder, deleteLibraryFolder, folderOfItem, groupByFolder, moveItem, renameItem, renameLibraryFolder }
  from "../../haliday_show/app/halidayshow/static/js/libfolders.js";

test("library folders hold items by key, and moving, renaming and deleting keep things tidy", () => {
  let { folders, id: xmas } = addLibraryFolder([], "  Christmas   shows ");
  assert.equal(folders[0].name, "Christmas shows");
  ({ folders } = addLibraryFolder(folders, "Christmas shows!"));
  assert.notEqual(folders[1].id, folders[0].id);
  folders = moveItem(folders, "show-a", xmas);
  folders = moveItem(folders, "show-a", folders[1].id); // one folder at most
  assert.equal(folderOfItem(folders, "show-a"), folders[1].id);
  assert.deepEqual(folders[0].items, []);
  folders = moveItem(folders, "show-a", "");
  assert.equal(folderOfItem(folders, "show-a"), "");
  folders = moveItem(renameItem(moveItem(folders, "Ice", xmas), "Ice", "Icy"), "x", xmas);
  assert.deepEqual(folders[0].items, ["Icy", "x"]);
  assert.equal(renameLibraryFolder(folders, xmas, "Xmas")[0].name, "Xmas");
  const { groups, loose } = groupByFolder(["x", "y", "Icy", "gone?"].slice(0, 3), folders);
  assert.deepEqual(groups.find((g) => g.folder.id === xmas).keys, ["x", "Icy"]);
  assert.deepEqual(loose, ["y"]);
  assert.equal(deleteLibraryFolder(folders, xmas).length, 1);
});
