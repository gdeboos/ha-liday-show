// Folders you make in Your songs: just names, each holding songs (by songKey). A song's edits and
// drafts go where it goes. Worked out here, without the page, so it can be tested; app.js draws them.
import { songKey } from "./songlist.js";

// families (from songFamilies) split into the folders, in name order, and those in none. A folder's
// songs that are gone (archived or deleted) are skipped, but stay in it for when they're restored.
export function inFolders(families, folders) {
  const where = new Map();
  for (const f of folders) for (const s of f.songs) if (!where.has(songKey(s))) where.set(songKey(s), f.id);
  const byId = new Map(folders.map((f) => [f.id, { folder: f, families: [] }]));
  const loose = [];
  for (const fam of families) {
    const id = where.get(fam.original.key);
    (id && byId.has(id) ? byId.get(id).families : loose).push(fam);
  }
  const groups = [...byId.values()].sort((a, b) => a.folder.name.localeCompare(b.folder.name, undefined, { sensitivity: "base" }));
  return { groups, loose };
}

export const folderOf = (folders, key) => folders.find((f) => f.songs.some((s) => songKey(s) === key))?.id || "";

// The folders with a song moved into folder `id` ("" for none), out of any other.
export function moveSong(folders, ref, id) {
  const key = songKey(ref);
  return folders.map((f) => {
    const songs = f.songs.filter((s) => songKey(s) !== key);
    if (f.id === id) songs.push({ source: ref.source, path: ref.path });
    return { ...f, songs };
  });
}

const slug = (name) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "folder";

// A new folder's name problem, or "" if it's fine (names must be there and their own).
export function folderNameProblem(folders, name, except = null) {
  const v = name.split(/\s+/).filter(Boolean).join(" ");
  if (!v) return "Give the folder a name";
  if (v.length > 60) return "Keep the name to 60 letters";
  if (folders.some((f) => f.id !== except && f.name.toLowerCase() === v.toLowerCase())) return `There's already a folder called ${v}`;
  return "";
}

export function addFolder(folders, name) {
  const clean = name.split(/\s+/).filter(Boolean).join(" ");
  const ids = new Set(folders.map((f) => f.id));
  let id = slug(clean);
  for (let i = 2; ids.has(id); i++) id = `${slug(clean).slice(0, 36)}-${i}`;
  return { folders: [...folders, { id, name: clean, songs: [] }], id };
}

export const renameFolder = (folders, id, name) =>
  folders.map((f) => (f.id === id ? { ...f, name: name.split(/\s+/).filter(Boolean).join(" ") } : f));

// Deleting a folder leaves its songs where they are, just in no folder.
export const deleteFolder = (folders, id) => folders.filter((f) => f.id !== id);

// Any list of files ({source, path}), such as samples, split into the folders (in name order, each
// with its items) and those in none.
export function itemsInFolders(items, folders) {
  const where = new Map();
  for (const f of folders) for (const s of f.songs) if (!where.has(songKey(s))) where.set(songKey(s), f.id);
  const byId = new Map(folders.map((f) => [f.id, { folder: f, items: [] }]));
  const loose = [];
  for (const it of items) {
    const id = where.get(songKey(it));
    (id && byId.has(id) ? byId.get(id).items : loose).push(it);
  }
  const groups = [...byId.values()].sort((a, b) => a.folder.name.localeCompare(b.folder.name, undefined, { sensitivity: "base" }));
  return { groups, loose };
}
