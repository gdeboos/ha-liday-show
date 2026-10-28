// Folders for the Library's lists (shows, scenes, playlists, your palettes, your presets): just names,
// each holding items by key (a show's id, a palette's name…). Nothing moves on disk; deleting a folder
// leaves its items in no folder. Saved per list as {kind: [{id, name, items: [key]}]}.

export const LIBRARY_KINDS = ["shows", "scenes", "playlists", "palettes", "presets"];

const slug = (name) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "folder";
const tidy = (name) => name.split(/\s+/).filter(Boolean).join(" ");

export const folderOfItem = (folders, key) => folders.find((f) => f.items.includes(key))?.id || "";

// The folders with `key` moved into folder `id` ("" for none), out of any other.
export const moveItem = (folders, key, id) =>
  folders.map((f) => ({ ...f, items: [...f.items.filter((k) => k !== key), ...(f.id === id ? [key] : [])] }));

// After an item's key changes (a palette or preset renamed), it stays in its folder.
export const renameItem = (folders, from, to) =>
  folders.map((f) => ({ ...f, items: f.items.map((k) => (k === from ? to : k)) }));

export function addLibraryFolder(folders, name) {
  const clean = tidy(name);
  const ids = new Set(folders.map((f) => f.id));
  let id = slug(clean);
  for (let i = 2; ids.has(id); i++) id = `${slug(clean).slice(0, 36)}-${i}`;
  return { folders: [...folders, { id, name: clean, items: [] }], id };
}

export const renameLibraryFolder = (folders, id, name) => folders.map((f) => (f.id === id ? { ...f, name: tidy(name) } : f));
export const deleteLibraryFolder = (folders, id) => folders.filter((f) => f.id !== id);

// keys split into the folders (by name, each with the keys in it, in the order given) and those in
// none. Keys a folder holds that aren't listed (archived or deleted items) are skipped, not dropped.
export function groupByFolder(keys, folders) {
  const where = new Map();
  for (const f of folders) for (const k of f.items) if (!where.has(k)) where.set(k, f.id);
  const byId = new Map(folders.map((f) => [f.id, { folder: f, keys: [] }]));
  const loose = [];
  for (const k of keys) (where.has(k) && byId.has(where.get(k)) ? byId.get(where.get(k)).keys : loose).push(k);
  const groups = [...byId.values()].sort((a, b) => a.folder.name.localeCompare(b.folder.name, undefined, { sensitivity: "base" }));
  return { groups, loose };
}
