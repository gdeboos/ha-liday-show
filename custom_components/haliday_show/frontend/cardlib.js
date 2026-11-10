// Logic shared by HA-liday Show's dashboard cards, kept apart from the page so node can test it
// (tests/js/cardlib.test.mjs).

// What a folder holds, for the Browse card: its path from the top, its subfolders (with how much is in
// each) and its items. Folders list their items by id or by name; an item in no folder is at the top.
export function folderView(items, folders, folderId = null) {
  folders = Array.isArray(folders) ? folders : [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const here = folderId && byId.has(folderId) ? folderId : null;
  const placed = new Map();
  for (const f of folders) {
    for (const key of f.items || []) if (!placed.has(key)) placed.set(key, f.id);
  }
  const folderOf = (item) => placed.get(item.id) ?? placed.get(item.name) ?? null;
  const parentOf = (f) => (f.parent && byId.has(f.parent) ? f.parent : null);
  const path = [];
  for (let at = here, guard = 0; at && guard < 20; at = parentOf(byId.get(at)), guard++) {
    path.unshift({ id: at, name: byId.get(at).name });
  }
  const count = (fid) => items.filter((i) => folderOf(i) === fid).length
    + folders.filter((f) => parentOf(f) === fid).length;
  return {
    path,
    folders: folders.filter((f) => parentOf(f) === here)
      .map((f) => ({ id: f.id, name: f.name, count: count(f.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    items: items.filter((i) => folderOf(i) === here).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Everything matching a search, from every folder.
export function findItems(items, text) {
  const q = (text || "").trim().toLowerCase();
  return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : [];
}

// 3:07, or 1:02:03 for an hour or more.
export function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

// How far through the media player is now, from its last report and when it was made.
export function positionNow(attrs, now = Date.now()) {
  if (!attrs || attrs.media_position == null) return 0;
  const at = Date.parse(attrs.media_position_updated_at || "");
  const gone = Number.isFinite(at) ? Math.max(0, (now - at) / 1000) : 0;
  const pos = attrs.media_position + gone;
  return attrs.media_duration ? Math.min(pos, attrs.media_duration) : pos;
}

// "Tonight at 5:30pm" / "Tomorrow at 9am" / "Sat 14 Nov at 4pm", in the viewer's own time.
export function whenText(iso, now = new Date()) {
  const t = new Date(iso);
  if (!iso || Number.isNaN(t.getTime())) return "";
  const h = t.getHours() % 12 || 12, mins = t.getMinutes();
  const time = `${h}${mins ? `:${String(mins).padStart(2, "0")}` : ""}${t.getHours() < 12 ? "am" : "pm"}`;
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(t) - day(now)) / 86400000);
  if (diff === 0) return `${t.getHours() >= 17 ? "Tonight" : "Today"} at ${time}`;
  if (diff === 1) return `Tomorrow at ${time}`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[t.getDay()]} ${t.getDate()} ${months[t.getMonth()]} at ${time}`;
}

// A tile's background when a show has no picture: its palette's colours as a gradient.
export function swatch(colours) {
  const list = (Array.isArray(colours) ? colours : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  if (!list.length) return "var(--secondary-background-color)";
  if (list.length === 1) return list[0];
  return `linear-gradient(135deg, ${list.join(", ")})`;
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// The lights the house view draws, as the editor's House tab does (app.js houseLights / partDevice): a
// split strip whose trace was split too is drawn part by part; anything else is drawn whole. `m` is the
// editor's matrix.js and parts.js ({gridOf, partSize, partGrid}).
export function houseDevices(lights, paths, m) {
  const out = [];
  for (const d of lights) {
    const parts = Array.isArray(d.parts) ? d.parts : [];
    if (parts.length && !m.gridOf(d) && !(paths[d.id] || []).length) {
      for (const p of parts) {
        const segments = m.partSize(p);
        const grid = m.partGrid(p);
        out.push({ ...d, id: `${d.id}#${p.id}`, name: `${d.name} · ${p.name}`, parent: d.id, part: p,
          from: p.from, to: p.to, segments, parts: undefined,
          ...(grid ? { matrix: { ...grid, start: "top left", order: "rows", zigzag: false } } : {}),
          bulbs: d.bulbs ? Math.max(1, Math.round((d.bulbs * segments) / d.segments)) : null });
      }
    } else {
      out.push(d);
    }
  }
  return out;
}

// Each light's colours from a live frame ({tracks: [{device, segments}], rgb: base64}), in grid order
// for matrices. `m` is {gridOf, fromWire}.
export function framesByLight(frame, lights, m) {
  const out = new Map();
  if (!frame || !frame.rgb) return out;
  const bin = atob(frame.rgb);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const byId = new Map(lights.map((l) => [l.id, l]));
  let at = 0;
  for (const t of frame.tracks || []) {
    let rgb = bytes.subarray(at, at + t.segments * 3);
    at += t.segments * 3;
    const light = byId.get(t.device);
    if (light && m.gridOf(light)) rgb = m.fromWire(rgb, light.matrix);
    out.set(t.device, rgb);
  }
  return out;
}
