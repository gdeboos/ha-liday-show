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

// ---- The visual editors (Home Assistant's getConfigForm) -------------------------------------------
// Every option is off by default and named after what it hides, so a card with no options set (as all
// cards made before the editors were) shows everything, and the editor's switches start where the card is.
const toggles = (...names) => ({ name: "", type: "grid", schema: names.map((name) => ({ name, selector: { boolean: {} } })) });
const TITLE = [{ name: "title", selector: { text: {} } }];

export const FORMS = {
  player: [...TITLE, toggles("hide_title", "hide_art", "hide_progress", "hide_picker", "hide_next", "hide_open")],
  browse: [...TITLE,
    { name: "kinds", selector: { select: { mode: "dropdown", options: [
      { value: "both", label: "Shows and playlists" }, { value: "shows", label: "Shows only" },
      { value: "playlists", label: "Playlists only" }] } } },
    { name: "start", selector: { select: { mode: "dropdown", options: [
      { value: "shows", label: "Shows" }, { value: "playlists", label: "Playlists" }] } } },
    { name: "tile_size", selector: { select: { mode: "dropdown", options: [
      { value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }] } } },
    toggles("hide_title", "hide_search", "hide_seasons", "hide_open")],
  scenes: [...TITLE,
    { name: "scenes", selector: { entity: { multiple: true, filter: { domain: "scene", integration: "haliday_show" } } } },
    { name: "columns", selector: { number: { min: 1, max: 6, mode: "box" } } },
    toggles("hide_title", "hide_colours", "hide_brightness", "hide_off", "hide_open")],
  visitors: [...TITLE, toggles("hide_title", "hide_page", "hide_queue", "hide_phones", "hide_picks", "hide_check", "hide_run",
    "hide_skip", "hide_open")],
  schedule: [...TITLE,
    { name: "days", selector: { number: { min: 1, max: 7, mode: "slider" } } },
    { name: "layout", selector: { select: { mode: "dropdown", options: [
      { value: "auto", label: "Timeline, or a list when narrow" }, { value: "timeline", label: "Timeline" },
      { value: "list", label: "List" }] } } },
    toggles("hide_title", "hide_scenes", "hide_open")],
  house: [...TITLE,
    { name: "max_height", selector: { number: { min: 150, max: 1200, step: 10, mode: "box", unit_of_measurement: "px" } } },
    toggles("hide_title", "hide_caption", "hide_open")],
};

export const LABELS = {
  title: "Title",
  hide_title: "Hide the title",
  hide_art: "Hide the cover art",
  hide_progress: "Hide how far through it is",
  hide_picker: "Hide the show picker and Play",
  hide_next: "Hide what's next on the schedule",
  kinds: "Show",
  start: "Open on",
  tile_size: "Tile size",
  hide_search: "Hide Find in every folder",
  scenes: "Only these scenes",
  columns: "Columns",
  hide_brightness: "Hide Brightness",
  hide_off: "Hide Off",
  hide_page: "Hide the visitors' page",
  hide_queue: "Hide picks waiting",
  hide_phones: "Hide phones listening",
  hide_picks: "Hide the list of picks",
  hide_check: "Hide the pre-show check",
  hide_run: "Hide Run check",
  hide_skip: "Hide Skip this pick",
  max_height: "Tallest it can be",
  hide_caption: "Hide the line under the picture",
  hide_open: "Hide the link to HA-liday Show",
  days: "Days to show",
  layout: "Layout",
  hide_scenes: "Hide scenes (shows and playlists only)",
  hide_seasons: "Hide season tags",
  hide_colours: "Hide each scene's colours",
};

export const HELPERS = {
  title: "Leave empty for the usual title.",
  scenes: "Leave empty for all your scenes, in name order. Otherwise these, in this order.",
  columns: "Leave empty to fit as many as there's room for.",
  max_height: "420 px unless you change it.",
  start: "Which tab the card opens on, when it shows both.",
  days: "From today: 1 is just today, 7 is the week.",
};

// The form for one card, as Home Assistant's card editor takes it.
export function configForm(card) {
  return {
    schema: FORMS[card],
    computeLabel: (s) => LABELS[s.name] ?? s.name,
    computeHelper: (s) => HELPERS[s.name],
  };
}

// The Browse card's tile width in pixels.
export const TILE_SIZES = { small: 84, medium: 104, large: 148 };

// Which scenes the Scenes card shows: the ones picked, in that order, else all of them by name.
export function pickScenes(all, picked) {
  if (!Array.isArray(picked) || !picked.length) return [...all].sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(all.map((s) => [s.id, s]));
  return picked.map((id) => byId.get(id)).filter(Boolean);
}

// ---- The Schedule card -----------------------------------------------------------------------------
// The days to draw and where each stretch goes on them: one shared time range (from the earliest start
// to the latest end, to the hour) so the days line up, and each bar as a left and width in %.
export function scheduleLayout(week, { days = 7, scenes = true, now = new Date() } = {}) {
  const want = (week?.days || []).slice(0, Math.max(1, Math.min(7, days)));
  // Everything on the viewer's own wall clock: a stretch goes on the day it starts there, and is placed
  // by its clock time (so a clock change, or a phone in another time zone, can't shift it).
  const slots = (week?.slots || []).filter((s) => s.plays && (scenes || s.lane !== "scene"))
    .map((s) => ({ ...s, row: localDay(s.plays[0]) })).filter((s) => want.includes(s.row));
  let from = Infinity, to = -Infinity;
  for (const s of slots) {
    from = Math.min(from, wallMinutes(s.plays[0], s.row));
    to = Math.max(to, wallMinutes(s.plays[1], s.row));
  }
  if (!slots.length) { from = 16 * 60; to = 23 * 60; }
  from = Math.floor(from / 60) * 60;
  to = Math.max(from + 60, Math.ceil(to / 60) * 60);
  const span = to - from;
  const pos = (m) => Math.max(0, Math.min(100, ((m - from) / span) * 100));
  const rows = want.map((day) => {
    const bars = slots.filter((s) => s.row === day).map((s) => {
      const a = wallMinutes(s.plays[0], day), b = wallMinutes(s.plays[1], day);
      return { name: s.name, kind: s.kind, lane: s.lane, onNow: !!s.on_now, start: s.plays[0], end: s.plays[1],
        past: new Date(s.plays[1]).getTime() <= now.getTime(),
        left: pos(a), width: Math.max(0.5, pos(b) - pos(a)) };
    }).sort((x, y) => x.left - y.left);
    const nowMin = wallMinutes(now, day);
    return { day, bars, now: nowMin >= from && nowMin <= to ? pos(nowMin) : null };
  });
  const ticks = [];
  const step = span > 12 * 60 ? 180 : span > 6 * 60 ? 120 : 60;
  for (let m = from; m <= to; m += step) ticks.push({ at: pos(m), label: hourText(m) });
  return { rows, ticks, empty: !slots.length };
}

// The viewer's local date of a moment, as YYYY-MM-DD.
export function localDay(when) {
  const t = new Date(when);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

// A moment's clock time in minutes from the start of `day` (YYYY-MM-DD) on the viewer's clock: 17:00
// the next day is 2460. Counted from the clock's own hours and minutes, so a clock change doesn't move it.
export function wallMinutes(when, day) {
  const t = new Date(when);
  const [y, m, d] = day.split("-").map(Number);
  const days = Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) - Date.UTC(y, m - 1, d)) / 86400000);
  return days * 1440 + t.getHours() * 60 + t.getMinutes();
}

// 5pm, midnight, 1am (minutes from the start of the day, maybe past 24 hours).
export function hourText(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return `${h % 12}${h < 12 ? "am" : "pm"}`;
}

// "Today", "Tomorrow", "Thu 12".
export function dayText(day, now = new Date()) {
  const [y, m, d] = day.split("-").map(Number);
  const that = new Date(y, m - 1, d), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((that - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][that.getDay()]} ${d}`;
}

// 5pm to 10:30pm
export function spanText(startIso, endIso) {
  const f = (iso) => {
    const t = new Date(iso), h = t.getHours() % 12 || 12, m = t.getMinutes();
    return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""}${t.getHours() < 12 ? "am" : "pm"}`;
  };
  return `${f(startIso)} to ${f(endIso)}`;
}
