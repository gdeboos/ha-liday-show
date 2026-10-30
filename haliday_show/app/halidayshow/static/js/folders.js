// Folders you go into, in every Library list: [{id, name, parent?, items: [key]}]. A folder with no
// parent is at the top; items are the keys of what's in it (a show's id, a song's "media:path"…).
// Nothing moves on disk. Worked out here, without the page, so it can be tested; folderview.js draws.

export const MAX_DEPTH = 8;
const tidy = (name) => name.split(/\s+/).filter(Boolean).join(" ");
const slug = (name) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "folder";
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
const parentOf = (f) => f.parent || "";

// The folders in a place ("" for the top), by name. A folder whose parent has gone counts as top-level.
export function childrenOf(folders, at = "") {
  const ids = new Set(folders.map((f) => f.id));
  return folders.filter((f) => (ids.has(parentOf(f)) ? parentOf(f) : "") === at).sort(byName);
}

// From the top down to the folder: [top folder, …, the folder]; [] for the top itself.
export function pathTo(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = [];
  for (let f = byId.get(id); f && out.length <= MAX_DEPTH; f = byId.get(parentOf(f))) out.unshift(f);
  return out;
}

// The folder and every folder inside it, however deep.
export function within(folders, id) {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of folders) if (!out.has(f.id) && out.has(parentOf(f))) { out.add(f.id); grew = true; }
  }
  return out;
}

// How many levels a folder's own subfolders go down (0 for none).
const height = (folders, id) => Math.max(0, ...childrenOf(folders, id).map((c) => 1 + height(folders, c.id)));

// Which folder an item is in ("" for none, or for a folder that's gone).
export function folderOf(folders, key) {
  return folders.find((f) => f.items.includes(key))?.id || "";
}

// Items that are in a place: in folder `at`, or ("") in none.
export function itemsIn(keys, folders, at = "") {
  return keys.filter((k) => folderOf(folders, k) === at);
}

// What a folder holds, however deep: {folders, items} counts, among the keys listed.
export function countIn(folders, id, keys) {
  const inside = within(folders, id), listed = new Set(keys);
  let items = 0;
  for (const f of folders) if (inside.has(f.id)) for (const k of f.items) if (listed.has(k)) items++;
  return { folders: inside.size - 1, items };
}

// A name's problem in a place, or "" (names differ from the other folders beside them).
export function nameProblem(folders, name, at = "", except = null) {
  const v = tidy(name);
  if (!v) return "Give the folder a name";
  if (v.length > 60) return "Keep the name to 60 letters";
  if (childrenOf(folders, at).some((f) => f.id !== except && f.name.toLowerCase() === v.toLowerCase())) {
    return `There's already a folder called ${v} here`;
  }
  return "";
}

export function addFolder(folders, name, at = "") {
  const clean = tidy(name);
  const ids = new Set(folders.map((f) => f.id));
  let id = slug(clean);
  for (let i = 2; ids.has(id); i++) id = `${slug(clean).slice(0, 36)}-${i}`;
  const f = { id, name: clean, items: [] };
  if (at) f.parent = at;
  return { folders: [...folders, f], id };
}

export const renameFolder = (folders, id, name) => folders.map((f) => (f.id === id ? { ...f, name: tidy(name) } : f));

// Moves items into folder `to` ("" for none), out of wherever they were.
export function moveItems(folders, keys, to) {
  const moving = new Set(keys);
  return folders.map((f) => ({ ...f, items: [...f.items.filter((k) => !moving.has(k)), ...(f.id === to ? keys : [])] }));
}

// Whether folder `id` can go into `to`: not into itself or anything inside it, not too deep, and not
// beside a folder of the same name.
export function moveProblem(folders, id, to) {
  if (to && within(folders, id).has(to)) return "A folder can't go inside itself";
  if (pathTo(folders, to).length + 1 + height(folders, id) > MAX_DEPTH) return `Folders go at most ${MAX_DEPTH} deep`;
  const f = folders.find((x) => x.id === id);
  return f ? nameProblem(folders, f.name, to, id) : "That folder has gone";
}

export function moveFolder(folders, id, to) {
  return folders.map((f) => {
    if (f.id !== id) return f;
    const { parent, ...rest } = f;
    return to ? { ...rest, parent: to } : rest;
  });
}

// Deleting a folder keeps what's in it: its items and folders move up to where it was. A folder that
// would then clash with one already there is renamed "… (2)".
export function deleteFolder(folders, id) {
  const gone = folders.find((f) => f.id === id);
  if (!gone) return folders;
  const up = parentOf(gone);
  let out = folders.filter((f) => f.id !== id);
  for (const child of folders.filter((f) => parentOf(f) === id)) {
    let name = child.name;
    for (let n = 2; nameProblem(out.filter((f) => f.id !== child.id), name, up); n++) name = `${child.name} (${n})`;
    out = out.map((f) => (f.id === child.id ? { ...moveFolder([f], f.id, up)[0], name } : f));
  }
  if (up) out = out.map((f) => (f.id === up ? { ...f, items: [...f.items, ...gone.items] } : f));
  return out;
}

// Every folder in tree order, with how deep it is, for a Move to… list.
export function flatTree(folders, at = "", depth = 0) {
  return childrenOf(folders, at).flatMap((f) => [{ folder: f, depth }, ...flatTree(folders, f.id, depth + 1)]);
}

// "Rock › Arctic Monkeys" for an item's folder, or "" when it's in none.
export function pathText(folders, key) {
  return pathTo(folders, folderOf(folders, key)).map((f) => f.name).join(" › ");
}

// Song and sample folders are saved with their songs as {source, path}; these turn them into keys
// ("media:path") and back.
export const keyOfRef = (ref) => `${ref.source}:${ref.path}`;
export function refOfKey(key) {
  const i = key.indexOf(":");
  return { source: key.slice(0, i), path: key.slice(i + 1) };
}
export const fromSongFolders = (folders) => folders.map(({ songs, ...f }) => ({ ...f, items: (songs || []).map(keyOfRef) }));
export const toSongFolders = (folders) => folders.map(({ items, ...f }) => ({ ...f, songs: items.map(refOfKey) }));
