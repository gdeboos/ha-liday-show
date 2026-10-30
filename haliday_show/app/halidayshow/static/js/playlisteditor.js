// The Playlist editor's sums: where a dragged card lands, how long the playlist runs, what each row
// of Your playlists says, and the building blocks (pause, colour, off, effect) that go between
// shows. Worked out here, without the page, so they can be tested. A playlist's items are as
// playlists.py keeps them: {type: "show", id} or a block {type, id, seconds, ...}.

import { EFFECTS, PRESETS, defaultParams } from "./effects.js";
import { describeSchedule } from "./schedule.js";
import { length } from "./showlist.js";

export const MAX_SHOWS = 100; // as playlists.py keeps
export const MAX_ITEMS = 200;
export const MAX_BLOCK_S = 3600;
const LOOP_MIN_S = 10, LOOP_MAX_S = 60; // an effect block's frames: long enough not to be seen going round

export const BLOCKS = {
  pause: { label: "Pause", hint: "Your lights as they normally are", seconds: 5 },
  colour: { label: "Colour", hint: "Every light one colour", seconds: 10 },
  off: { label: "Off", hint: "Every light dark", seconds: 5 },
  effect: { label: "Effect", hint: "An effect on every light", seconds: 30 },
  scene: { label: "Scene", hint: "One of your scenes", seconds: 60 },
};

// Effects a block can play: ones that look the same however long they run (not Fade or Wipe, which
// play once across their length), on each light rather than across the house photo.
export const BLOCK_EFFECTS = Object.keys(EFFECTS).filter((k) => k !== "solid" && !EFFECTS[k].once && !EFFECTS[k].music
  && !EFFECTS[k].house && !EFFECTS[k].experimental);

const rand = () => Math.random().toString(36).slice(2, 8);

export function newBlock(type, now = Date.now()) {
  const b = { type, id: `${type}-${now.toString(36)}-${rand()}`, seconds: BLOCKS[type].seconds };
  if (type === "colour") b.colour = "#ff0000";
  if (type === "scene") b.scene = "";
  if (type === "effect") Object.assign(b, { effect: "twinkle", params: { ...defaultParams("twinkle"), ...PRESETS.twinkle[1].params } });
  return b;
}

// A playlist's items; ones saved before blocks have only shows and a pause after each.
export function itemsOf(p) {
  if (Array.isArray(p.items)) return p.items;
  const out = [];
  (p.shows || []).forEach((id, k) => {
    out.push({ type: "show", id });
    if (p.gap > 0) out.push({ type: "pause", id: `pause-${k + 1}`, seconds: p.gap });
  });
  return out;
}

export const showsOf = (items) => items.filter((x) => x.type === "show").map((x) => x.id);

// The list with the item at `from` moved so it lands before what's now at `to` (0 to the list's
// length; the length puts it last). A new list; the one given isn't changed.
export function moved(list, from, to) {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to > from ? to - 1 : to, out.length)), 0, x);
  return out;
}

// Whether one more of this item fits: up to MAX_ITEMS things, MAX_SHOWS of them shows.
export function fits(items, item) {
  return items.length < MAX_ITEMS && (item.type !== "show" || showsOf(items).length < MAX_SHOWS);
}

// The list with `item` put in before position `at` (or last), unless it's full.
export function inserted(list, item, at = list.length) {
  if (!fits(list, item)) return [...list];
  const out = [...list];
  out.splice(Math.max(0, Math.min(at, out.length)), 0, item);
  return out;
}

// Where a drop at `y` lands among cards whose middles are at `mids` (top to bottom): before the
// first card it's above the middle of, else last.
export function dropIndex(mids, y) {
  const k = mids.findIndex((m) => y < m);
  return k === -1 ? mids.length : k;
}

// "Pause · 5 s", "Off · 1 min 30 s".
export function seconds(s) {
  const n = Math.round(Number(s) * 10) / 10;
  if (n < 60) return `${n} s`;
  const m = Math.floor(n / 60), r = Math.round(n - m * 60);
  return r ? `${m} min ${r} s` : `${m} min`;
}

// `scenes` maps a scene's id to its name, for a Scene block.
export function blockLabel(b, scenes = {}) {
  const what = b.type === "effect" ? `${BLOCKS.effect.label}: ${EFFECTS[b.effect]?.label || b.effect}`
    : b.type === "scene" ? `${BLOCKS.scene.label}: ${scenes[b.scene] || "a scene that's gone"}`
      : BLOCKS[b.type]?.label || b.type;
  return `${what} · ${seconds(b.seconds)}`;
}

// What plays: each item's place on the playlist's strip, as fractions of one time round. Shows that
// won't play (not saved, archived or deleted) are left out, as the player skips them.
export function strip(items, byId, scenes = {}) {
  const playing = items.map((x, k) => ({ x, k, show: x.type === "show" ? byId[x.id] : null }))
    .filter((e) => (e.x.type === "show" ? e.show?.baked : true));
  const len = (e) => Math.max(0, e.x.type === "show" ? e.show.duration || 0 : e.x.seconds || 0);
  const total = playing.reduce((t, e) => t + len(e), 0);
  let at = 0;
  const blocks = playing.map((e) => {
    const l = len(e);
    const b = { k: e.k, type: e.x.type, id: e.x.id, name: e.x.type === "show" ? e.show.name : blockLabel(e.x, scenes),
      seconds: l, start: total ? at / total : 0, width: total ? l / total : 0 };
    if (e.x.type === "colour") b.colour = e.x.colour;
    at += l;
    return b;
  });
  return { seconds: total, playing: playing.filter((e) => e.x.type === "show").length, blocks };
}

// "3 shows, 2 blocks · 12:40 each time round", with why any won't play.
export function summary(items, byId) {
  const shows = showsOf(items);
  if (!shows.length) return items.length ? "No shows yet: add one to play" : "No shows yet";
  const s = strip(items, byId);
  const nBlocks = items.length - shows.length;
  const what = `${shows.length} show${shows.length === 1 ? "" : "s"}${nBlocks ? `, ${nBlocks} block${nBlocks === 1 ? "" : "s"}` : ""}`;
  if (!s.playing) return `${what}, no show saved yet, so nothing plays`;
  const skipped = shows.length - s.playing;
  return `${what} · ${length(s.seconds)} each time round${skipped ? ` · ${skipped} show${skipped === 1 ? "" : "s"} skipped` : ""}`;
}

// The rows of Your playlists, in the order they're kept (which decides which goes first when two
// schedules overlap).
export function playlistRows(playlists, shows) {
  const byId = Object.fromEntries(shows.map((x) => [x.id, x]));
  return playlists.map((p) => {
    const items = itemsOf(p);
    return {
      id: p.id,
      name: p.name,
      details: [summary(items, byId), p.schedule?.on ? `plays ${describeSchedule(p.schedule)}` : "plays when you press Play"].join(" · "),
      playable: showsOf(items).some((id) => byId[id]?.baked),
    };
  });
}

// Baking a block --------------------------------------------------------------------
// What a block's frames show, as a show for effects.js's bake(): one clip on each light (or on each
// part of a light split into parts that's only played as parts), as long as one time round.
export function blockShow(block, lights, loop) {
  const clip = block.type === "effect"
    ? { ...defaultParams(block.effect), ...block.params, effect: block.effect }
    : { effect: "solid", color: block.type === "colour" ? block.colour : "#000000" };
  const tracks = [];
  for (const d of lights) {
    const ids = d.parts?.length && d.whole === false ? d.parts.map((p) => `${d.id}#${p.id}`) : [d.id];
    for (const id of ids) tracks.push({ device: id, clips: [{ ...clip, start: 0, end: loop }] });
  }
  return { duration: loop, tracks };
}

// How long a block's frames last before going round again. A still colour needs a second. An
// effect shorter than LOOP_MAX_S is baked whole; a longer one goes round after the length (between
// LOOP_MIN_S and LOOP_MAX_S) where the lights look most like they did at the start, so the join
// isn't seen. look(t) gives every light's colours at t seconds, as one array.
export function loopLength(block, fps, look) {
  if (block.type !== "effect") return 1;
  if (block.seconds <= LOOP_MAX_S) return Math.max(block.seconds, 1 / fps);
  const first = look(0);
  let best = LOOP_MAX_S, bestDiff = Infinity;
  for (let f = Math.round(LOOP_MAX_S * fps); f >= LOOP_MIN_S * fps; f--) {
    const t = f / fps, now = look(t);
    let diff = 0;
    for (let i = 0; i < now.length && diff < bestDiff; i++) diff += Math.abs(now[i] - first[i]);
    if (diff < bestDiff) { best = t; bestDiff = diff; }
    if (diff === 0) break; // goes round exactly: the longest such loop
  }
  return best;
}

// What a block's baked frames depend on: its own settings and the lights.
export function bakeKey(block, lightsKey) {
  const { seconds: s, ...rest } = block;
  // A still block's frames don't change with its length, nor does an effect's beyond a minute.
  const len = block.type === "effect" ? Math.min(s, LOOP_MAX_S + 1) : 0;
  return JSON.stringify([rest, len, lightsKey]);
}

// A copy of a playlist to change on its own: a free name ("Party copy", "Party copy 2"), a new id,
// and new ids for its blocks so their frames are made for the copy. It isn't on any schedule.
export function copyPlaylist(p, taken, now = Date.now()) {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  let name = `${p.name} copy`;
  for (let k = 2; names.has(name.toLowerCase()); k++) name = `${p.name} copy ${k}`;
  const { schedule, ...rest } = structuredClone(p);
  const items = itemsOf(rest).map((it) => (it.type && it.type !== "show"
    ? { ...it, id: `${it.type}-${now.toString(36)}-${rand()}` } : it));
  return { ...rest, id: `pl-${now.toString(36)}${rand().slice(0, 3)}`, name: name.slice(0, 80), items };
}
