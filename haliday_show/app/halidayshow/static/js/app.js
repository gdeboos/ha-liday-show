// Editor app: shows, songs, devices, transport and the clip inspector.

import { buildContext, checkClips, checkPalettes, checkPresets, effectsForAI, placeClips } from "./aiclips.js";
import { analyseInWorker, toMono } from "./analysis.js";
import { aiRequest, describeSections, describeWithAI, keepYours } from "./sectionnotes.js";
import { STYLES, applyGenerated, generateShow, splitLong, suggestLooks } from "./autogen.js";
import { clipFit, reachNote, worst } from "./compat.js";
import {
  EFFECTS, FPS, HOUSE, PRESETS, applyHouse, bake, composeLight, defaultParams, matchesPreset, presetParams,
  renderTrack, showDuration,
} from "./effects.js";
import { controllerId, nextFirstLed, nextUniverse, overlapping } from "./controllers.js";
import { partsFrame } from "./devicetest.js";
import { asShown, isSlow } from "./lightspeed.js";
import { LAB_TEMPLATES, flagSweep, modeSweep, startSweep, sweepWindow, windowSweep } from "./labtemplates.js";
import { House, partRgb } from "./house.js";
import { placeOnSample } from "./samplehouse.js";
import { DEMO_LIGHTS, DEMO_SHOW, DEMO_SONG, DEMO_SONG_NAME, canStartDemo, hasDemo, isDemoId, withoutDemo } from "./demo.js";
import { Layout } from "./layout.js";
import { STATUS, modelSummary, newLight, statusOf } from "./models.js";
import { MusicEditor } from "./music.js";
import { createVolume } from "./volume.js";
import { PRESET_PALETTES, applyPalette, paletteKeys, seasonalPalette } from "./palettes.js";
import { DAYS, DEFAULT_SCHEDULE, MONTHS, describeSchedule, whenNext } from "./schedule.js";
import { readability } from "../public/colours.js";
import { addressText, emptyPlaylists, itemText, nearbyText, queueText, visitorLink } from "./publicsettings.js";
import { fetchSong, songLoadMessage } from "./songload.js";
import { StatusLine } from "./statusline.js";
import { freeName, startChoices } from "./newshow.js";
import { copyName, length as fmtLength, showRows, songName } from "./showlist.js";
import {
  buildTracks, lengthNote, makeShare, matchCount, myLights, partPlan, readShare, shareFileName, suggest, suggestSong,
} from "./sharing.js";
import {
  BLOCKS as PLAYLIST_BLOCKS, BLOCK_EFFECTS as PLAYLIST_BLOCK_EFFECTS, MAX_BLOCK_S as PLAYLIST_MAX_BLOCK_S, MAX_ITEMS as PLAYLIST_MAX_ITEMS,
  MAX_SHOWS as PLAYLIST_MAX, bakeKey, blockLabel as playlistBlockLabel, blockShow, dropIndex, fits as fitsPlaylist, inserted,
  itemsOf, loopLength, moved, newBlock, playlistRows, strip as playlistStrip, summary as playlistSummary,
} from "./playlisteditor.js";
import { filterRows, songKey, songRows } from "./songlist.js";
import { addedMessage, detectChoices, isAudioName, nameFromFile, nameTaken, savedName } from "./addsong.js";
import { Timeline, fmtTime } from "./timeline.js";
import { PART, sendParts, uploadSong } from "./upload.js";

const $ = (id) => document.getElementById(id);

// Relative URLs keep working behind Home Assistant ingress.
async function api(path, { method = "GET", json, body, headers = {}, signal, keepalive = false } = {}) {
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers["Content-Type"] = "application/json";
  }
  // keepalive: still sent if the page closes meanwhile (the Music editor's draft, as you leave).
  const res = await fetch(path, { method, body, headers, signal, keepalive });
  if (!res.ok) {
    const err = new Error((await res.text()) || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.headers.get("Content-Type")?.includes("json") ? res.json() : res.text();
}

const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`halidayshow.${key}`); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`halidayshow.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

// "How to…" folds keep the longer help out of the way, open or shut as you last left each one.
function restoreHowTo(root = document) {
  for (const d of root.querySelectorAll("details.howto[data-howto]")) d.open = prefs.get(`howto.${d.dataset.howto}`, false);
}
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d instanceof HTMLDetailsElement && d.matches(".howto[data-howto]")) prefs.set(`howto.${d.dataset.howto}`, d.open);
}, true);

// A message in the top bar. Pass error = true for a failure (it stays until pressed), "saved" when
// something has just been saved (it lights up, then settles to the time), or "hint".
let statusLine;
// Thrown for something to put right rather than a failure ("… is already on the list"), so it
// shows as a hint where it's caught.
class Nudge extends Error {}
const errorKind = (e) => (e instanceof Nudge ? "hint" : true);
// "hint" is a nudge such as "Choose a song first", which fades. `topic` names what a failure was
// about, so a later save of it, or status("", "info", topic), takes the failure away.
function status(msg, error = false, topic = null) {
  statusLine ||= new StatusLine($("status"));
  const kind = error === true ? "error" : error || "info";
  statusLine.show(msg, kind, topic);
  noteInDialog(msg, kind);
}

// An open window covers the status bar, so problems and tips show inside it too, above its buttons.
function noteInDialog(msg, kind) {
  // The window on top is the one you're in (a modal window keeps focus inside itself).
  const dlg = document.activeElement?.closest?.("dialog[open]") || [...document.querySelectorAll("dialog[open]")].pop();
  if (!dlg) return;
  let note = dlg.querySelector(".dialog-note");
  if (kind !== "error" && kind !== "hint") { if (note) note.hidden = true; return; }
  if (!note) {
    note = document.createElement("p");
    note.className = "dialog-note";
    note.setAttribute("role", "alert");
    const foot = dlg.querySelector(".form-dialog-foot, .insp-actions");
    if (foot) foot.before(note); else (dlg.querySelector("form") || dlg).append(note);
    dlg.addEventListener("close", () => note.remove(), { once: true });
    // Once you change something in the window, the message has done its job.
    dlg.addEventListener("input", () => { note.hidden = true; });
  }
  note.hidden = false;
  note.className = `dialog-note ${kind}`;
  note.textContent = msg;
}

// bars and sections come from Detect: bar start times, and [{start, end, label, energy}].
const blankShow = (name = "Untitled show") => ({
  name, audio: null, fps: FPS, duration: 60, beats: [], bars: [], sections: [], tracks: [],
});
const audioUrl = (a) => `api/audio/file?source=${encodeURIComponent(a.source)}&path=${encodeURIComponent(a.path)}`;

const app = {
  show: blankShow(),
  showId: null,
  dirty: false,
  edits: 0, // counts changes, so a save only marks the show clean if nothing changed meanwhile
  bakedKey: null,
  deviceList: [],
  devices: {},
  pps: prefs.get("pps", 60),
  time: 0,
  playing: false,
  // {track, clip}; clip is null when a whole light is selected, and range is set
  // ({tracks, start, end}) when a stretch of time is selected on one or more lights.
  selected: null,
  clipboard: null, // {clips, track, whole}
  region: null, // {start, end}: the part of the show Play plays (and loops), while designing
  loop: prefs.get("loop", false),
  paletteEffect: "solid",
  palettes: [], // the user's own colour palettes; presets are in palettes.js
  myPresets: [], // the user's own effect presets, {name, effect, params}; built-in ones are in effects.js
  colourPalette: prefs.get("colourPalette", PRESET_PALETTES[0].name),
  lastColourKey: null, // colour field a palette swatch fills
  snap: prefs.get("snap", true),
  peaks: null,
  audioDuration: 0,
  history: [],
  historyIndex: -1,
  clockStart: 0,
  syncTimer: null,
  speakers: [], // added on the Speakers tab; the only ones the editor offers
  speakerCandidates: [], // all of Home Assistant's media players
  haAvailable: null,
  defaultSpeaker: null, // where automations play a show that has no speaker of its own
  models: {}, // Govee SKU -> {name, status?, protocol?, segments?, bulbs?, reach?, note?} (models.js)
  remote: false, // playing on a Home Assistant speaker; the add-on keeps time

  duration() {
    return Math.max(this.audioDuration || this.show.duration || 0, showDuration({ tracks: this.show.tracks }));
  },

  seek(t) {
    if (this.playing && this.remote) {
      status("Stop the speaker to move the playhead");
      return;
    }
    this.time = Math.min(Math.max(t, 0), this.duration());
    if (hasAudio()) audio.currentTime = this.time;
    else this.clockStart = performance.now() - this.time * 1000;
    if (this.playing) syncLights();
  },

  setRegion(r) {
    this.region = r && r.end - r.start >= 0.05 ? { start: Math.max(0, r.start), end: r.end } : null;
    renderRegion();
    timeline.draw();
  },

  select(sel) {
    this.selected = sel;
    renderInspector();
    timeline.draw();
  },

  // live changes redraw only; committed ones also go on the undo history.
  changed({ live = false } = {}) {
    this.dirty = true;
    this.edits++;
    timeline.layout();
    if (!live) {
      commit();
      renderInspector();
      renderSongSummary();
      scheduleAutoSave();
    }
  },
};

const audio = $("audio");
const volume = createVolume();
volume.bind($("volume"), (g) => { audio.volume = g; });
const timeline = new Timeline(app);
const music = new MusicEditor({ api, status, volume, songs: () => app.songs || [], songsChanged: () => refreshAudio(),
  opened: (ref) => prefs.set("lastSong", songKey(ref)), aiSectionNotes: (...a) => aiSectionNotes(...a), hasAI: () => !!aiVia,
  draftsChanged: () => draftsChanged() });
const hasAudio = () => !!app.show.audio && audio.src !== "";

// history -----------------------------------------------------------------
function commit() {
  app.history.splice(app.historyIndex + 1);
  app.history.push(JSON.stringify(app.show));
  if (app.history.length > 100) app.history.shift();
  app.historyIndex = app.history.length - 1;
}

function restore(step) {
  const i = app.historyIndex + step;
  if (i < 0 || i >= app.history.length) return;
  app.historyIndex = i;
  app.show = JSON.parse(app.history[i]);
  app.dirty = true;
  app.edits++;
  app.selected = null;
  $("show-name").value = app.show.name; // undo can take back a rename
  renderInspector();
  timeline.layout();
  scheduleAutoSave();
}

// devices -------------------------------------------------------------------
async function loadDevices() {
  app.deviceList = await api("api/devices");
  indexDevices();
}

// A light split into parts plays as one pseudo-light per part, keyed "light#part", and its own
// track plays across all the parts joined together (see composeLight). Segments outside every part
// stay off. app.devices holds what each track plays on; app.lights holds the physical lights.
const partId = (d, p) => `${d.id}#${p.id}`;
function partDevice(d, p) {
  const segments = p.to - p.from + 1;
  return { ...d, id: partId(d, p), name: `${d.name} · ${p.name}`, partName: p.name, parent: d.id,
    partIndex: d.parts.indexOf(p), from: p.from, to: p.to, segments, parts: undefined,
    bulbs: d.bulbs ? Math.max(1, Math.round(d.bulbs * segments / d.segments)) : null };
}
// What a split light's own track plays on: its parts end to end, as one strip.
function allPartsDevice(d) {
  const segments = d.parts.reduce((n, p) => n + p.to - p.from + 1, 0);
  return { ...d, segments, light: d, bulbs: d.bulbs ? Math.max(1, Math.round(d.bulbs * segments / d.segments)) : null };
}
// The device a track plays on, or null for a missing light or a split light played as parts only.
const playingDev = (tr) => {
  const d = app.devices[tr.device];
  return d && d.light?.whole !== false ? d : null;
};

function indexDevices() {
  app.devices = {};
  app.lights = {};
  for (const d of app.deviceList) {
    app.lights[d.id] = d;
    app.devices[d.id] = d.parts?.length ? allPartsDevice(d) : d;
    for (const p of d.parts || []) app.devices[partId(d, p)] = partDevice(d, p);
  }
  ensureTracks();
  renderDevices();
  layoutPreview();
  timeline.layout();
}

// Every show has the House lane at the top, then a track per light.
function ensureTracks() {
  if (!app.show.tracks.some((t) => t.device === HOUSE)) {
    app.show.tracks.unshift({ device: HOUSE, clips: [] });
    app.selected = null; // track numbers have moved
  }
  const tracks = app.show.tracks, before = tracks.map((t) => t.device).join();
  const has = (id) => tracks.some((t) => t.device === id);
  for (const d of app.deviceList) {
    if (!d.parts?.length) {
      // Back where its parts were, if it had any.
      const at = tracks.findIndex((t) => t.device.startsWith(`${d.id}#`));
      if (!has(d.id)) tracks.splice(at < 0 ? tracks.length : at, 0, { device: d.id, clips: [] });
      continue;
    }
    const own = tracks.findIndex((t) => t.device === d.id);
    if (d.whole === false) {
      // Parts only: the light's own track goes, unless it still has effects on it.
      if (own >= 0 && !tracks[own].clips.length) tracks.splice(own, 1);
    } else if (own < 0) {
      const first = tracks.findIndex((t) => t.device.startsWith(`${d.id}#`));
      tracks.splice(first < 0 ? tracks.length : first, 0, { device: d.id, clips: [] });
    }
    // Part tracks go just under the whole light's track, in order.
    let at = tracks.findIndex((t) => t.device === d.id || app.devices[t.device]?.parent === d.id);
    if (at < 0) at = tracks.length;
    else if (tracks[at].device === d.id) at++;
    for (const p of d.parts) {
      const id = partId(d, p);
      const i = tracks.findIndex((t) => t.device === id);
      if (i >= 0) { at = Math.max(at, i + 1); continue; }
      tracks.splice(at, 0, { device: id, clips: [] });
      at++;
    }
  }
  // Empty tracks for parts that no longer exist.
  app.show.tracks = tracks.filter((t) => !t.device.includes("#") || app.devices[t.device] || t.clips.length);
  // Tracks follow the Devices tab's order: the House lane, then each light with its parts. Tracks for
  // missing lights stay at the end.
  const order = new Map(app.deviceList.map((d, i) => [d.id, i]));
  const rank = (t) => {
    if (t.device === HOUSE) return -1;
    const dev = app.devices[t.device];
    if (!dev) return Infinity;
    if (!dev.parent) return order.get(dev.id) * 1000;
    const light = app.lights[dev.parent];
    return order.get(light.id) * 1000 + 1 + light.parts.findIndex((p) => partId(light, p) === t.device);
  };
  app.show.tracks.sort((a, b) => rank(a) - rank(b) || 0);
  if (app.show.tracks.map((t) => t.device).join() !== before) app.selected = null; // track numbers have moved
}

async function saveDevices() {
  // Parts have to fit the light, so a light made shorter trims them.
  for (const d of app.deviceList) {
    d.parts = (d.parts || []).filter((p) => p.from <= d.segments).map((p) => ({ ...p, to: Math.min(p.to, d.segments) }));
  }
  try {
    app.deviceList = await api("api/devices", { method: "PUT", json: app.deviceList });
    indexDevices();
    keepBlocksReady();
    status("Lights saved", "saved", "lights");
  } catch (e) { status(`Couldn't save your lights: ${e.message}`, true, "lights"); return; }
  for (const d of app.deviceList) retestLight(d);
}

// Tests running on the Devices tab, by light id. A light that changes while its test is still on
// gets the test again, so new segment counts, parts or Reverse show on the light straight away.
const deviceTests = {}; // id -> {what: "rainbow" | "parts" | a part's id, until, sent}

async function testLight(d, what = "rainbow") {
  const seconds = what === "rainbow" ? 20 : 60;
  const json = { ...d, seconds };
  if (what !== "rainbow") json.rgb = toHex(partsFrame(d, what === "parts" ? undefined : what));
  const sent = JSON.stringify({ ...json, seconds: 0 });
  try {
    await api("api/devices/test", { method: "POST", json });
    deviceTests[d.id] = { what, until: Date.now() + seconds * 1000, sent };
    return true;
  } catch (e) {
    delete deviceTests[d.id];
    status(`Test failed: ${e.message}`, true);
    return false;
  }
}

function retestLight(d) {
  const t = deviceTests[d.id];
  if (!t) return;
  const gone = !["rainbow", "parts"].includes(t.what) && !(d.parts || []).some((p) => p.id === t.what);
  if (t.until < Date.now() || !linked(d) || (d.protocol === "whole" && t.what !== "rainbow") || gone) {
    delete deviceTests[d.id];
    return;
  }
  const json = { ...d, seconds: 0 };
  if (t.what !== "rainbow") json.rgb = toHex(partsFrame(d, t.what === "parts" ? undefined : t.what));
  if (JSON.stringify(json) !== t.sent) testLight(d, t.what);
}

async function stopTest(d) {
  delete deviceTests[d.id];
  try { await api("api/devices/test", { method: "POST", json: { ...d, stop: true } }); } catch { /* it lets go by itself */ }
}

function renderDevices() {
  renderLab();
  const rows = $("device-rows");
  rows.replaceChildren();
  if (!app.deviceList.length) {
    rows.innerHTML = `<tr><td colspan="7" class="hint">No lights yet. Press <b>+ Add a light</b> to add one, or
      <button class="ghost small" data-demo>Try the demo</button> to see it working with lights on a sample house.</td></tr>`;
    rows.querySelector("[data-demo]").addEventListener("click", tryDemo);
  }
  renderDemo();
  for (const d of app.deviceList) {
    d.brightness ??= 100; // saved before per-light brightness existed
    const tr = document.createElement("tr");
    tr.className = "device-line";
    tr.title = `Edit ${d.name}`;
    const cell = (...kids) => { const td = document.createElement("td"); td.append(...kids); tr.append(td); return td; };
    cell(orderControls(d));
    cell(Object.assign(document.createElement("b"), { textContent: d.name }));
    cell(Object.assign(document.createElement("span"), { className: d.ip || isHa(d) ? "" : "hint",
      textContent: isHa(d) ? (d.entity || "Not picked yet") : d.ip || "Planned" }));
    const model = document.createElement("span");
    if (isWled(d)) model.append("WLED");
    else if (d.kind === "twinkly") model.append("Twinkly");
    else if (isHa(d)) model.append(d.protocol === "ha_switch" ? "HA switch" : "HA light");
    else if (d.kind === "ddp") model.append("DDP");
    else if (d.kind === "e131") model.append("E1.31");
    else model.append(d.sku || "–", modelBadge(d.sku));
    const clash = ["ddp", "e131"].includes(d.kind) && overlapping(app.deviceList, d);
    if (clash) model.append(Object.assign(document.createElement("div"), { className: "hint warn", textContent: `Shares LEDs with ${clash.name}` }));
    cell(model);
    const preview = cell(segmentPreview(d));
    preview.className = "device-preview";
    const test = button("Test", async () => {
      if (await testLight(d)) status(`Testing ${d.name} for 20 seconds`);
    }, "ghost");
    test.disabled = !linked(d);
    if (!linked(d)) test.title = plannedTip(d);
    const edit = button("Edit", () => openLightEditor(d), "ghost device-edit");
    cell(test, " ", edit).className = "device-actions";
    tr.addEventListener("click", (e) => {
      if (!e.target.closest("button, input, select, .order")) openLightEditor(d);
    });
    rows.append(tr);
    dropTarget(tr, d);
  }
  if ($("light-dialog").open) renderLightEditor();
}

// A thin bar of the light's segments, each part in its colour, plus a short summary under it.
function segmentPreview(d) {
  const box = document.createElement("span");
  box.className = "seg-preview";
  const map = document.createElement("span");
  map.className = "parts-map mini";
  const parts = d.parts || [];
  const colourOf = (k) => `rgb(${partRgb(k).join()})`;
  // Long lights are drawn in at most 120 cells, so the bar stays readable.
  const n = Math.max(1, d.segments || 1), cells = Math.min(n, 120);
  for (let c = 0; c < cells; c++) {
    const s = Math.floor((c + 0.5) * n / cells) + 1;
    const span = document.createElement("span");
    const k = parts.findIndex((p) => p.from <= s && s <= p.to);
    span.style.background = k >= 0 ? colourOf(k) : parts.length ? "" : "var(--accent)";
    map.append(span);
  }
  const what = isHa(d) ? "one colour" : `${d.segments} segment${d.segments === 1 ? "" : "s"}`;
  const text = Object.assign(document.createElement("span"), { className: "hint",
    textContent: parts.length ? `${what} · ${parts.length} part${parts.length === 1 ? "" : "s"}` : what });
  box.title = parts.length ? parts.map((p) => `${p.name}: ${p.from}–${p.to}`).join("\n") : "";
  box.append(map, text);
  return box;
}

// The settings and parts for one light, built fresh each time the list changes.
function lightFields(d) {
    const input = (type, key, attrs = {}) => {
      const el = document.createElement("input");
      el.type = type;
      Object.assign(el, attrs);
      if (type === "checkbox") el.checked = d[key]; else el.value = d[key];
      el.addEventListener("change", () => {
        d[key] = type === "checkbox" ? el.checked : type === "number" ? Number(el.value) : el.value;
        saveDevices();
      });
      return el;
    };
    const out = [];
    const cell = (child, label, hint) => out.push({ child, label, hint });
    cell(input("text", "name", { size: 20 }), "Name");
    const ip = document.createElement("input");
    Object.assign(ip, { value: d.ip, placeholder: "Not linked yet", size: 13, title: "The light's IP address. Leave blank for a planned light." });
    ip.addEventListener("change", () => {
      const v = ip.value.trim();
      if (v && !/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) { status("That isn't an IP address", "hint"); ip.value = d.ip; return; }
      d.ip = v;
      saveDevices();
    });
    if (isHa(d)) {
      const pick = document.createElement("select");
      pick.title = "The Home Assistant light or switch this is";
      fillHaPicker(pick, d.entity);
      pick.addEventListener("change", () => {
        d.entity = pick.value;
        d.protocol = pick.value.startsWith("switch.") ? "ha_switch" : "ha_light";
        saveDevices();
      });
      cell(pick, "Light or switch");
    } else cell(ip, "IP address", "Leave blank for a planned light.");
    const wled = isPixels(d) || isHa(d);
    const model = document.createElement("span");
    if (isWled(d)) model.append("WLED");
    else if (d.kind === "twinkly") model.append("Twinkly (experimental)");
    else if (isHa(d)) model.append(d.protocol === "ha_switch" ? "Home Assistant switch" : "Home Assistant light");
    else if (d.kind === "ddp") {
      const first = input("number", "first", { min: 1, max: 100000, className: "seg-num",
        title: "The LED on the controller where this light starts. Lights sharing a controller each start at their own LED." });
      first.value = d.first || 1;
      model.append("Pixel controller · first LED ", first);
    } else if (d.kind === "e131") {
      const universe = input("number", "universe", { min: 1, max: 63999, className: "seg-num",
        title: "The universe this light starts in, as set on the controller" });
      universe.value = d.universe || 1;
      const channel = input("number", "channel", { min: 1, max: 510, className: "seg-num",
        title: "The channel in that universe where this light starts. Each LED takes 3 channels; universes hold 510." });
      channel.value = d.channel || 1;
      model.append("E1.31 · universe ", universe, " channel ", channel);
    } else model.append(d.sku || "–", modelBadge(d.sku));
    if (["ddp", "e131"].includes(d.kind)) {
      const clash = overlapping(app.deviceList, d);
      if (clash) {
        const warn = document.createElement("div");
        warn.className = "hint warn";
        warn.textContent = `Shares LEDs with ${clash.name}`;
        model.append(warn);
      }
    }
    cell(model, "Model");
    const segs = document.createElement("span");
    const find = button("Find", () => findSegments(d), "ghost");
    find.disabled = !d.ip || LONG_PROTOCOLS.includes(d.protocol);
    find.title = d.ip ? "Work out the segment count with a few yes or no questions" : "Link this light first";
    const count = input("number", "segments", { min: 1, max: LONG_PROTOCOLS.includes(d.protocol) ? 1000 : 255 });
    if (isHa(d)) Object.assign(count, { disabled: true, title: "A Home Assistant light is one colour at a time" });
    if (wled) count.title = "How many LEDs the light has. Each one is a segment.";
    segs.append(count);
    if (!wled) segs.append(" ", find);
    cell(segs, "Segments", isHa(d) ? "" : wled ? "How many LEDs it has." : "Press <b>Find</b> to work it out with a few yes or no questions, or use <b>Test</b>.");
    const bulbs = document.createElement("input");
    Object.assign(bulbs, { type: "number", min: 1, max: 2000, value: d.bulbs ?? "", placeholder: `${d.segments * 4}?`,
      title: "How many bulbs the light has, so the House view draws each one. Blank guesses 4 per segment." });
    bulbs.addEventListener("change", () => {
      const v = Math.round(Number(bulbs.value));
      d.bulbs = v >= 1 ? Math.min(v, 2000) : null;
      saveDevices();
    });
    cell(bulbs, "Bulbs", "So the House view draws each one. Blank guesses 4 per segment.");
    cell(input("number", "brightness", { min: 1, max: 100, title: "Caps this light in every show. 100 is full brightness." }),
      "Brightness %", "Caps this light in every show.");
    if (!isHa(d)) cell(input("checkbox", "reverse"), "Reverse", "Tick if Test's white dot runs the wrong way.");
    if (!wled) cell(input("checkbox", "gradient"), "Blend", "Ask the light to blend between segments.");
    if (wled) {
      const how = document.createElement("span");
      how.className = "hint";
      how.textContent = isHa(d) ? "Home Assistant" : d.kind === "e131" ? "E1.31" : d.kind === "twinkly" ? "Twinkly" : "DDP";
      how.title = d.kind === "twinkly" ? "Twinkly's own realtime mode. It isn't official, so this is experimental."
        : isHa(d) ? "Changes go through Home Assistant, so they're slow: a few a second for a light, one a second for a switch"
        : isWled(d) ? "Colours go to the strip over DDP, which WLED listens for with no setup"
        : d.kind === "e131" ? "Colours go straight to the controller's IP over E1.31 (sACN)"
        : "Colours go to the controller over DDP. Turn DDP on in the controller's settings if it has a switch for it.";
      cell(how, "Sent by");
    } else {
      const proto = document.createElement("select");
      for (const [v, label] of Object.entries(PROTOCOLS)) proto.add(new Option(label, v, false, v === (d.protocol || "standard")));
      proto.title = "How colours are sent. If Test only turns the light on, try the next one.";
      proto.addEventListener("change", () => { d.protocol = proto.value; saveDevices(); });
      cell(proto, "Protocol", "How colours are sent. If <b>Test</b> only turns the light on, try the next one.");
    }
    return out;
}

// The Edit light window. Saving swaps in fresh light objects, so it follows the light by id.
const lightEdit = { id: null };

function openLightEditor(d) {
  lightEdit.id = d.id;
  renderLightEditor();
  $("light-dialog").showModal();
}

function renderLightEditor() {
  const d = app.lights[lightEdit.id];
  const dlg = $("light-dialog");
  if (!d) { dlg.close(); return; }
  $("light-title").textContent = d.name;
  const body = $("light-body"), scroll = body.scrollTop;
  const grid = document.createElement("div");
  grid.className = "light-fields";
  for (const f of lightFields(d)) {
    const row = document.createElement("div");
    row.className = "light-field";
    const label = Object.assign(document.createElement("span"), { className: "light-label", textContent: f.label });
    const val = document.createElement("div");
    val.className = "light-value";
    val.append(f.child);
    if (f.hint) val.append(Object.assign(document.createElement("span"), { className: "hint", innerHTML: f.hint }));
    row.append(label, val);
    grid.append(row);
  }
  body.replaceChildren(grid);
  if (!isHa(d)) {
    const parts = partsPanel(d);
    parts.classList.add("light-parts");
    body.append(parts);
  }
  body.scrollTop = scroll;
  const test = $("light-test");
  test.disabled = !linked(d);
  test.title = linked(d) ? "" : plannedTip(d);
}

// Moves light `d` to position `to` in the list. Every show's tracks follow the list's order.
function moveDevice(d, to) {
  const list = app.deviceList.filter((x) => x !== d);
  to = Math.max(0, Math.min(to, list.length));
  list.splice(to, 0, d);
  if (list.every((x, i) => x === app.deviceList[i])) return;
  app.deviceList = list;
  saveDevices();
}

// A drag handle and up and down buttons. Rows take a drop above or below.
const deviceDrag = { from: null };
function orderControls(d) {
  const box = document.createElement("span");
  box.className = "order";
  const grip = document.createElement("span");
  grip.className = "grip";
  grip.textContent = "⠿";
  grip.title = "Drag to reorder";
  grip.draggable = true;
  grip.addEventListener("dragstart", (e) => {
    deviceDrag.from = d;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", d.id);
    e.dataTransfer.setDragImage(grip.closest("tr"), 10, 10);
  });
  grip.addEventListener("dragend", () => { deviceDrag.from = null; dropMarks(); });
  const i = app.deviceList.indexOf(d);
  const up = button("↑", () => moveDevice(d, i - 1), "ghost small");
  const down = button("↓", () => moveDevice(d, i + 1), "ghost small");
  up.title = "Move up"; down.title = "Move down";
  up.disabled = i === 0;
  down.disabled = i === app.deviceList.length - 1;
  const arrows = document.createElement("span");
  arrows.className = "arrows";
  arrows.append(up, down);
  box.append(grip, arrows);
  return box;
}

const dropMarks = (keep) => {
  for (const r of document.querySelectorAll("#device-rows .drop-above, #device-rows .drop-below")) {
    if (r !== keep) r.classList.remove("drop-above", "drop-below");
  }
};

// Drops onto the device row `tr`: above the light if in its top half, else below.
function dropTarget(tr, d) {
  const rowsOf = () => [tr, null];
  const where = (e) => {
    const [top, bottom] = rowsOf();
    const a = top.getBoundingClientRect().top, b = (bottom || top).getBoundingClientRect().bottom;
    return e.clientY < (a + b) / 2 ? "above" : "below";
  };
  for (const el of rowsOf().filter(Boolean)) {
    el.addEventListener("dragover", (e) => {
      if (!deviceDrag.from) return;
      e.preventDefault();
      const above = where(e) === "above";
      dropMarks(tr);
      tr.classList.toggle("drop-above", above);
      tr.classList.toggle("drop-below", !above);
    });
    el.addEventListener("drop", (e) => {
      const from = deviceDrag.from;
      if (!from) return;
      e.preventDefault();
      dropMarks();
      const list = app.deviceList.filter((x) => x !== from);
      moveDevice(from, list.indexOf(d) + (where(e) === "above" ? 0 : 1));
    });
  }
}

// Runs of segments (1-based, inclusive) that no part covers.
function unusedRuns(d) {
  const used = new Uint8Array(d.segments + 2);
  for (const p of d.parts || []) for (let s = p.from; s <= p.to; s++) used[s] = 1;
  const runs = [];
  for (let s = 1; s <= d.segments; s++) {
    if (used[s]) continue;
    const from = s;
    while (s < d.segments && !used[s + 1]) s++;
    runs.push([from, s]);
  }
  return runs;
}

const runText = (runs) => runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");

// Parts split a light into pieces that each get their own track, like a roof line that runs
// round a corner. Segments outside every part stay off in shows.
function partsPanel(d) {
  const tr = document.createElement("section");
  const td = tr;
  const parts = d.parts || [];
  const add = () => {
    // The first gap after the last part, so parts go on round the light in order.
    const runs = unusedRuns(d), end = Math.max(0, ...parts.map((p) => p.to));
    const run = runs.find(([a]) => a > end) || runs[0];
    if (!run) { status("Every segment is already in a part", "hint"); return; }
    let n = 1;
    while (parts.some((p) => p.id === `p${n}` || p.name === `Part ${n}`)) n++;
    d.parts = [...parts, { id: `p${n}`, name: `Part ${n}`, from: run[0], to: run[1] }].sort((a, b) => a.from - b.from);
    saveDevices();
  };
  const fromWled = isWled(d) && d.ip ? button("Use WLED segments", () => useWledSegments(d), "ghost small") : null;
  if (fromWled) fromWled.title = "Make a part from each segment you've set up in WLED, with its name and LEDs";
  if (!parts.length) {
    const b = button("Split into parts…", add, "ghost small");
    b.title = "Give stretches of this light their own tracks, and leave segments you can't see off";
    td.append(b);
    if (fromWled) td.append(" ", fromWled);
    return tr;
  }
  // One part per line, with a map of the light's segments: each part in its colour, unused ones grey.
  const panel = document.createElement("div");
  panel.className = "parts-panel";
  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Parts";
  const map = document.createElement("div");
  map.className = "parts-map";
  map.title = "Where each part sits on the light. Grey segments are unused and stay off.";
  const list = document.createElement("div");
  list.className = "parts-list";
  panel.append(label, map, list);
  td.append(panel);
  const colourOf = (k) => `rgb(${partRgb(k).join()})`;
  for (let s = 1; s <= d.segments; s++) {
    const cell = document.createElement("span");
    const k = parts.findIndex((p) => p.from <= s && s <= p.to);
    if (k >= 0) cell.style.background = colourOf(k);
    map.append(cell);
  }
  parts.forEach((p, k) => {
    const chip = document.createElement("div");
    chip.className = "part-chip";
    const swatch = document.createElement("span");
    swatch.className = "part-swatch";
    swatch.style.background = colourOf(k);
    const name = document.createElement("input");
    Object.assign(name, { value: p.name, size: 10, maxLength: 40, title: "The part's name on the timeline" });
    name.addEventListener("change", () => { p.name = name.value.trim() || p.name; saveDevices(); });
    const num = (key) => {
      const el = document.createElement("input");
      Object.assign(el, { type: "number", min: 1, max: d.segments, value: p[key], className: "seg-num",
        title: key === "from" ? "First segment, counted from the start of the show" : "Last segment" });
      el.addEventListener("change", () => {
        const v = Math.round(Number(el.value));
        const next = { ...p, [key]: v };
        const clash = parts.find((o) => o !== p && o.from <= next.to && next.from <= o.to);
        if (!(v >= 1 && v <= d.segments) || next.from > next.to) {
          status(`Segments run from 1 to ${d.segments}, and a part's first comes before its last`, "hint");
        } else if (clash) {
          status(`That overlaps ${clash.name}`, "hint");
        } else {
          p[key] = v;
          d.parts.sort((a, b) => a.from - b.from);
          saveDevices();
          return;
        }
        el.value = p[key];
      });
      return el;
    };
    const del = button("✕", () => {
      d.parts = parts.filter((o) => o !== p);
      saveDevices();
    }, "ghost small");
    del.title = `Remove ${p.name}. Its clips stay in your shows.`;
    const test = button("Test", async () => {
      if (await testLight(d, p.id)) status(`${p.name} is lit for a minute, white at its first segment. Change its segments to move it.`);
    }, "ghost small");
    test.title = "Light just this part on the real light, so you can see where it starts and ends";
    test.disabled = !linked(d) || d.protocol === "whole";
    const count = document.createElement("span");
    count.className = "hint";
    count.textContent = `${p.to - p.from + 1} segments`;
    chip.append(swatch, name, " segments ", num("from"), "–", num("to"), count, test, del);
    list.append(chip);
  });
  const more = button("+ Add part", add, "ghost small");
  more.disabled = !unusedRuns(d).length;
  const asOne = document.createElement("label");
  asOne.className = "part-whole";
  asOne.title = "Give the light its own track too, playing across all its parts as one strip. Turn off if you only use the parts.";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = d.whole !== false;
  box.addEventListener("change", () => { d.whole = box.checked; saveDevices(); });
  asOne.append(box, " Also play as one");
  const unused = unusedRuns(d);
  const note = document.createElement("span");
  note.className = "hint";
  note.textContent = unused.length ? `Unused, off in shows: ${runText(unused)}` : "Every segment is in a part";
  const foot = document.createElement("div");
  foot.className = "parts-foot";
  const testAll = button("Test parts", async () => {
    if (await testLight(d, "parts")) status(`${d.name}'s parts are lit in their colours for a minute, each white at its first segment`);
  }, "ghost small");
  testAll.title = "Light every part in its colour on the real light, with unused segments off";
  testAll.disabled = !linked(d) || d.protocol === "whole";
  const stop = button("Stop", () => stopTest(d), "ghost small");
  stop.title = "Let the light go back to what it was doing";
  stop.disabled = !linked(d);
  foot.append(more, testAll, stop);
  if (fromWled) foot.append(fromWled);
  foot.append(asOne, note);
  panel.append(foot);
  return tr;
}

// Find segments: light one segment at a time and halve the range on each answer. A light with
// fewer segments than the frame has nowhere to show the white one, so "anything lit?" can be
// answered with the light still on its reel.
const finder = { device: null, lo: 1, hi: 128, max: 128, guess: 0, steps: 0, busy: false };

async function probe(segment, d = finder.device) {
  return api("api/devices/probe", { method: "POST", json: { ...d, segment } });
}

// Shown in a window so the questions are in front of you, wherever the light's row is on the page.
function finderView(state, text) {
  const asking = state === "asking";
  $("finder-question").textContent = text;
  $("finder-question").className = state === "error" ? "hint error" : "";
  $("finder-yes").hidden = $("finder-no").hidden = !asking;
  $("finder-yes").disabled = $("finder-no").disabled = state === "busy";
  if (state === "busy") $("finder-yes").hidden = $("finder-no").hidden = false;
  $("finder-cancel").hidden = state === "done" || state === "error";
  $("finder-done").hidden = !(state === "done" || state === "error");
  $("finder-note").hidden = !(asking || state === "busy");
}

async function findSegments(d) {
  if (finder.device) await stopFinder();
  Object.assign(finder, { device: d, lo: 1, hi: 128, steps: 0, busy: false });
  $("finder-title").textContent = `Find segments on ${d.name}`;
  $("finder-progress").textContent = "";
  $("finder-bar").hidden = true;
  finderView("busy", `Connecting to ${d.name}…`);
  if (!$("finder").open) $("finder").showModal();
  try {
    const { max } = await probe(1);
    finder.hi = finder.max = max;
  } catch (e) {
    finder.device = null;
    finderView("error", `Couldn't reach ${d.name}: ${e.message}. Check it's switched on, then try again.`);
    return;
  }
  // Segment 1 always exists, so the first real question is the middle of the range.
  await askFinder();
}

async function askFinder() {
  if (finder.lo >= finder.hi) return finishFinder();
  finder.guess = Math.ceil((finder.lo + finder.hi) / 2);
  finder.steps++;
  const left = Math.ceil(Math.log2(finder.hi - finder.lo + 1));
  $("finder-progress").textContent = `Question ${finder.steps} of about ${finder.steps + left - 1}`;
  $("finder-bar").hidden = false;
  $("finder-bar").firstElementChild.style.width = `${Math.round(100 * (finder.steps - 1) / (finder.steps + left - 1))}%`;
  finderView("busy", "Lighting one segment…");
  try {
    await probe(finder.guess);
    finderView("asking", "One segment is lit white and everything else is off. Can you see any light on it?");
  } catch (e) {
    await stopFinder(false);
    finderView("error", `Find stopped: ${e.message}`);
  }
}

async function answerFinder(lit) {
  if (!finder.device || finder.busy) return;
  finder.busy = true;
  if (lit) finder.lo = finder.guess; else finder.hi = finder.guess - 1;
  await askFinder();
  finder.busy = false;
}

async function finishFinder() {
  const d = finder.device;
  const stretched = finder.lo === finder.max;
  await stopFinder(false);
  d.segments = finder.lo;
  await saveDevices();
  renderDevices();
  $("finder-progress").textContent = "";
  $("finder-bar").firstElementChild.style.width = "100%";
  finderView("done", stretched
    ? `${d.name} lit every segment asked for, so it may stretch the colours itself. Segments is set to ${finder.lo}: press Test to check.`
    : `${d.name} has ${finder.lo} segments. Segments is set to ${finder.lo}.`);
}

async function stopFinder(close = true) {
  if (close && $("finder").open) $("finder").close();
  if (!finder.device) return;
  const d = finder.device;
  finder.device = null;
  try { await probe(0, d); } catch { /* the light falls back to its own scene within a minute anyway */ }
}

$("light-dialog").addEventListener("click", async (e) => {
  const what = e.target.closest("[data-light]")?.dataset.light;
  const d = app.lights[lightEdit.id];
  if (what === "close" || !d) $("light-dialog").close();
  else if (what === "test") { if (await testLight(d)) status(`Testing ${d.name} for 20 seconds`); }
  else if (what === "remove") {
    if (!confirm(`Remove ${d.name}? Its clips stay in your shows.`)) return;
    $("light-dialog").close();
    app.deviceList = app.deviceList.filter((x) => x.id !== d.id);
    saveDevices();
  }
});
$("finder-yes").addEventListener("click", () => answerFinder(true));
$("finder-no").addEventListener("click", () => answerFinder(false));
$("finder").addEventListener("click", (e) => {
  if (e.target.closest("[data-finder]")) stopFinder();
});
// Escape closes the window; make sure the light is let go too.
$("finder").addEventListener("close", () => { if (finder.device) stopFinder(false); });

// Govee models ------------------------------------------------------------------
async function loadModels() {
  try {
    const { models } = await (await fetch("static/models.json")).json();
    app.models = Object.fromEntries(models.map((m) => [m.sku, m]));
    const list = $("model-list");
    for (const m of models) list.append(new Option(`${m.sku} ${m.name}${m.status ? "" : " (untested)"}`, m.sku));
    list.append(new Option("WLED strip", "WLED"), new Option("Pixel controller (DDP)", "DDP"),
      new Option("Pixel controller (E1.31)", "E1.31"), new Option("Home Assistant light or switch", "HA"),
      new Option("Twinkly (experimental)", "Twinkly"));
    renderDevices();
    timeline.draw(); // lights' notes on the timeline come from the models
  } catch { /* the picker is a convenience; manual entry still works */ }
}

const isWled = (d) => d?.kind === "wled";
const isHa = (d) => d?.kind === "ha";
// Whether a light has somewhere to send to: an IP, or a Home Assistant entity (output.linked).
const linked = (d) => !!(d?.ip || d?.entity);
// Why Test can't be pressed yet, for a planned light.
const plannedTip = (d) => isHa(d) ? "Pick its Home Assistant light under Edit to test it"
  : "Add its IP address under Edit to test it";

// Home Assistant's lights and switches, fetched once when first needed (server.py ha_entities).
let haEntities = null;
async function loadHaEntities() {
  if (!haEntities) haEntities = await api("api/ha/entities");
  return haEntities;
}

// The add functions below are used by the Add a light window: each returns what to tell the user,
// or throws with the reason it couldn't be added.
function addHaLight(entity) {
  const found = (haEntities || []).find((e) => e.entity === entity);
  if (!found) throw new Error("Pick a light or switch first");
  if (app.deviceList.some((d) => d.entity === entity)) throw new Nudge(`${found.name} is already on the list`);
  app.deviceList.push({ id: `ha-${entity}`, kind: "ha", name: found.name, ip: "", entity, sku: "",
    protocol: entity.startsWith("switch.") ? "ha_switch" : "ha_light", segments: 1, bulbs: 1,
    reverse: false, gradient: false, brightness: 100 });
  saveDevices();
  return `Added ${found.name}. ${entity.startsWith("switch.") ? "It turns on when the show is bright there, at most once a second." : "It takes the show's colour a few times a second."}`;
}

async function fillHaPicker(select, current = "") {
  select.replaceChildren(new Option("Loading…", ""));
  try {
    const list = await loadHaEntities();
    select.replaceChildren(new Option(current ? "Not linked" : "Pick a light or switch", ""),
      ...list.map((e) => new Option(`${e.name} (${e.entity})`, e.entity, false, e.entity === current)));
    if (current && !list.some((e) => e.entity === current)) select.add(new Option(`${current} (not found)`, current, false, true));
  } catch (e) {
    select.replaceChildren(new Option(current || "Home Assistant isn't reachable", current));
    status(`Couldn't list Home Assistant's lights: ${e.message}`, true);
  }
}
const isPixels = (d) => ["wled", "ddp", "e131", "twinkly"].includes(d?.kind); // one LED a segment, not a Govee light

// Twinkly (experimental): asks the light for its name and LED count, like WLED.
async function addTwinkly(ip) {
  if (app.deviceList.some((d) => d.ip === ip)) throw new Nudge(`${ip} is already on the list`);
  {
    const t = await api("api/twinkly/info", { method: "POST", json: { ip } })
      .catch((e) => { throw new Error(`Couldn't reach a Twinkly light there: ${e.message}`); });
    const segments = Math.min(t.leds, t.max);
    app.deviceList.push({ id: `twinkly-${ip}`, kind: "twinkly", name: t.name, ip, sku: "", protocol: "twinkly",
      segments, bulbs: segments, reverse: false, gradient: false, brightness: 100 });
    saveDevices();
    return `Added ${t.name}: ${segments} LEDs. Twinkly support is experimental, so press Test to check it.`;
  }
}

// A pixel controller: no API to ask, so the LED count comes from the form. A second light on the same
// controller starts just after the last one.
function addController(ip, leds, kind = "ddp") {
  const segments = Math.min(Math.max(Math.round(leds) || 50, 1), 1000);
  const n = app.deviceList.filter((d) => d.kind === kind && d.ip === ip).length + 1;
  const name = `Pixels ${ip.split(".").pop()}${n > 1 ? ` (${n})` : ""}`;
  const light = { id: controllerId(app.deviceList, ip, kind), kind, name, ip, sku: "", protocol: kind, segments,
    bulbs: segments, reverse: false, gradient: false, brightness: 100 };
  let where;
  if (kind === "e131") {
    Object.assign(light, nextUniverse(app.deviceList, ip));
    where = `universe ${light.universe}, channel ${light.channel}`;
  } else {
    light.first = nextFirstLed(app.deviceList, ip);
    where = `LED ${light.first}`;
  }
  app.deviceList.push(light);
  saveDevices();
  return `Added ${segments} LEDs on ${ip}, starting at ${where}. Press Test to check them.`;
}
// Protocols that aren't limited to 255 segments a light.
const LONG_PROTOCOLS = ["whole", "segments", "pixels", "ddp", "e131"];

// Asks a WLED light for its name, LED count and segments (server.py wled_info).
async function wledInfo(ip) {
  const info = await api("api/wled/info", { method: "POST", json: { ip } });
  if (info.leds > info.max) status(`${info.name} has ${info.leds} LEDs; shows can drive the first ${info.max}`, "hint");
  return { ...info, leds: Math.min(info.leds, info.max) };
}

async function addWled(ip) {
  if (app.deviceList.some((d) => d.ip === ip)) throw new Nudge(`${ip} is already on the list`);
  {
    const w = await wledInfo(ip).catch((e) => { throw new Error(`Couldn't reach a WLED light there: ${e.message}`); });
    app.deviceList.push({ id: `wled-${ip}`, kind: "wled", name: w.name, ip, sku: "", protocol: "ddp",
      segments: w.leds, bulbs: w.leds, reverse: false, gradient: false, brightness: 100, parts: w.parts });
    saveDevices();
    return `Added ${w.name}: ${w.leds} LEDs${w.parts.length ? `, with ${w.parts.length} parts from its WLED segments` : ""}.`;
  }
}

// Replaces a WLED light's parts with its WLED segments. Part ids follow WLED's segment ids, so clips
// on a part stay with it when the segments are fetched again.
async function useWledSegments(d) {
  try {
    const w = await wledInfo(d.ip);
    if (!w.parts.length) { status(`${d.name} has only one segment in WLED, so there's nothing to split`, "hint"); return; }
    if (d.parts?.length && !confirm(`Replace ${d.name}'s parts with its ${w.parts.length} WLED segments? Clips on parts that disappear stay in your shows.`)) return;
    d.segments = w.leds;
    d.parts = w.parts;
    saveDevices();
    status(`${d.name} now has ${w.parts.length} parts: ${w.parts.map((p) => p.name).join(", ")}`);
  } catch (e) { status(`Couldn't read ${d.name}'s segments: ${e.message}`, true); }
}

// Lights accept different forms of the realtime packet. See protocol.py.
const PROTOCOLS = {
  standard: "Realtime",
  razer: "Realtime (Razer)",
  v2: "Realtime v2",
  whole: "Whole light only",
  segments: "App segments (experimental)",
  pixels: "Per bulb (experimental)",
};

const skuOf = (text) => (text || "").trim().split(/\s+/)[0].toUpperCase();

// A small marker saying what we know about the model on real lights (models.js).
function modelBadge(sku) {
  const m = app.models[skuOf(sku)];
  const span = document.createElement("span");
  if (!m) return span;
  const s = STATUS[statusOf(m)];
  span.className = `badge ${s.cls}`;
  span.textContent = s.badge;
  span.title = modelSummary(m);
  return span;
}

function addPlanned() {
  const name = $("plan-name").value.trim();
  if (!name) throw new Error("Give it a name, as it'll appear on the timeline");
  const base = `planned-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "light"}`;
  let id = base;
  for (let n = 2; app.devices[id]; n++) id = `${base}-${n}`;
  const model = app.models[skuOf($("plan-model").value)];
  const segments = Math.max(1, Math.round(Number($("plan-segments").value)) || 15);
  const kind = { WLED: "wled", DDP: "ddp", "E1.31": "e131", HA: "ha", TWINKLY: "twinkly" }[skuOf($("plan-model").value)];
  if (kind === "ha") {
    app.deviceList.push({ id, name, kind, ip: "", entity: "", sku: "", protocol: "ha_light", segments: 1, bulbs: 1,
      reverse: false, gradient: false, brightness: 100 });
  } else if (kind) {
    const where = { ddp: { first: 1 }, e131: { universe: 1, channel: 1 } }[kind] || {};
    app.deviceList.push({ id, name, kind, ip: "", sku: "", protocol: { e131: "e131", twinkly: "twinkly" }[kind] || "ddp", segments,
      bulbs: segments, reverse: false, gradient: false, brightness: 100, ...where });
  } else {
    app.deviceList.push(newLight(model, { id, name, ip: "", sku: model ? model.sku : "", segments }));
  }
  saveDevices();
  return `Added ${name} as a planned light. Build shows with it now; when it arrives, type its IP into its row.`;
}

// The Add a light window: pick what kind of light, then fill in what that kind needs, then done.
const ADD_KINDS = {
  govee: { title: "Govee light", ip: true,
    help: "Switch on <b>LAN Control</b> for the light in the Govee Home app first. Then scan for it, or type its IP." },
  wled: { title: "WLED strip", ip: true,
    help: "Scan for it, or type its IP (it's on the WLED app's <b>Info</b> page). Its name and LEDs are filled in for you, and any segments you've set up in WLED become its <b>parts</b>." },
  ddp: { title: "Pixel controller (DDP)", ip: true, leds: true,
    help: "Falcon Player, ESPixelStick, ESPHome, Tasmota or an ESP32: turn on DDP in the controller's settings if it has a switch for it. Add each string separately; the next one on the same controller starts just after the last." },
  e131: { title: "Pixel controller (E1.31)", ip: true, leds: true,
    help: "Set the controller to take E1.31 (sACN) as <b>unicast</b>. Add each string separately; the next one starts just after the last, and you can change its <b>universe</b> and <b>channel</b> in its row." },
  ha: { title: "Home Assistant light or switch", entity: true,
    help: "Any light, or a switch such as a smart plug for an inflatable. Lights take the show's colour a few times a second; switches turn on when the show is bright, at most once a second. They go back as they were afterwards." },
  twinkly: { title: "Twinkly (experimental)", ip: true,
    help: "Type the light's IP (it's in the Twinkly app under <b>Device settings</b>). Twinkly support hasn't been tried on a real light yet, so press <b>Test</b> once it's added." },
  plan: { title: "Plan a light", plan: true,
    help: "Build shows with it now. Pick the <b>model</b> if you know it: ✓ means it's known to work, ? that it's untested, so Test one before buying more. Segment counts aren't published, so 15 is a guess. When it arrives, scan and choose <b>Link to</b>, or type its IP into its row." },
};
const addFlow = { kind: null };

function addStep(step) {
  const dlg = $("add-dialog");
  for (const sec of dlg.querySelectorAll("[data-step]")) sec.hidden = sec.dataset.step !== step;
  const k = ADD_KINDS[addFlow.kind];
  $("add-title").textContent = step === "kind" ? "Add a light" : k.title;
  $("add-steps").textContent = `Step ${{ kind: 1, details: 2, done: 3 }[step]} of 3`;
  dlg.querySelector('[data-add="back"]').hidden = step !== "details";
  $("add-cancel").hidden = step === "done";
  $("add-go").hidden = step !== "details";
  dlg.querySelector('[data-add="again"]').hidden = step !== "done";
  $("add-finish").hidden = step !== "done";
  $("add-error").hidden = true;
  if (step !== "details") return;
  $("add-help").innerHTML = k.help;
  $("add-scan").hidden = !["govee", "wled"].includes(addFlow.kind);
  $("add-ip-field").hidden = !k.ip;
  $("add-leds-field").hidden = !k.leds;
  $("add-entity-field").hidden = !k.entity;
  $("add-plan-fields").hidden = !k.plan;
  $("add-go").textContent = addFlow.kind === "plan" ? "Add planned light" : "Add";
  $("scan-results").replaceChildren();
  if (k.entity) fillHaPicker($("add-entity"));
  const first = k.plan ? $("plan-model") : k.entity ? $("add-entity") : $("add-ip");
  setTimeout(() => first.focus(), 0);
}

function openAddLight() {
  addFlow.kind = null;
  for (const id of ["add-ip", "plan-name", "plan-model"]) $(id).value = "";
  $("plan-segments").value = 15;
  $("plan-segments").max = 255;
  $("plan-info").replaceChildren();
  addStep("kind");
  $("add-dialog").showModal();
}

async function addLightNow() {
  const k = ADD_KINDS[addFlow.kind], ip = $("add-ip").value.trim();
  const go = $("add-go");
  $("add-error").hidden = true;
  try {
    if (k.ip && !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error("Type the light's IP address, like 192.168.1.50");
    go.disabled = true;
    go.textContent = "Adding…";
    const said = await {
      govee: () => addDevice({ id: ip, ip, sku: "" }),
      wled: () => addWled(ip),
      ddp: () => addController(ip, Number($("add-leds").value), "ddp"),
      e131: () => addController(ip, Number($("add-leds").value), "e131"),
      ha: () => addHaLight($("add-entity").value),
      twinkly: () => addTwinkly(ip),
      plan: () => addPlanned(),
    }[addFlow.kind]();
    $("add-done").textContent = said;
    addStep("done");
  } catch (e) {
    $("add-error").textContent = e.message;
    $("add-error").hidden = false;
  } finally {
    go.disabled = false;
    go.textContent = addFlow.kind === "plan" ? "Add planned light" : "Add";
  }
}

function planModelChanged() {
  const m = app.models[skuOf($("plan-model").value)];
  const info = $("plan-info");
  info.replaceChildren();
  if (skuOf($("plan-model").value) === "HA") {
    info.append(" A Home Assistant light or plug: pick it in its row once it's set up in Home Assistant.");
    return;
  }
  if (["WLED", "DDP", "E1.31", "TWINKLY"].includes(skuOf($("plan-model").value))) {
    $("plan-segments").max = 1000;
    const what = { WLED: "WLED strip", TWINKLY: "Twinkly light (experimental)" }[skuOf($("plan-model").value)] || "pixel controller light";
    info.append(` A ${what}: set Segments to its number of LEDs.`);
    return;
  }
  if (!m) return;
  if (!$("plan-name").value) $("plan-name").value = m.name.replace(/^Govee\s+/, "");
  const light = newLight(m, {});
  $("plan-segments").max = LONG_PROTOCOLS.includes(light.protocol) ? 1000 : 255;
  if (m.segments) $("plan-segments").value = m.segments;
  info.append(modelBadge(m.sku), m.segments
    ? ` Starts on ${PROTOCOLS[light.protocol]} with ${m.segments} segments.`
    : " Segment count unknown: 15 is a guess, check it with Test when it arrives.");
  if (m.note) info.append(` ${m.note}`);
}

function button(label, onclick, cls = "") {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = cls;
  b.addEventListener("click", onclick);
  return b;
}

function addDevice(found) {
  if (app.devices[found.id] || app.deviceList.some((d) => d.ip && d.ip === found.ip)) throw new Nudge(`${found.ip} is already on the list`);
  const name = `${found.sku || "Govee"} ${found.ip.split(".").pop()}`;
  app.deviceList.push(newLight(app.models[skuOf(found.sku)], { id: found.id, name, ip: found.ip, sku: found.sku || "" }));
  saveDevices();
  return `Added ${name}. Next, set its Segments with Find or Test.`;
}

async function scan() {
  const box = $("scan-results");
  box.textContent = "Scanning…";
  try {
    const found = await api("api/devices/scan", { method: "POST" });
    box.replaceChildren();
    if (!found.length) {
      box.innerHTML = `<p class="hint">No lights answered. Check <b>LAN Control</b> is on in the Govee Home app and
        that they're on the same network as HA-liday Show.</p>`;
      return;
    }
    for (const f of found) {
      const row = document.createElement("div");
      row.className = "scan-row";
      row.append(`${f.sku || "Govee"} at ${f.ip}`, modelBadge(f.sku));
      const known = app.devices[f.id] || app.deviceList.find((d) => d.ip === f.ip);
      if (known) { row.append(` (${known.name})`); box.append(row); continue; }
      row.append(button("Add", () => {
        try { addDevice(f); row.replaceChildren(`${f.sku || "Govee"} at ${f.ip} (added)`); } catch (e) { status(e.message, errorKind(e)); }
      }));
      const planned = app.deviceList.filter((d) => !d.ip && (d.kind || "govee") === "govee");
      if (planned.length) {
        const sel = document.createElement("select");
        for (const p of planned) sel.add(new Option(p.name, p.id));
        row.append(" or ", button("Link to", () => {
          const p = app.lights[sel.value];
          Object.assign(p, { ip: f.ip, sku: f.sku || p.sku });
          saveDevices();
          row.replaceChildren(`${f.sku || "Govee"} at ${f.ip} (${p.name})`);
        }), sel);
      }
      box.append(row);
    }
  } catch (e) { box.textContent = ""; status(`Scan failed: ${e.message}`, true); }
}

// WLED lights announce themselves on the network (server.py wled_scan); each found one can be added.
async function scanWled() {
  const box = $("scan-results");
  box.textContent = "Scanning…";
  try {
    const { found } = await api("api/wled/scan", { method: "POST" });
    box.replaceChildren();
    if (!found.length) {
      box.innerHTML = `<p class="hint">No WLED lights answered. Check they're switched on and on the same network as
        HA-liday Show.</p>`;
      return;
    }
    for (const f of found) {
      const row = document.createElement("div");
      row.className = "scan-row";
      const label = `${f.name} at ${f.ip}, ${f.leds} LEDs`;
      row.append(label);
      const known = app.deviceList.find((d) => d.ip === f.ip);
      if (known) { row.append(` (${known.name})`); box.append(row); continue; }
      row.append(button("Add", async () => {
        try { await addWled(f.ip); row.replaceChildren(`${label} (added)`); } catch (e) { status(e.message, errorKind(e)); }
      }));
      box.append(row);
    }
  } catch (e) { box.textContent = ""; status(`Scan failed: ${e.message}`, true); }
}

// preview -------------------------------------------------------------------
const preview = $("preview");
const pctx = preview.getContext("2d");
const ROW_H = 26, LABEL_W = 140;

function previewTracks() {
  return app.show.tracks.filter(playingDev);
}

function layoutPreview() {
  const rows = Math.max(previewTracks().length, 1);
  const dpr = window.devicePixelRatio || 1;
  const w = preview.clientWidth || 600, h = rows * ROW_H;
  preview.style.height = `${h}px`;
  preview.width = Math.round(w * dpr);
  preview.height = Math.round(h * dpr);
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawPreview() {
  const w = preview.clientWidth;
  pctx.clearRect(0, 0, w, preview.height);
  const tracks = previewTracks();
  pctx.font = "12px system-ui, sans-serif";
  if (!tracks.length) {
    pctx.fillStyle = "#888";
    pctx.fillText("Add devices under Setup → Devices to see a preview here.", 4, 17);
    return;
  }
  const pos = housePositions(), composed = {};
  tracks.forEach((tr, row) => {
    const dev = app.devices[tr.device];
    const rgb = previewFrame(tr, dev, pos, composed);
    const n = dev.segments;
    const cap = (dev.brightness ?? 100) / 100;
    if (cap < 1) for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(rgb[i] * cap);
    const y = row * ROW_H;
    pctx.fillStyle = "#aaa";
    pctx.fillText(dev.name, 4, y + 17, LABEL_W - 10);
    const bw = (w - LABEL_W) / n;
    for (let i = 0; i < n; i++) {
      pctx.fillStyle = `rgb(${rgb[i * 3]},${rgb[i * 3 + 1]},${rgb[i * 3 + 2]})`;
      pctx.fillRect(LABEL_W + i * bw + 1, y + 3, Math.max(bw - 2, 1), ROW_H - 6);
    }
  });
}

new ResizeObserver(layoutPreview).observe(preview);

// house view ------------------------------------------------------------------
const house = new House({
  api, status,
  frameFor(dev) {
    if (!dev.parent) return shownFrame(dev, housePositions());
    return shownFrame(app.lights[dev.parent], housePositions()).slice((dev.from - 1) * 3, dev.to * 3);
  },
});
house.hiddenLights = new Set(prefs.get("house.hiddenLights", []));

// The House lane: its clips, and where each light's segments sit for them.
const houseClips = () => app.show.tracks.find((t) => t.device === HOUSE)?.clips || [];
const isHouse = (i) => app.show.tracks[i]?.device === HOUSE;
// House effects go on the House lane and nowhere else; light effects everywhere but.
const fitsTrack = (effect, i) => !!EFFECTS[effect]?.house === isHouse(i);

// Whether clips suit their lights (compat.js). A long show on a Per bulb light takes a while to
// check, so the timeline and effect chooser get theirs in the background (pass `then`), and every
// answer is remembered until the clip or the light changes. Nothing is saved with the show.
const ALLOW_UNFIT = "allowUnfit";
const allowUnfit = () => prefs.get(ALLOW_UNFIT, false);
const fitMemo = new Map(), fitJobs = new Map();
let fitTimer = null;

function fitContext(i) {
  if (!isHouse(i)) return { dev: app.devices[app.show.tracks[i]?.device], opts: {} };
  const pos = housePositionsAll();
  const lights = houseLights().map((d) => ({ name: d.name, placed: !!pos[d.id], positions: pos[d.id] || null,
    device: { protocol: d.protocol, segments: d.segments } }));
  return { dev: null, opts: { house: { lights } } };
}

// A short stand-in for the House lane's lights in a remembered fit: their settings, and a sum over
// their traced positions, so retracing a light checks again without keying on every point.
function houseKey(house) {
  return house?.lights.map((l) => {
    let sum = 0;
    for (const q of l.positions || []) if (q) sum += q[0] * 7 + q[1] * 13;
    return [l.name, l.placed, l.device.protocol, l.positions?.length || 0, Math.round(sum * 1000)];
  });
}

function remember(key, fit) {
  if (fitMemo.size > 5000) fitMemo.clear();
  fitMemo.set(key, fit);
  return fit;
}

// The fit of `clip` on `dev`: worked out now, or with `then`, null and then(fit) once it's ready.
function fitFor(clip, dev, opts = {}, then = null) {
  const { start, end, ...rest } = clip;
  const key = JSON.stringify([rest, end - start, dev && [dev.protocol, dev.segments, linked(dev), dev.sku || ""], houseKey(opts.house)]);
  if (fitMemo.has(key)) return fitMemo.get(key);
  if (!then) return remember(key, clipFit(clip, dev, opts));
  const copy = { ...clip };
  const job = fitJobs.get(key) || { run: () => clipFit(copy, dev, opts), then: [] };
  job.then.push(then);
  fitJobs.set(key, job);
  fitTimer ??= setTimeout(runFits, 0);
  return null;
}

function runFits() {
  const until = performance.now() + 12;
  for (const [key, job] of fitJobs) {
    fitJobs.delete(key);
    const fit = remember(key, job.run());
    for (const then of job.then) then(fit);
    if (performance.now() > until) break;
  }
  fitTimer = fitJobs.size ? setTimeout(runFits, 0) : null;
}

const clipFitOn = (clip, i, then = null) => {
  const { dev, opts } = fitContext(i);
  return fitFor(clip, dev, opts, then);
};

// The fit of an effect added to several tracks at once: it won't work only if it won't work on any of
// them, and is limited where it's left off some.
function fitAcross(clip, tracks, then = null) {
  const ts = tracks.filter((t) => fitsTrack(clip.effect, t));
  const fits = ts.map(() => null);
  const combine = () => {
    if (ts.length <= 1) return fits[0] || { level: "ok", reasons: [] };
    const no = ts.filter((_, k) => fits[k].level === "no");
    if (no.length === ts.length) return { level: "no", reasons: [`Won't work on any of these lights. ${fits[0].reasons[0]}`] };
    if (no.length) return { level: "limited", reasons: [`Won't work on ${no.map(trackName).join(", ")}, so it's left off.`] };
    const w = worst(fits);
    return w.level === "ok" ? w : { level: w.level, reasons: [`On ${trackName(ts[fits.indexOf(w)])}: ${w.reasons[0]}`] };
  };
  let left = ts.length;
  ts.forEach((t, k) => {
    const fit = clipFitOn(clip, t, then && ((f) => { fits[k] = f; if (--left === 0) then(combine()); }));
    if (fit) { fits[k] = fit; left--; }
  });
  return left ? null : combine();
}

const unfit = (clip, i) => !allowUnfit() && clipFitOn(clip, i).level === "no";
const fitText = (fit) => `⚠ ${fit.level === "no" ? "Won't work here. " : ""}${fit.reasons.join(" ")}`;

// The physical light a track plays on, and a note if its realtime mode doesn't reach all of it.
function trackNote(dev) {
  const light = dev && (dev.light || app.lights[dev.parent] || dev);
  return light ? reachNote(light, app.models[skuOf(light.sku)]) : null;
}

let fitRedraw = false;
const redrawForFits = () => {
  if (fitRedraw) return;
  fitRedraw = true;
  requestAnimationFrame(() => { fitRedraw = false; timeline.draw(); });
};
// While a clip is resized its new length is still being checked, so it keeps its last mark meanwhile.
const lastFit = new WeakMap();
app.clipFit = (clip, i) => {
  const fit = clipFitOn(clip, i, redrawForFits);
  if (fit) lastFit.set(clip, fit);
  return fit || lastFit.get(clip) || null;
};
app.trackNote = (dev) => trackNote(dev)?.short || null;

function housePositions() {
  return houseClips().length ? housePositionsAll() : {};
}

// Worked out at most every 100 ms: the preview, House panel and every light's frame share it.
const posMemo = { at: -Infinity, value: {} };
function housePositionsAll() {
  const now = performance.now();
  if (now - posMemo.at > 100) {
    house.devices = houseLights();
    const value = house.positions();
    // A part sits on its slice of the light's traced path.
    for (const d of app.deviceList) {
      for (const p of d.parts || []) if (value[d.id]) value[partId(d, p)] = value[d.id].slice(p.from - 1, p.to);
    }
    Object.assign(posMemo, { at: now, value });
  }
  return posMemo.value;
}

// A light's colours at `time`: its own clips, then the House lane's over them.
function lightFrame(tr, dev, time, pos) {
  const rgb = renderTrack(tr.clips, time, dev.segments);
  if (pos[dev.id]) applyHouse(houseClips(), time, pos[dev.id], rgb);
  return rgb;
}

// A whole physical light's colours, as the show plays it.
function physicalFrame(light, time, pos) {
  return composeLight(light, (id) => app.show.tracks.find((t) => t.device === id), time, pos, houseClips());
}

// What a physical light shows now: stepped (and on Whole light only, one colour) as on the real light.
const shownFrame = (light, pos) => asShown(light, app.time, (t) => physicalFrame(light, t, pos));

// What a preview row shows: for a split light and its parts, their share of what the light
// actually plays (so a part's clip shows over the whole light's). `composed` caches per light.
function previewFrame(tr, dev, pos, composed) {
  const light = dev.light || app.lights[dev.parent];
  if (!light) return asShown(dev, app.time, (t) => lightFrame(tr, dev, t, pos));
  const full = composed[light.id] ??= shownFrame(light, pos);
  if (dev.parent) return full.slice((dev.from - 1) * 3, dev.to * 3);
  return joinParts(light, full);
}

// A split light's parts end to end, from a frame of the whole physical light.
function joinParts(light, full) {
  const out = new Uint8Array(light.parts.reduce((n, p) => n + p.to - p.from + 1, 0) * 3);
  let k = 0;
  for (const p of light.parts) {
    out.set(full.subarray((p.from - 1) * 3, p.to * 3), k);
    k += (p.to - p.from + 1) * 3;
  }
  return out;
}

// The reverse: a strip played across a split light's parts, spread back onto the whole light.
function spreadParts(light, rgb) {
  const out = new Uint8Array(light.segments * 3);
  let k = 0;
  for (const p of light.parts) {
    const n = (p.to - p.from + 1) * 3;
    out.set(rgb.subarray(k, k + n), (p.from - 1) * 3);
    k += n;
  }
  return out;
}

function drawHouse() {
  house.devices = houseLights();
  const panel = $("house");
  if (panel.closest(".panel").offsetParent) house.drawPanel(panel, $("house-hint"));
  if (!$("view-house").hidden) house.drawSetup($("house-setup"));
}

// The stretch picked on the photo, if it's on light `d`: in view, or out of view with how many
// bulbs it holds.
function houseStretchEditor(d) {
  const st = house.active ? null : house.pickedStretch();
  if (st?.id !== d.id) return null;
  const hidden = st.hidden != null;
  const box = document.createElement("div");
  box.className = "house-stretch row";
  const label = document.createElement("span");
  label.textContent = `Stretch from point ${st.i} to ${st.i + 1}:`;
  const pick = (text, on, title, fn) => {
    const b = button(text, fn, on ? "primary" : "");
    b.title = title;
    return b;
  };
  box.append(label,
    pick("In view", !hidden, "Bulbs on this stretch can be seen from the photo", () => {
      house.setHidden(null); renderHouseLights();
    }),
    pick("Out of view", hidden, "This stretch runs where the photo can't see, such as round the back of the house, or is an extension lead", () => {
      house.setHidden(hidden ? st.hidden : 0); renderHouseLights();
    }));
  if (hidden) {
    const n = document.createElement("input");
    n.type = "number";
    n.min = "0";
    n.max = "2000";
    n.value = st.hidden;
    n.title = "0 for an extension lead";
    n.addEventListener("change", () => { house.setHidden(Number(n.value)); renderHouseLights(); });
    const l = document.createElement("label");
    l.append("Bulbs on it ", n);
    box.append(l);
  }
  box.append(button("✕", () => { house.stretch = null; renderHouseLights(); }, "ghost"));
  return box;
}

// The segment number picked on the photo: light that segment on the real light to see where it
// is, and unpin it. Dragging the number along the line pins it (see House.pinBulbs).
function houseSegmentEditor(d) {
  const pick = house.active ? null : house.pinPick;
  if (pick?.id !== d.id) return null;
  const light = app.lights[d.parent || d.id];
  const num = pick.s + (d.from || 1); // counted on the whole light, in show order
  const pinned = house.pins[d.id]?.[pick.s] != null;
  const box = document.createElement("div");
  box.className = "house-stretch row";
  const label = document.createElement("span");
  label.textContent = `Segment ${num}${pinned ? " (pinned)" : ""}`;
  const lightIt = button("Light it", async () => {
    // Find segments lights one segment, counted from the light's own first one.
    const segment = light.reverse ? light.segments + 1 - num : num;
    try {
      await api("api/devices/probe", { method: "POST", json: { ...light, segment } });
      status(`Segment ${num} of ${light.name} is lit white. Drag its number to where it is.`);
    } catch (e) { status(`Couldn't light it: ${e.message}`, true); }
  }, "primary");
  lightIt.title = "Light just this segment on the real light, white, so you can see where it is";
  lightIt.disabled = !linked(light) || light.protocol === "whole";
  const stop = button("Stop", async () => {
    try { await api("api/devices/probe", { method: "POST", json: { ...light, segment: 0 } }); } catch { /* it lets go by itself */ }
  }, "ghost");
  stop.disabled = !linked(light);
  box.append(label, lightIt, stop);
  if (pinned) box.append(button("Unpin", () => { house.unpin(d.id, pick.s); renderHouseLights(); }, "ghost"));
  box.append(button("✕", () => { house.pinPick = null; renderHouseLights(); }, "ghost"));
  return box;
}

// Line, Icicle (how many drops and how far the longest hangs) or Spots (how wide the beams are).
function houseStyleControls(d) {
  const style = house.styles[d.id];
  const sel = document.createElement("select");
  sel.title = "How the light looks on the photo";
  sel.innerHTML = `<option value="line">Line</option><option value="icicle">Icicle</option>
    <option value="spots">Spots</option>`;
  sel.value = style?.style || "line";
  sel.addEventListener("change", () => {
    house.setStyle(d.id, {
      icicle: { style: "icicle", drops: Math.max(d.segments * 3, 10), length: 0.06 },
      spots: { style: "spots", beam: 0.5, aims: [] },
    }[sel.value] || null);
    house.stretch = null;
    renderHouseLights();
  });
  const l0 = document.createElement("label");
  l0.className = "row";
  l0.append("Style ", sel);
  if (!style) return [l0];
  if (style.style === "spots") {
    const beam = document.createElement("input");
    beam.type = "range";
    beam.min = "0.1";
    beam.max = "1.5";
    beam.step = "0.05";
    beam.value = style.beam;
    beam.title = "How wide each spotlight's beam is";
    beam.addEventListener("input", () => { style.beam = Number(beam.value); house.setStyle(d.id, style); });
    const l1 = document.createElement("label");
    l1.className = "row";
    l1.append("Beam ", beam);
    return [l0, l1];
  }
  const drops = document.createElement("input");
  drops.type = "number";
  drops.min = "1";
  drops.max = "2000";
  drops.value = style.drops;
  drops.title = "How many drops hang from the light";
  drops.addEventListener("change", () => {
    house.setStyle(d.id, { ...style, drops: Math.min(Math.max(Math.round(Number(drops.value)) || 1, 1), 2000) });
    renderHouseLights();
  });
  const length = document.createElement("input");
  length.type = "range";
  length.min = "0.01";
  length.max = "0.3";
  length.step = "0.005";
  length.value = style.length;
  length.title = "How far the longest drop hangs on the photo";
  length.addEventListener("input", () => { style.length = Number(length.value); house.setStyle(d.id, style); });
  const l1 = document.createElement("label");
  l1.className = "row";
  l1.append("Drops ", drops);
  const l2 = document.createElement("label");
  l2.className = "row";
  l2.append("Length ", length);
  return [l0, l1, l2];
}

function hint(text) {
  const el = document.createElement("span");
  el.className = "hint";
  el.textContent = text;
  return el;
}

// The House tab's sidebar: a card per light. The selected light (or the one being traced) is
// highlighted on the photo and shows its settings; the rest stay one line each.
// A split light's parts are listed under its name.
function withLightHeader(d, card) {
  if (!d.parent || d.partIndex !== 0) return [card];
  const head = document.createElement("div");
  head.className = "house-light-head";
  head.textContent = app.lights[d.parent].name;
  return [head, card];
}

// What gets traced on the House tab: each light, or each part of a split light. A split light
// traced whole before it was split stays whole until its trace is split into parts.
function houseLights() {
  return app.deviceList.flatMap((d) => (d.parts?.length && !house.paths[d.id]?.length
    ? d.parts.map((p) => app.devices[partId(d, p)]) : [d]));
}

function renderHouseLights() {
  $("house-remove").hidden = !house.photo || house.sample;
  $("house-dim").value = house.dim;
  const box = $("house-lights");
  if (!house.photo) {
    box.innerHTML = `<p class="hint">Upload a photo of your house to start.</p>`;
    return;
  }
  const intro = house.sample ? [sampleHouseCard()] : [];
  if (!app.deviceList.length) {
    box.replaceChildren(...intro, Object.assign(document.createElement("p"), { className: "hint",
      innerHTML: "Add your lights under <b>Setup → Devices</b> first." }));
    return;
  }
  const current = house.active || house.selected;
  box.replaceChildren(...intro, ...houseLights().flatMap((d) => {
    const card = document.createElement("div");
    const open = current === d.id;
    card.className = `house-card${open ? " selected" : ""}${d.parent ? " house-part" : ""}`;
    const pts = house.paths[d.id]?.length || 0;
    const head = document.createElement("div");
    head.className = "house-card-head";
    const name = document.createElement("b");
    name.textContent = d.parent ? d.partName : d.name;
    if (d.parent) {
      const sw = document.createElement("span");
      sw.className = "part-swatch";
      sw.style.background = `rgb(${partRgb(d.partIndex).join()})`;
      head.append(sw);
    }
    const state = document.createElement("span");
    state.className = "hint";
    const hidden = house.hiddenLights.has(d.id);
    state.textContent = house.active === d.id ? "Tracing…" : !pts ? "Not traced" : hidden ? "Hidden"
      : { icicle: "Icicle", spots: `${pts} spots` }[house.styles[d.id]?.style] || "Traced";
    // Hiding a light on the photo gets at one traced underneath it. Only the House tab's photo
    // hides it; the House panel and the show are unchanged.
    const eye = button(hidden ? "🙈" : "👁", (e) => {
      e.stopPropagation();
      if (hidden) house.hiddenLights.delete(d.id); else house.hiddenLights.add(d.id);
      prefs.set("house.hiddenLights", [...house.hiddenLights]);
      if (!hidden && house.stretch?.id === d.id) house.stretch = null;
      renderHouseLights();
    }, `ghost small house-eye${hidden ? " off" : ""}`);
    eye.title = hidden ? `Show ${d.name} on the photo` : `Hide ${d.name} on the photo, to get at a light under it`;
    eye.disabled = !pts;
    head.append(name, state, eye);
    card.append(head);
    if (!open) {
      card.title = "Select this light";
      card.addEventListener("click", () => {
        if (house.active) return;
        house.selected = d.id;
        house.stretch = null;
        renderHouseLights();
      });
      return withLightHeader(d, card);
    }
    const actions = document.createElement("div");
    actions.className = "row";
    if (house.active === d.id) {
      actions.append(button("Done", () => { house.active = null; renderHouseLights(); }, "primary"));
    } else {
      actions.append(button(pts ? "Retrace" : "Trace", () => {
        if (pts && !confirm(`Trace ${d.name} again from the start?`)) return;
        delete house.paths[d.id];
        delete house.pins[d.id];
        if (house.styles[d.id]?.aims) house.styles[d.id].aims = [];
        house.active = house.selected = d.id;
        house.stretch = null;
        house.save();
        renderHouseLights();
      }, pts ? "" : "primary"));
    }
    if (pts) {
      actions.append(button("Clear", () => {
        if (!confirm(`Remove ${d.name} from the photo?`)) return;
        delete house.paths[d.id];
        delete house.pins[d.id];
        if (house.active === d.id) house.active = null;
        house.stretch = null;
        house.save();
        renderHouseLights();
      }, "ghost"));
    }
    // Traced whole before it was split: one click gives each part its own trace where it already is.
    if (d.parts?.length && pts && house.styles[d.id]?.style !== "spots") {
      const split = button("Split trace into parts", () => {
        house.splitTrace(d);
        house.selected = partId(d, d.parts[0]);
        house.stretch = null;
        renderHouseLights();
      }, "primary");
      split.title = "Give each part its own line, starting where it is now, so you can move the parts on their own";
      actions.append(split);
    }
    card.append(actions, ...houseStyleControls(d));
    const stretch = houseStretchEditor(d) || houseSegmentEditor(d);
    if (stretch) card.append(stretch);
    else if (house.active === d.id && house.styles[d.id]?.style === "spots") {
      card.append(hint("Click where each spotlight sits, starting nearest the plug."));
    } else if (pts && !house.active && house.styles[d.id]?.style === "spots") {
      card.append(hint("Drag a spot's round handle to aim it."));
    } else if (pts > 1 && !house.active) {
      card.append(hint("Click a line on the photo to mark part of it out of view. If the bulbs don't line up "
        + "with the real ones (a photo taken at an angle), drag a segment number along the line to where that "
        + "segment really is."));
      if (house.pins[d.id]) {
        card.append(button("Unpin all", () => { house.unpin(d.id); house.pinPick = null; renderHouseLights(); }, "ghost small"));
      }
    }
    if (d.parent && house.active === d.id) {
      card.append(hint(`Start at the end of ${d.partName} nearest the light's plug.`));
    }
    return withLightHeader(d, card);
  }));
  box.querySelector(".house-card.selected")?.scrollIntoView({ block: "nearest" });
}

// Shown above the lights while the sample house stands in for a photo.
function sampleHouseCard() {
  const card = document.createElement("div");
  card.className = "house-sample";
  card.append(Object.assign(document.createElement("p"), { innerHTML: "This is a <b>sample house</b>, so you "
    + "can try the House view before you take a photo of yours. <b>Upload photo</b> above to use your own." }));
  const todo = houseLights().filter((d) => !house.paths[d.id]?.length);
  if (todo.length) {
    const place = button("Put my lights on it", () => placeLightsOnSample(todo), "primary");
    place.title = "Put each light that isn't traced yet on the roof, porch, windows, tree and so on";
    card.append(place);
  }
  return card;
}

function placeLightsOnSample(lights) {
  const { paths, styles } = placeOnSample(lights, house.paths);
  const n = Object.keys(paths).length;
  Object.assign(house.paths, paths);
  for (const [id, st] of Object.entries(styles)) if (!house.styles[id]) house.styles[id] = st;
  house.save();
  renderHouseLights();
  status(n === lights.length ? `Put ${n} light${n === 1 ? "" : "s"} on the sample house`
    : `Put ${n} of your lights on the sample house; there's no room left for the rest`, n < lights.length);
}

function wireHouse() {
  house.wireSetup($("house-setup"), renderHouseLights);
  $("house-upload").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    // Lines drawn for the sample house won't match a real photo.
    const wasSample = house.sample && Object.keys(house.paths).length;
    await house.upload(file);
    if (wasSample && !house.sample && confirm("Clear the lights you put on the sample house, so you can trace them on your photo?")) {
      house.paths = {};
      house.pins = {};
      house.save();
    }
    renderHouseLights();
  });
  $("house-remove").addEventListener("click", async () => {
    if (!confirm("Remove the house photo? Your traced lights are kept for the next photo.")) return;
    await house.removePhoto();
    renderHouseLights();
  });
  $("house-dim").addEventListener("input", (e) => { house.dim = Number(e.target.value); house.save(); });
  document.addEventListener("keydown", (e) => {
    if ($("view-house").hidden || e.target.closest("input, select, textarea")) return;
    if (!house.active) {
      if (e.key === "Escape" && (house.stretch || house.selected)) {
        if (house.stretch) house.stretch = null;
        else house.selected = null;
        renderHouseLights();
      }
      return;
    }
    if (e.key === "Enter" || e.key === "Escape") { house.active = null; renderHouseLights(); }
    if (e.key === "Backspace") {
      e.preventDefault();
      house.paths[house.active]?.pop();
      house.save();
      renderHouseLights();
    }
  });
}

// clip preview ----------------------------------------------------------------
// The selected clip loops on its own in the Selection panel, so a change can be seen without playing
// the show. With "Show on the light" ticked it also loops on the real light while the show is stopped.
const clipPreview = { canvas: null, clip: null, started: 0, dev: null, sent: 0, pending: null, failedAt: -Infinity };
const PREVIEW_SEND_MS = 66; // about 15 frames a second to the light
const previewOnLight = () => prefs.get("previewOnLight", true);
const toHex = (rgb) => Array.from(rgb, (b) => b.toString(16).padStart(2, "0")).join("");

function clipPreviewRow(clip, dev) {
  const row = document.createElement("div");
  row.className = "clip-preview";
  const canvas = document.createElement("canvas");
  canvas.title = "This clip on its own, looping";
  if (clipPreview.clip !== clip) Object.assign(clipPreview, { clip, started: performance.now() });
  clipPreview.canvas = canvas;
  row.append(canvas);
  if (linked(dev) && !EFFECTS[clip.effect]?.experimental) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = previewOnLight();
    box.addEventListener("change", () => {
      prefs.set("previewOnLight", box.checked);
      if (!box.checked) stopLightPreview();
    });
    const l = document.createElement("label");
    l.title = "Loop this clip on the light while the show is stopped";
    l.append(box, " Show on the light");
    row.append(l);
  }
  return row;
}

function drawClipPreview() {
  const c = clipPreview.canvas, sel = app.selected;
  // offsetParent is null while the Selection panel is hidden: no preview, on screen or on the light.
  const track = sel?.clip && c?.isConnected && c.offsetParent && app.show.tracks[sel.track];
  const clip = sel?.clip, len = clip && Math.max(clip.end - clip.start, 0.05);
  const t = clip && clip.start + ((performance.now() - clipPreview.started) / 1000) % len;
  if (track?.device === HOUSE) {
    // A House clip on its own: as if one strip ran left to right across the house.
    if (clipPreview.dev) stopLightPreview();
    drawStrip(c, renderTrack([clip], t, 30), 30);
    return;
  }
  const dev = track && app.devices[track.device];
  if (!dev) { if (clipPreview.dev) stopLightPreview(); return; }
  const rgb = asShown(dev, t, (tt) => renderTrack([clip], Math.max(tt, clip.start), dev.segments));
  drawStrip(c, rgb, dev.segments, (dev.brightness ?? 100) / 100);
  const onLight = previewOnLight() && linked(dev) && !EFFECTS[clip.effect]?.experimental && !app.playing && !app.starting;
  if (onLight) sendPreview(dev, rgb);
  else if (clipPreview.dev) stopLightPreview();
}

// A row of segments in their colours, filling the canvas.
function drawStrip(c, rgb, n, cap = 1) {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bw = w / n, gap = bw >= 4 ? 1 : 0, pad = h > 12 ? 2 : 0;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]].map((v) => Math.round(v * cap));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(i * bw + gap, pad, Math.max(bw - gap * 2, 0.5), h - pad * 2);
  }
}

// The add-on applies the light's brightness cap, so the clip's own colours are sent. A part
// lights its own slice of the light, with the rest off.
function sendPreview(dev, rgb) {
  if (dev.parent) {
    const light = app.lights[dev.parent], full = new Uint8Array(light.segments * 3);
    full.set(rgb.subarray(0, dev.segments * 3), (dev.from - 1) * 3);
    [dev, rgb] = [light, full];
  } else if (dev.light) {
    [dev, rgb] = [dev.light, spreadParts(dev.light, rgb)];
  }
  const now = performance.now();
  if (clipPreview.pending || now - clipPreview.sent < PREVIEW_SEND_MS || now - clipPreview.failedAt < 5000) return;
  if (clipPreview.dev && clipPreview.dev !== dev.id) { stopLightPreview(); return; }
  clipPreview.sent = now;
  clipPreview.dev = dev.id;
  clipPreview.pending = api("api/devices/preview", { method: "POST", json: { ...dev, rgb: toHex(rgb) } })
    .catch((e) => {
      clipPreview.failedAt = performance.now();
      status(`Couldn't show the clip on ${dev.name}: ${e.message}`, true);
    })
    .finally(() => { clipPreview.pending = null; });
}

// Lets the light go back to what it was doing. Resolves once any frame still on its way has landed.
async function stopLightPreview() {
  const dev = app.lights[clipPreview.dev];
  clipPreview.dev = null;
  await clipPreview.pending;
  if (linked(dev)) await api("api/devices/preview", { method: "POST", json: { ...dev, stop: true } }).catch(() => {});
}

// effects and inspector -------------------------------------------------------
// Experimental effects (Govee scenes) only appear once switched on in Settings. `keep` stays listed
// regardless, so a clip that already uses one can still be edited.
const experimentalOn = () => prefs.get("experimental.scenes", false);
const labsOn = () => prefs.get("labs", false);
// house: true for the House lane's effects, false for lights', undefined for both.
const visibleEffects = (keep, house) => Object.entries(EFFECTS).filter(([k, fx]) =>
  (!fx.experimental || experimentalOn() || k === keep) && (house === undefined || !!fx.house === house));

// Previews in the effect chooser: each strip loops its effect for as long as the clip or selection
// (within reason) on the light's own segments.
const pickerPreview = { items: [], started: 0 };
const SHOW_PRESETS_KEY = "halidayshow.showPresets";
const MINE_ONLY_KEY = "halidayshow.myPresetsOnly";

// An effect's presets: the built-in ones, then the user's own (marked mine, shown with a ★).
const presetsFor = (effect) => [...(PRESETS[effect] || []), ...app.myPresets.filter((p) => p.effect === effect)];
const presetLabel = (p) => (p.mine ? `★ ${p.label}` : p.label);

// What a clip becomes with `effect` and, optionally, one of its presets: the effect's defaults, the
// colours and brightness carried over from `from` (the clip being changed), then the preset.
function chosenParams(effect, preset, from = null) {
  const out = defaultParams(effect);
  for (const p of EFFECTS[effect].params) {
    if (from && (p.type === "color" || p.key === "brightness") && from[p.key] !== undefined) out[p.key] = from[p.key];
  }
  return preset ? { ...out, ...presetParams(preset, out) } : out;
}

// The effect chooser, used both to add an effect and to change a clip's. Effects are shown as
// previewing buttons; with "Show presets" ticked each effect becomes a group of its default and its
// presets. groups lists [heading, house] sections (heading null for a single unnamed one).
// onPick(effect, preset) runs with the choice; current/currentPreset are outlined. suggested is
// {heading, looks: [{effect, label, params}]}, shown first, for adding to a part of the song.
// fit(clip, then), when given, says whether a choice suits the light (as fitFor does): ones that won't
// work are greyed out unless "Allow effects that won't work" is ticked, and the current one never is.
function chooseEffect({ title, groups, dev = null, length = 3, from = null, current = null, currentPreset = null,
  suggested = null, fit = null, onPick }) {
  const dlg = document.createElement("dialog");
  dlg.className = "effect-dialog";
  const head = document.createElement("div");
  head.className = "effect-dialog-head";
  const h = document.createElement("h3");
  h.textContent = title;
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  try { toggle.checked = localStorage.getItem(SHOW_PRESETS_KEY) === "1"; } catch { /* not remembered */ }
  const tl = document.createElement("label");
  tl.append(toggle, "Show presets");
  tl.title = "Presets are ready-made settings for an effect, such as a slow or fast marquee";
  const mineOnly = document.createElement("input");
  mineOnly.type = "checkbox";
  try { mineOnly.checked = localStorage.getItem(MINE_ONLY_KEY) === "1"; } catch { /* not remembered */ }
  const ml = document.createElement("label");
  ml.append(mineOnly, "★ My presets only");
  ml.title = "Only show the presets you've saved";
  const allow = document.createElement("input");
  allow.type = "checkbox";
  allow.checked = allowUnfit();
  const al = document.createElement("label");
  al.append(allow, "Allow effects that won't work");
  al.title = "Let you pick effects this light can't show properly, such as a chase on a light that is one colour at a time";
  al.hidden = !fit;
  const close = button("✕", () => dlg.close(), "ghost");
  close.title = "Close (Esc)";
  // Why a greyed-out effect won't work, once it's clicked. In the header, so it shows wherever you've scrolled.
  const note = document.createElement("p");
  note.className = "hint fit-warning effect-dialog-note";
  note.hidden = true;
  head.append(h, tl, ml, al, close, note);
  const body = document.createElement("div");
  body.className = "effect-dialog-body";
  dlg.append(head, body);
  const len = Math.min(Math.max(length, 1), 6);

  const choice = (effect, preset, label, active) => {
    let blocked = null;
    const b = button("", () => {
      if (blocked) { note.textContent = `⚠ ${label} won't work here. ${blocked}`; note.hidden = false; return; }
      dlg.close(); app.paletteEffect = effect; onPick(effect, preset);
    }, active ? "active" : "");
    const strip = document.createElement("canvas");
    strip.className = "fx-strip";
    const span = document.createElement("span");
    span.textContent = label;
    b.append(strip, span);
    const params = chosenParams(effect, preset, from);
    pickerPreview.items.push({ canvas: strip, clip: { effect, start: 0, end: len, ...params }, dev });
    const mark = (r) => {
      if (!r || r.level === "ok") return;
      if (r.level === "no" && !allow.checked && effect !== current) blocked = r.reasons.join(" ");
      b.classList.add(blocked ? "unfit" : "limited");
      b.title = fitText(r);
      span.textContent = `⚠ ${label}`;
    };
    if (fit) mark(fit({ effect, start: 0, end: Math.max(length, 0.05), ...params }, mark));
    return b;
  };
  const render = () => {
    pickerPreview.items = [];
    pickerPreview.started = performance.now();
    body.replaceChildren();
    note.hidden = true;
    ml.hidden = !toggle.checked;
    const onlyMine = toggle.checked && mineOnly.checked;
    if (suggested?.looks.length) {
      const sh = document.createElement("div");
      sh.className = "section-label effect-dialog-section";
      sh.textContent = suggested.heading;
      const row = document.createElement("div");
      row.className = "effect-picker";
      for (const look of suggested.looks) row.append(choice(look.effect, look, look.label, false));
      body.append(sh, row);
    }
    for (const [named, house] of groups) {
      const heading = named || (suggested?.looks.length ? "All effects" : null);
      if (heading) {
        const sh = document.createElement("div");
        sh.className = "section-label effect-dialog-section";
        sh.textContent = heading;
        body.append(sh);
      }
      const effects = visibleEffects(current ?? undefined, house);
      if (!toggle.checked) {
        const row = document.createElement("div");
        row.className = "effect-picker";
        for (const [key, fx] of effects) row.append(choice(key, null, fx.label, key === current));
        body.append(row);
        continue;
      }
      const grid = document.createElement("div");
      grid.className = "preset-groups";
      for (const [key, fx] of effects) {
        const presets = presetsFor(key).filter((p) => !onlyMine || p.mine);
        if (onlyMine && !presets.length) continue;
        const g = document.createElement("fieldset");
        g.className = `preset-group${key === current ? " current" : ""}`;
        const legend = document.createElement("legend");
        legend.textContent = fx.label;
        const row = document.createElement("div");
        row.className = "effect-picker";
        if (!onlyMine) row.append(choice(key, null, "Default", key === current && !currentPreset));
        for (const preset of presets) {
          row.append(choice(key, preset, presetLabel(preset), key === current && preset === currentPreset));
        }
        g.append(legend, row);
        grid.append(g);
      }
      if (!grid.children.length) {
        grid.innerHTML = `<p class="hint">No presets of your own yet. Select a clip and press <b>Save as preset</b>.</p>`;
      }
      body.append(grid);
    }
  };
  allow.addEventListener("change", () => { prefs.set(ALLOW_UNFIT, allow.checked); render(); });
  for (const [box, key] of [[toggle, SHOW_PRESETS_KEY], [mineOnly, MINE_ONLY_KEY]]) {
    box.addEventListener("change", () => {
      try { localStorage.setItem(key, box.checked ? "1" : "0"); } catch { /* not remembered */ }
      render();
    });
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
  dlg.addEventListener("close", () => { pickerPreview.items = []; dlg.remove(); });
  render();
  document.body.append(dlg);
  dlg.showModal();
  body.querySelector(".preset-group.current, .active")?.scrollIntoView({ block: "nearest" });
  return dlg;
}

function drawPickerPreviews() {
  for (const set of [pickerPreview, presetTabPreview, presetDialogPreview]) {
    const items = set.items;
    // offsetParent is null while the strips' panel or tab is hidden.
    if (!items.length || !items[0].canvas.isConnected || !items[0].canvas.offsetParent) continue;
    const secs = (performance.now() - set.started) / 1000;
    for (const { canvas, clip, dev } of items) {
      const n = dev?.segments || 15;
      drawStrip(canvas, asShown(dev, secs % clip.end, (t) => renderTrack([clip], t, n)), n, (dev?.brightness ?? 100) / 100);
    }
  }
}

function renderInspector() {
  const box = $("inspector");
  const sel = app.selected;
  const track = sel && app.show.tracks[sel.track];
  if (track && sel.range) { renderRangeInspector(sel.range); return; }
  if (track && !sel.clip) { renderTrackInspector(sel.track); return; }
  if (!sel || !track || !track.clips.includes(sel.clip)) {
    app.selected = null;
    box.innerHTML = `<p class="hint">Drag across a light, or the House lane, to select a stretch of time, then pick
      an effect to add it there.</p>
      <details class="howto" data-howto="selection"><summary>How to…</summary><ul>
        <li>Press Delete to clear the stretch. Hold Alt to start a selection on top of a clip.</li>
        <li>Click a clip to edit it: drag it to move, or drag its edges to resize. D duplicates, Ctrl+C and Ctrl+V
          copy and paste, and Ctrl+Z undoes.</li>
        <li>Click a light's name to copy or recolour all its effects.</li>
        <li>Drag along the time ruler to set a play region, and tick Loop to repeat it.</li>
        <li>Click the beat lane to add or remove a beat. Hold Shift to drag without snapping.</li>
        <li>Coloured flags on the beat lane are the song's marks, made in the Music editor. Clips snap to them.</li>
      </ul></details>`;
    restoreHowTo(box);
    return;
  }
  const clip = sel.clip;
  const dev = app.devices[track.device];
  box.replaceChildren();
  const h = document.createElement("h3");
  h.textContent = `${EFFECTS[clip.effect]?.label || clip.effect} on ${trackName(sel.track)}`;
  box.append(h, clipPreviewRow(clip, dev));
  const fit = clipFitOn(clip, sel.track);
  if (fit.level !== "ok") {
    const warn = document.createElement("p");
    warn.className = "hint fit-warning";
    warn.textContent = fitText(fit);
    box.append(warn);
  }

  // Settings are grouped so a clip with many of them stays readable.
  const group = (title) => {
    const g = document.createElement("fieldset");
    g.className = "insp-group";
    const legend = document.createElement("legend");
    legend.className = "section-label";
    legend.textContent = title;
    g.append(legend);
    return g;
  };
  const fxLabel = EFFECTS[clip.effect]?.label || clip.effect;
  const groups = { clip: group("Clip"), colours: group("Colours"), settings: group("Effect settings"),
    brightness: group("Brightness") };
  let target = groups.clip;
  const field = (label, el) => {
    const l = document.createElement("label");
    l.append(label, el);
    target.append(l);
    return el;
  };

  // The effect (and preset) is changed in the same chooser used to add one.
  const presets = presetsFor(clip.effect);
  // Prefer the user's own preset when one matches as well as a built-in one.
  const currentPreset = [...presets].reverse().find((pr) => matchesPreset(pr, clip)) || null;
  const effect = button(`${fxLabel}${currentPreset ? ` · ${presetLabel(currentPreset)}` : ""} ▾`, () => chooseEffect({
    title: `Change the effect on ${trackName(sel.track)}`,
    groups: [[null, isHouse(sel.track)]],
    dev, length: clip.end - clip.start, from: clip, current: clip.effect, currentPreset,
    fit: (c, then) => clipFitOn(c, sel.track, then),
    onPick: (key, preset) => {
      const params = chosenParams(key, preset, clip);
      if (key === clip.effect) {
        // Same effect: a preset only changes the settings it names, Default resets the rest.
        Object.assign(clip, preset ? presetParams(preset, clip) : params);
      } else {
        for (const k of Object.keys(clip)) if (!["effect", "start", "end"].includes(k)) delete clip[k];
        Object.assign(clip, params, { effect: key });
      }
      app.changed();
    },
  }), "ghost effect-change");
  effect.title = presets.length ? "Change this clip's effect or pick one of its presets" : "Change this clip's effect";
  field("Effect", effect);

  const timeInput = (key) => {
    const el = document.createElement("input");
    el.type = "number";
    el.step = "0.01";
    el.min = "0";
    el.value = clip[key].toFixed(2);
    el.addEventListener("change", () => {
      const v = Number(el.value);
      if (!Number.isFinite(v)) return;
      if (key === "start") clip.start = Math.min(Math.max(0, v), clip.end - 0.05);
      else clip.end = Math.max(v, clip.start + 0.05);
      app.changed();
    });
    return el;
  };
  field("Start", timeInput("start"));
  field("End", timeInput("end"));

  for (const p of EFFECTS[clip.effect].params) {
    target = p.type === "color" ? groups.colours : p.type === "range" ? groups.brightness : groups.settings;
    if (p.type === "scene") { field(p.label, scenePicker(clip, dev)); continue; }
    let el;
    if (p.type === "select") {
      el = document.createElement("select");
      for (const o of p.options) el.add(new Option(o, o, false, o === (clip[p.key] ?? p.default)));
    } else {
      el = document.createElement("input");
      el.type = p.type;
      if (p.type === "number" || p.type === "range") Object.assign(el, { min: p.min, max: p.max, step: p.step });
      el.value = clip[p.key] ?? p.default;
    }
    const numeric = p.type === "number" || p.type === "range";
    const read = () => (numeric ? Number(el.value) : el.value);
    el.addEventListener("input", () => {
      if (numeric && !Number.isFinite(read())) return;
      clip[p.key] = read();
      app.changed({ live: true });
    });
    el.addEventListener("change", () => app.changed());
    if (p.type === "color") el.addEventListener("focus", () => { app.lastColourKey = p.key; });
    if (p.type === "range") {
      const shown = document.createElement("span");
      shown.className = "range-value";
      const show = () => { shown.textContent = `${el.value}%`; };
      el.addEventListener("input", show);
      show();
      const wrap = document.createElement("span");
      wrap.append(el, shown);
      field("", wrap);
      continue;
    }
    field(p.label, el);
  }
  const colourKeys = EFFECTS[clip.effect].params.filter((p) => p.type === "color").map((p) => p.key);
  if (colourKeys.length) {
    groups.colours.append(paletteRow((c) => {
      const key = colourKeys.includes(app.lastColourKey) ? app.lastColourKey : colourKeys[0];
      clip[key] = c;
      app.lastColourKey = key;
      app.changed();
    }, button("Apply palette", () => {
      applyPalette(clip, currentPalette().colors);
      app.changed();
    }, "ghost")));
  }
  // Only groups with something in them (a legend alone) are shown.
  box.append(...Object.values(groups).filter((g) => g.children.length > 1));
  const actions = document.createElement("div");
  actions.className = "insp-actions";
  actions.append(button("Save as preset…", () => savePresetFrom(clip), "ghost"));
  actions.append(button("Copy", copySelection, "ghost"));
  if (!isHouse(sel.track)) {
    actions.append(button("Copy to all lights", () => copyClipsTo([clip], sel.track, otherTracks(sel.track)), "ghost"));
  }
  actions.append(button("Delete clip", deleteSelected, "ghost danger"));
  box.append(actions);
}

// Experimental Govee scenes: the list comes from Govee's scene library for the light's model.
const sceneLists = {};
function scenePicker(clip, dev) {
  const sel = document.createElement("select");
  const sku = dev?.sku;
  if (!sku) {
    sel.add(new Option("Scan for this light to learn its model"));
    sel.disabled = true;
    return sel;
  }
  sel.add(new Option(clip.scene || "Loading scenes…", ""));
  (sceneLists[sku] ||= api(`api/scenes?sku=${encodeURIComponent(sku)}`)).then((list) => {
    sel.replaceChildren(new Option(list.length ? "Pick a scene" : `No scenes listed for ${sku}`, ""));
    const groups = {};
    list.forEach((s, i) => {
      const g = groups[s.category] ||= sel.appendChild(Object.assign(document.createElement("optgroup"), { label: s.category || "Scenes" }));
      g.append(new Option(s.name, i, false, s.code === clip.code && s.name === clip.scene));
    });
    sel.addEventListener("change", () => {
      const s = list[Number(sel.value)];
      if (!s) return;
      Object.assign(clip, { scene: s.name, code: s.code, param: s.param });
      app.changed();
    });
  }).catch((e) => {
    delete sceneLists[sku];
    sel.replaceChildren(new Option(`Couldn't load scenes: ${e.message}`));
    sel.disabled = true;
  });
  return sel;
}

// copy and paste ----------------------------------------------------------------
const trackName = (i) => (isHouse(i) ? "the House lane"
  : app.devices[app.show.tracks[i]?.device]?.name || "missing light");
// The other lights' tracks (never the House lane, whose effects are a different kind).
const otherTracks = (i) => app.show.tracks.map((_, k) => k).filter((k) => k !== i && !isHouse(k) && playingDev(app.show.tracks[k]));
const clone = (clip) => JSON.parse(JSON.stringify(clip));

function copySelection() {
  const sel = app.selected;
  if (!sel || sel.range) { status("Select a clip or a light to copy", "hint"); return; }
  const clips = sel.clip ? [sel.clip] : app.show.tracks[sel.track].clips;
  if (!clips.length) { status("Nothing to copy on this light", "hint"); return; }
  app.clipboard = { clips: clips.map(clone), track: sel.track, whole: !sel.clip };
  status(`Copied ${clips.length} effect${clips.length > 1 ? "s" : ""}`);
  renderInspector();
}

// Onto another light, effects keep their times so the lights match.
// Onto the same light, they go to the playhead.
function paste() {
  const cb = app.clipboard, sel = app.selected;
  if (!cb) { status("Copy a clip or a light first", "hint"); return; }
  if (!sel) { status("Select the light to paste onto", "hint"); return; }
  let shift = 0;
  if (sel.track === cb.track && !cb.whole) shift = app.time - Math.min(...cb.clips.map((c) => c.start));
  const fits = cb.clips.filter((c) => fitsTrack(c.effect, sel.track));
  if (!fits.length) {
    status(isHouse(sel.track) ? "Only House effects can go on the House lane"
      : "House effects can only go on the House lane", "hint");
    return;
  }
  const pasted = fits.map((c) => ({ ...clone(c), start: c.start + shift, end: c.end + shift }))
    .filter((c) => !unfit(c, sel.track));
  const left = fits.length - pasted.length;
  if (!pasted.length) { status(`${left === 1 ? "That effect won't" : "Those effects won't"} work on ${trackName(sel.track)}`, "hint"); return; }
  app.show.tracks[sel.track].clips.push(...pasted);
  app.selected = pasted.length === 1 ? { track: sel.track, clip: pasted[0] } : { track: sel.track, clip: null };
  status(`Pasted ${pasted.length} effect${pasted.length > 1 ? "s" : ""} onto ${trackName(sel.track)}`
    + (left ? `, leaving out ${left} that won't work there` : ""));
  app.changed();
}

function copyClipsTo(clips, from, targets, replace = false) {
  if (!targets.length) { status("There are no other lights", "hint"); return; }
  let left = 0;
  for (const t of targets) {
    const fits = clips.filter((c) => !unfit(c, t));
    left += clips.length - fits.length;
    if (replace) app.show.tracks[t].clips = [];
    app.show.tracks[t].clips.push(...fits.map(clone));
  }
  status(`Copied ${clips.length} effect${clips.length > 1 ? "s" : ""} from ${trackName(from)} to `
    + (targets.length === 1 ? trackName(targets[0]) : `${targets.length} lights`)
    + (left ? `, leaving out ${left} where ${left === 1 ? "it" : "they"} won't work` : ""));
  app.changed();
}

function renderTrackInspector(i) {
  const box = $("inspector");
  const clips = app.show.tracks[i].clips;
  box.replaceChildren();
  const h = document.createElement("h3");
  h.textContent = `${isHouse(i) ? "House lane" : trackName(i)}: ${clips.length} effect${clips.length === 1 ? "" : "s"}`;
  box.append(h);
  const reach = !isHouse(i) && trackNote(app.devices[app.show.tracks[i].device]);
  if (reach) {
    const p = document.createElement("p");
    p.className = "hint fit-warning";
    p.textContent = `⚠ ${reach.text}`;
    box.append(p);
  }
  if (isHouse(i)) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = Object.keys(housePositionsAll()).length
      ? "Effects here run across all your lights by where they are on the house photo, on top of each light's own effects. Drag across this lane to add one."
      : "Effects here run across all your lights by where they are on the house photo. Trace your lights under Setup → House first.";
    box.append(p);
  }
  if (!isHouse(i) && otherTracks(i).length && clips.length) {
    const target = document.createElement("select");
    target.add(new Option("All other lights", "all"));
    for (const k of otherTracks(i)) target.add(new Option(trackName(k), k));
    const replace = document.createElement("input");
    replace.type = "checkbox";
    const label = document.createElement("label");
    label.append(replace, " Replace their effects");
    box.append("Copy all effects to ", target, label, button("Copy", () => {
      const targets = target.value === "all" ? otherTracks(i) : [Number(target.value)];
      copyClipsTo(clips, i, targets, replace.checked);
    }, "primary"));
  }
  if (clips.length) {
    box.append(paletteRow(null,
      button("Recolour this light", () => recolour([i]), "ghost"),
      button("Recolour all lights", () => recolour(app.show.tracks.map((_, k) => k)), "ghost")));

  }
  box.append(button("Copy (Ctrl+C)", copySelection, "ghost"));
  const p = button("Paste here (Ctrl+V)", paste, "ghost");
  p.disabled = !app.clipboard;
  box.append(p);
  if (clips.length) {
    box.append(button(isHouse(i) ? "Clear the House lane" : "Clear this light", () => {
      app.show.tracks[i].clips = [];
      app.changed();
    }, "ghost danger"));
  }
  // A track that plays on nothing (its light was removed, or it's a parts-only light's own track)
  // can be taken out of the show, with its effects.
  if (!isHouse(i) && !playingDev(app.show.tracks[i])) {
    const dead = app.show.tracks.filter((t) => t.device !== HOUSE && !playingDev(t));
    const remove = (tracks) => {
      const n = tracks.reduce((s, t) => s + t.clips.length, 0);
      if (n && !confirm(`Remove ${tracks.length === 1 ? "this track" : `${tracks.length} tracks`} and ${n} effect${n === 1 ? "" : "s"} from the show?`)) return;
      app.show.tracks = app.show.tracks.filter((t) => !tracks.includes(t));
      app.select(null);
      app.changed();
      layoutPreview();
      timeline.layout();
    };
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = app.devices[app.show.tracks[i].device]
      ? "This light plays its parts only, so this track isn't played."
      : "This light isn't under Setup → Devices any more, so this track isn't played.";
    box.append(p, button("Remove from show", () => remove([app.show.tracks[i]]), "danger"));
    if (dead.length > 1) box.append(button(`Remove all ${dead.length} unplayed tracks`, () => remove(dead), "ghost danger"));
  }
}

// your own effect presets -----------------------------------------------------------
// Saved from a clip, they show in the effect chooser with a ★ and are managed on the Presets tab.
const presetTabPreview = { items: [], started: 0 };
const asPreset = (p) => ({ name: p.name, effect: p.effect, params: p.params, label: p.name, mine: true });

async function loadPresets() {
  try { app.myPresets = (await api("api/presets")).map(asPreset); } catch { app.myPresets = []; }
  renderPresetsTab();
}

let savePresetsTimer = null;
function savePresets() {
  clearTimeout(savePresetsTimer);
  savePresetsTimer = setTimeout(async () => {
    try {
      await api("api/presets", { method: "PUT",
        json: app.myPresets.map(({ name, effect, params }) => ({ name, effect, params })) });
      status("Presets saved", "saved", "presets");
    } catch (e) { status(`Couldn't save presets: ${e.message}`, true, "presets"); }
  }, 400);
}

// A name not yet used by another of that effect's presets.
function freePresetName(effect, base, except = null) {
  const taken = new Set(presetsFor(effect).filter((p) => p !== except).map((p) => p.label.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

// Asks for a name (and whether to keep the colours), then saves the clip's settings as a preset.
function savePresetFrom(clip) {
  const fx = EFFECTS[clip.effect];
  const dlg = document.createElement("dialog");
  dlg.className = "effect-dialog save-preset-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const h = document.createElement("h3");
  h.textContent = `Save as a ${fx.label} preset`;
  const name = document.createElement("input");
  name.required = true;
  name.maxLength = 60;
  name.value = freePresetName(clip.effect, `My ${fx.label.toLowerCase()}`);
  const nl = document.createElement("label");
  nl.append("Name", name);
  const colours = document.createElement("input");
  colours.type = "checkbox";
  colours.checked = true;
  const cl = document.createElement("label");
  cl.append(colours, "Include colours");
  cl.title = "Untick to save only the movement and other settings, so the preset keeps whatever colours a clip has";
  const hasColours = fx.params.some((p) => p.type === "color");
  cl.hidden = !hasColours;
  const actions = document.createElement("div");
  actions.className = "insp-actions";
  const save = button("Save preset", () => {}, "primary");
  save.type = "submit";
  const cancel = button("Cancel", () => dlg.close(), "ghost");
  cancel.type = "button";
  actions.append(save, cancel);
  form.append(h, nl, cl, actions);
  dlg.append(form);
  form.addEventListener("submit", () => {
    const label = name.value.trim();
    if (!label) return;
    const params = {};
    for (const p of fx.params) {
      if (p.type === "scene" || (p.type === "color" && !colours.checked)) continue;
      params[p.key] = clip[p.key] ?? p.default;
    }
    const finalName = freePresetName(clip.effect, label);
    app.myPresets.push(asPreset({ name: finalName, effect: clip.effect, params }));
    savePresets();
    renderPresetsTab();
    status(`Saved ★ ${finalName} as a ${fx.label} preset`, "saved");
    renderInspector();
  });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  name.select();
}

// A window for editing one thing: its title, a body, and a foot of buttons. Escape or ✕ is Cancel.
function editWindow(title) {
  const dlg = document.createElement("dialog");
  dlg.className = "effect-dialog form-dialog edit-dialog";
  const head = document.createElement("div");
  head.className = "effect-dialog-head";
  const h = document.createElement("h3");
  h.textContent = title;
  const x = button("✕", () => dlg.close(), "ghost");
  x.setAttribute("aria-label", "Close");
  head.append(h, x);
  const body = document.createElement("div");
  body.className = "form-dialog-body";
  const foot = document.createElement("div");
  foot.className = "form-dialog-foot";
  dlg.append(head, body, foot);
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  return { dlg, h, body, foot };
}

// After a window closes, back to the Edit… button of the row it was about.
function focusEdit(listId, name) {
  [...$(listId).querySelectorAll(".show-row")].find((r) => r.querySelector(".show-name")?.textContent === name)
    ?.querySelector("button")?.focus();
}

// A row in the Palettes and Presets lists, like Your shows: a picture, the name and a line of detail,
// then Edit and the rest.
function itemRow({ picture, name, detail, edit, extra = [], label }) {
  const row = document.createElement("div");
  row.className = "show-row item-row";
  row.setAttribute("role", "listitem");
  const main = document.createElement("div");
  main.className = "show-main";
  const b = document.createElement("b");
  b.className = "show-name";
  b.textContent = name;
  const d = document.createElement("div");
  d.className = "hint";
  d.textContent = detail;
  main.append(b, d);
  const actions = document.createElement("div");
  actions.className = "group show-actions";
  const e = button("Edit…", edit, "primary");
  e.setAttribute("aria-label", `Edit ${label} ${name}`);
  actions.append(e, ...extra);
  row.append(picture, main, actions);
  return row;
}

// The Presets tab: your presets as a list by effect, each with a live preview. Edit… opens the preset
// in a window with a bigger preview and the same grouped settings as a clip; Save keeps the changes.
let presetEditing = null; // the preset whose row to bring into view after the list is drawn
const presetDialogPreview = { items: [], started: 0 };
const presetPreviewDev = () => app.devices[prefs.get("presetPreviewLight", "")] || null;
const presetClip = (p) => ({ effect: p.effect, start: 0, end: 4, ...chosenParams(p.effect, p) });
const hasColours = (effect) => EFFECTS[effect].params.some((q) => q.type === "color");
const keepsColours = (p) => EFFECTS[p.effect].params.some((q) => q.type === "color" && q.key in p.params);

// Built-in groups for picking an effect for a preset: lights' effects and the House lane's.
const PRESET_EFFECT_GROUPS = [["Light effects", false], ["House lane effects", true]];

function newPreset() {
  chooseEffect({
    title: "New preset: pick an effect to start from",
    groups: PRESET_EFFECT_GROUPS, dev: presetPreviewDev(), length: 4,
    onPick: (key, preset) => {
      const fx = EFFECTS[key];
      const name = freePresetName(key, preset ? `My ${preset.label.toLowerCase()}` : `My ${fx.label.toLowerCase()}`);
      openPresetWindow(null, asPreset({ name, effect: key, params: chosenParams(key, preset) }));
    },
  });
}

function renderPresetsTab() {
  const list = $("my-presets");
  if (!list) return;
  presetTabPreview.items = [];
  presetTabPreview.started = performance.now();
  renderAiPresetIdeas();
  list.replaceChildren();
  if (!app.myPresets.length) {
    list.innerHTML = `<p class="hint">None yet. Press <b>+ New preset</b>, or select a clip in the editor and press
      <b>Save as preset…</b>.</p>`;
    return;
  }
  const dev = presetPreviewDev();
  for (const [key, fx] of Object.entries(EFFECTS)) {
    const mine = app.myPresets.filter((p) => p.effect === key);
    if (!mine.length) continue;
    const h = document.createElement("h3");
    h.className = "item-group";
    h.textContent = fx.label;
    const rows = document.createElement("div");
    rows.className = "show-list";
    rows.setAttribute("role", "list");
    rows.setAttribute("aria-label", `${fx.label} presets`);
    for (const preset of mine) {
      const strip = document.createElement("canvas");
      strip.className = "fx-strip item-strip";
      presetTabPreview.items.push({ canvas: strip, clip: presetClip(preset), dev, preset });
      const shown = Object.keys(preset.params).length;
      const row = itemRow({
        picture: strip, name: preset.name, label: "preset",
        detail: `${fx.label} · ${keepsColours(preset) ? "with its colours" : "keeps a clip's colours"}`
          + (shown ? "" : " · its settings as they come"),
        edit: () => openPresetWindow(preset),
        extra: [
          button("Duplicate", () => {
            const copy = asPreset({ name: freePresetName(preset.effect, `${preset.name} copy`), effect: preset.effect,
              params: structuredClone(preset.params) });
            app.myPresets.splice(app.myPresets.indexOf(preset) + 1, 0, copy);
            presetEditing = copy;
            savePresets();
            renderPresetsTab();
          }, "ghost"),
          button("Delete…", () => deletePreset(preset), "ghost danger"),
        ],
      });
      if (preset === presetEditing) row.classList.add("just-changed");
      rows.append(row);
    }
    list.append(h, rows);
  }
  list.querySelector(".just-changed")?.scrollIntoView({ block: "nearest" });
  presetEditing = null;
}

function deletePreset(preset) {
  if (!confirm(`Delete the preset ${preset.name}? Clips using its settings keep them.`)) return false;
  app.myPresets.splice(app.myPresets.indexOf(preset), 1);
  savePresets();
  renderPresetsTab();
  return true;
}

// Edit a preset (or make the new one, `draft`) in a window. The changes are made to a copy, and only
// kept when you press Save.
function openPresetWindow(preset, draft = null) {
  const work = draft || asPreset({ name: preset.name, effect: preset.effect, params: structuredClone(preset.params) });
  const w = editWindow(preset ? `Edit preset: ${preset.name}` : "New preset");
  w.dlg.classList.add("preset-dialog");
  const draw = () => {
    presetDialogPreview.items = [];
    presetDialogPreview.started = performance.now();
    renderPresetEditor(w.body, presetPreviewDev(), work, { redraw: () => { draw(); w.body.querySelector(".effect-change")?.focus(); },
      changed: () => { for (const item of presetDialogPreview.items) item.clip = presetClip(work); } });
  };
  draw();
  const save = button(preset ? "Save" : "Add preset", () => {
    const name = w.body.querySelector(".preset-name").value.trim();
    if (!name) { status("Give the preset a name", "hint"); w.body.querySelector(".preset-name").focus(); return; }
    work.name = work.label = freePresetName(work.effect, name, preset);
    if (preset) Object.assign(preset, { name: work.name, label: work.name, effect: work.effect, params: work.params });
    else app.myPresets.push(work);
    presetEditing = preset || work;
    savePresets();
    w.dlg.close();
    renderPresetsTab();
    if (work.name !== name) status(`Another ${EFFECTS[work.effect].label} preset is called ${name}, so it's saved as ${work.name}`, "hint");
    focusEdit("my-presets", work.name);
  }, "primary");
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  if (preset) w.foot.append(button("Delete…", () => { if (deletePreset(preset)) w.dlg.close(); }, "ghost danger"));
  w.foot.append(spacer, button("Cancel", () => w.dlg.close()), save);
  w.dlg.addEventListener("close", () => { presetDialogPreview.items = []; });
  w.body.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList.contains("preset-name")) save.click(); });
  w.dlg.showModal();
  w.body.querySelector(".preset-name").focus();
}

function renderPresetEditor(box, dev, preset, { changed, redraw }) {
  box.replaceChildren();
  const fx = EFFECTS[preset.effect];

  const head = document.createElement("div");
  head.className = "preset-editor-head";
  const name = document.createElement("input");
  name.className = "preset-name";
  name.value = preset.name;
  name.maxLength = 60;
  name.title = "The preset's name";
  name.setAttribute("aria-label", "Name");
  name.addEventListener("input", () => { preset.name = preset.label = name.value; });
  const effect = button(`${fx.label} ▾`, () => chooseEffect({
    title: `Change the effect of ${preset.name}`,
    groups: PRESET_EFFECT_GROUPS, dev, length: 4, from: { ...preset.params }, current: preset.effect,
    onPick: (key, start) => {
      const keep = keepsColours(preset);
      const params = chosenParams(key, start, preset.params);
      if (!keep) for (const q of EFFECTS[key].params) if (q.type === "color") delete params[q.key];
      preset.effect = key;
      preset.params = params;
      redraw();
    },
  }), "ghost effect-change");
  effect.title = "Change the effect, or start again from one of its presets";
  const el = document.createElement("label");
  el.append("Effect", effect);
  head.append(name, el);

  // A large looping preview, on a chosen light's segments.
  const previewRow = document.createElement("div");
  previewRow.className = "preset-preview";
  const strip = document.createElement("canvas");
  strip.className = "fx-strip preset-preview-strip";
  presetDialogPreview.items.push({ canvas: strip, clip: presetClip(preset), dev, preset });
  const on = document.createElement("select");
  on.add(new Option("15 segments", ""));
  for (const d of app.deviceList) on.add(new Option(`${d.name} (${d.segments})`, d.id, false, d === dev));
  on.addEventListener("change", () => { prefs.set("presetPreviewLight", on.value); redraw(); });
  const ol = document.createElement("label");
  ol.append("Preview on", on);
  previewRow.append(strip, ol);

  const group = (title) => {
    const g = document.createElement("fieldset");
    g.className = "insp-group";
    const legend = document.createElement("legend");
    legend.className = "section-label";
    legend.textContent = title;
    g.append(legend);
    return g;
  };
  const groups = { colours: group("Colours"), settings: group("Effect settings"), brightness: group("Brightness") };

  // Colours are part of the preset only when ticked; otherwise clips keep their own.
  if (hasColours(preset.effect)) {
    const include = document.createElement("input");
    include.type = "checkbox";
    include.checked = keepsColours(preset);
    include.addEventListener("change", () => {
      for (const q of fx.params) {
        if (q.type !== "color") continue;
        if (include.checked) preset.params[q.key] ??= q.default;
        else delete preset.params[q.key];
      }
      changed();
      redraw();
    });
    const il = document.createElement("label");
    il.append(include, "Include colours");
    il.title = "Untick to keep whatever colours a clip already has when this preset is picked";
    groups.colours.append(il);
  }
  const colourKeys = [];
  for (const q of fx.params) {
    if (q.type === "scene") continue;
    if (q.type === "color" && !(q.key in preset.params)) continue;
    if (q.type === "color") colourKeys.push(q.key);
    const target = q.type === "color" ? groups.colours : q.type === "range" ? groups.brightness : groups.settings;
    let input;
    if (q.type === "select") {
      input = document.createElement("select");
      for (const o of q.options) input.add(new Option(o, o, false, o === (preset.params[q.key] ?? q.default)));
    } else {
      input = document.createElement("input");
      input.type = q.type;
      if (q.type === "number" || q.type === "range") Object.assign(input, { min: q.min, max: q.max, step: q.step });
      input.value = preset.params[q.key] ?? q.default;
    }
    input.dataset.key = q.key;
    const numeric = q.type === "number" || q.type === "range";
    const shown = document.createElement("span");
    shown.className = "range-value";
    const show = () => { shown.textContent = q.type === "range" ? `${input.value}%` : ""; };
    input.addEventListener("input", () => {
      const v = numeric ? Number(input.value) : input.value;
      if (numeric && !Number.isFinite(v)) return;
      preset.params[q.key] = v;
      show();
      changed();
    });
    if (q.type === "color") input.addEventListener("focus", () => { app.lastColourKey = q.key; });
    show();
    const l = document.createElement("label");
    if (q.type === "range") l.append(input, shown);
    else l.append(q.label, input);
    target.append(l);
  }
  if (colourKeys.length) {
    const setColours = () => {
      for (const k of colourKeys) {
        const input = groups.colours.querySelector(`input[data-key="${k}"]`);
        if (input) input.value = preset.params[k];
      }
      changed();
    };
    groups.colours.append(paletteRow((c) => {
      preset.params[colourKeys.includes(app.lastColourKey) ? app.lastColourKey : colourKeys[0]] = c;
      setColours();
    }, button("Apply palette", () => {
      const tmp = { effect: preset.effect, ...preset.params };
      applyPalette(tmp, currentPalette().colors);
      for (const k of colourKeys) preset.params[k] = tmp[k];
      setColours();
    }, "ghost")));
  }

  box.append(head, previewRow, ...Object.values(groups).filter((g) => g.children.length > 1));
}

// colour palettes ---------------------------------------------------------------
const allPalettes = () => [...PRESET_PALETTES, ...app.palettes];
const currentPalette = () => allPalettes().find((p) => p.name === app.colourPalette) || PRESET_PALETTES[0];

function swatch(color, onclick) {
  const el = document.createElement(onclick ? "button" : "span");
  el.className = "swatch";
  el.style.background = color;
  el.title = color;
  if (onclick) el.addEventListener("click", () => onclick(color));
  return el;
}

// Palette picker for the inspector. Clicking a swatch calls onSwatch with its colour.
function paletteRow(onSwatch, ...actions) {
  const row = document.createElement("div");
  row.className = "palette-row";
  const sel = document.createElement("select");
  const groups = [["Presets", PRESET_PALETTES], ["Your palettes", app.palettes]];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const p of list) g.append(new Option(p.name, p.name, false, p.name === currentPalette().name));
    sel.append(g);
  }
  const swatches = document.createElement("span");
  swatches.className = "swatches";
  const fill = () => swatches.replaceChildren(...currentPalette().colors.map((c) => swatch(c, onSwatch)));
  sel.addEventListener("change", () => {
    app.colourPalette = sel.value;
    prefs.set("colourPalette", sel.value);
    fill();
  });
  fill();
  const label = document.createElement("label");
  label.append("Palette", sel);
  row.append(label, swatches, ...actions);
  if (onSwatch) row.title = "Click a colour to use it in the colour field you last picked";
  return row;
}

// Each light steps through the palette clip by clip, in time order, so lights stay matched.
function recolour(tracks) {
  const colors = currentPalette().colors;
  let n = 0;
  for (const t of tracks) {
    const clips = [...app.show.tracks[t].clips].sort((a, b) => a.start - b.start);
    let k = 0;
    for (const c of clips) if (applyPalette(c, colors, k)) { k++; n++; }
  }
  if (!n) { status("No effects with colours to recolour", "hint"); return; }
  status(`Recoloured ${n} effect${n > 1 ? "s" : ""} with ${currentPalette().name}`);
  app.changed();
}

async function loadPalettes() {
  try { app.palettes = await api("api/palettes"); } catch { app.palettes = []; }
  renderPalettes();
  renderInspector();
}

let savePalettesTimer = null;
function savePalettes() {
  clearTimeout(savePalettesTimer);
  savePalettesTimer = setTimeout(async () => {
    try {
      await api("api/palettes", { method: "PUT", json: app.palettes });
      status("Palettes saved", "saved", "palettes");
      renderInspector();
    } catch (e) { status(`Couldn't save palettes: ${e.message}`, true, "palettes"); }
  }, 300);
}

function uniqueName(base) {
  const names = new Set(allPalettes().map((p) => p.name));
  let name = base;
  for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
  return name;
}

function renderPalettes() {
  const mine = $("my-palettes"), presets = $("preset-palettes");
  renderAiPaletteIdeas();

  presets.replaceChildren(...PRESET_PALETTES.map((p) => {
    // A card per built-in palette: its colours as one bar, then its name and Copy.
    const card = document.createElement("div");
    card.className = "palette-card";
    const bar = document.createElement("div");
    bar.className = "palette-bar";
    for (const c of p.colors) {
      const el = document.createElement("span");
      el.style.background = c;
      bar.append(el);
    }
    const name = document.createElement("span");
    name.className = "palette-name";
    name.textContent = p.name;
    const copy = button("Copy…", () => openPaletteWindow(null, { name: uniqueName(`My ${p.name}`), colors: [...p.colors] }), "ghost");
    copy.title = "Copy to your palettes, to change it";
    const foot = document.createElement("div");
    foot.className = "palette-foot";
    foot.append(name, copy);
    card.append(bar, foot);
    return card;
  }));
  if (!app.palettes.length) {
    mine.innerHTML = `<p class="hint">None yet. Press <b>+ New palette</b>, or copy a built-in one and change it.</p>`;
    return;
  }
  mine.setAttribute("role", "list");
  mine.setAttribute("aria-label", "Your palettes");
  mine.replaceChildren(...app.palettes.map((p, i) => itemRow({
    picture: paletteBar(p.colors), name: p.name, label: "palette",
    detail: `${p.colors.length} colour${p.colors.length === 1 ? "" : "s"}${p.name === app.colourPalette ? " · in use in the editor" : ""}`,
    edit: () => openPaletteWindow(p),
    extra: [
      button("Duplicate", () => {
        app.palettes.splice(i + 1, 0, { name: uniqueName(`${p.name} copy`), colors: [...p.colors] });
        savePalettes();
        renderPalettes();
      }, "ghost"),
      button("Delete…", () => deletePalette(p), "ghost danger"),
    ],
  })));
}

// A palette's colours as one bar.
function paletteBar(colors) {
  const bar = document.createElement("div");
  bar.className = "palette-bar";
  for (const c of colors) {
    const el = document.createElement("span");
    el.style.background = c;
    bar.append(el);
  }
  return bar;
}

function deletePalette(p) {
  if (!confirm(`Delete the palette ${p.name}? Effects already coloured with it keep their colours.`)) return false;
  app.palettes.splice(app.palettes.indexOf(p), 1);
  savePalettes();
  renderPalettes();
  return true;
}

// Edit a palette (or make a new one from `draft`) in a window: its name and colours, kept on Save.
function openPaletteWindow(palette, draft = null) {
  const work = draft || { name: palette.name, colors: [...palette.colors] };
  const w = editWindow(palette ? `Edit palette: ${palette.name}` : "New palette");
  w.dlg.classList.add("palette-dialog");
  const name = document.createElement("input");
  name.value = work.name;
  name.maxLength = 60;
  const nl = document.createElement("label");
  nl.className = "field";
  nl.append("Name", name);
  const preview = document.createElement("div");
  const colours = document.createElement("div");
  colours.className = "palette-edit-colours";
  colours.setAttribute("role", "group");
  colours.setAttribute("aria-label", "Colours");
  const ch = document.createElement("span");
  ch.className = "field-label";
  ch.textContent = "Colours";
  const add = button("+ Add a colour", () => { work.colors.push(work.colors.at(-1)); draw(); colours.querySelector("li:last-child input")?.focus(); }, "ghost");
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Generate and Recolour use them in this order. Up to 12.";
  const draw = () => {
    preview.replaceChildren(paletteBar(work.colors));
    const list = document.createElement("ol");
    work.colors.forEach((c, k) => {
      const li = document.createElement("li");
      const el = document.createElement("input");
      el.type = "color";
      el.value = c;
      el.setAttribute("aria-label", `Colour ${k + 1}`);
      el.addEventListener("input", () => { work.colors[k] = el.value; preview.replaceChildren(paletteBar(work.colors)); });
      const hex = document.createElement("code");
      hex.textContent = c;
      el.addEventListener("input", () => { hex.textContent = el.value; });
      const up = button("↑", () => {
        [work.colors[k - 1], work.colors[k]] = [work.colors[k], work.colors[k - 1]];
        draw();
        colours.querySelectorAll("li")[k - 1]?.querySelector(k - 1 ? "button" : "input")?.focus();
      }, "ghost");
      up.setAttribute("aria-label", `Move colour ${k + 1} up`);
      up.disabled = k === 0;
      const rm = button("✕", () => {
        work.colors.splice(k, 1);
        draw();
        colours.querySelectorAll("li")[Math.min(k, work.colors.length - 1)]?.querySelector("input")?.focus();
      }, "ghost");
      rm.setAttribute("aria-label", `Remove colour ${k + 1}`);
      rm.disabled = work.colors.length <= 1;
      if (rm.disabled) rm.title = "A palette needs at least one colour";
      li.append(el, hex, up, rm);
      list.append(li);
    });
    colours.replaceChildren(list);
    add.disabled = work.colors.length >= 12;
    add.title = add.disabled ? "A palette holds up to 12 colours" : "";
  };
  draw();
  w.body.append(nl, preview, ch, colours, add, hint);
  const save = button(palette ? "Save" : "Add palette", () => {
    const v = name.value.trim();
    if (!v) { status("Give the palette a name", "hint"); name.focus(); return; }
    if (allPalettes().some((q) => q !== palette && q.name.toLowerCase() === v.toLowerCase())) {
      status("Give each palette its own name", "hint");
      name.select();
      return;
    }
    if (palette) {
      if (app.colourPalette === palette.name) { app.colourPalette = v; prefs.set("colourPalette", v); }
      Object.assign(palette, { name: v, colors: work.colors });
    } else {
      app.palettes.push({ name: v, colors: work.colors });
    }
    savePalettes();
    w.dlg.close();
    renderPalettes();
    focusEdit("my-palettes", v);
  }, "primary");
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); });
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  if (palette) w.foot.append(button("Delete…", () => { if (deletePalette(palette)) w.dlg.close(); }, "ghost danger"));
  w.foot.append(spacer, button("Cancel", () => w.dlg.close()), save);
  w.dlg.showModal();
  name.focus();
}

// playlists ---------------------------------------------------------------------------
// Shows played back to back by HA-liday Show itself, so they carry on with the editor closed.
let playlists = [], playlistShows = [], playlistArchived = [], playlistPlaying = null, playlistWatch = null;
let playlistsLoaded = false; // never save over the stored playlists before they've been read
let scheduleState = { now: null, next: {}, scheduled: null }; // HA-liday Show's clock and next starts

async function loadPlaylists() {
  try {
    await flushPlaylists(); // an edit made just before leaving the page
    [playlists, playlistShows, playlistArchived] = await Promise.all([api("api/playlists"), api("api/shows"),
      api("api/shows/archived").catch(() => [])]);
    playlistsLoaded = true;
  } catch (e) {
    playlistsLoaded = false;
    status(`Couldn't load playlists: ${e.message}`, true);
  }
  await refreshPlaylistStatus();
  renderPlaylists();
  clearInterval(playlistWatch);
  playlistWatch = setInterval(refreshPlaylistStatus, 2000);
}

function stopPlaylistWatch() { clearInterval(playlistWatch); playlistWatch = null; }

async function refreshPlaylistStatus() {
  let st = {};
  try {
    [st, scheduleState] = await Promise.all([api("api/player"), api("api/schedule")]);
  } catch { /* try again next tick */ }
  if (scheduleState.now) {
    const [d, t] = scheduleState.now.split("T");
    $("playlist-clock").textContent = `Schedules go by HA-liday Show's clock, which says ${t} on ${d.split("-").reverse().join("/")}.`
      + (scheduleState.sunset ? ` Sunset today is at ${scheduleState.sunset}.` : "");
  }
  renderSunPlace();
  const now = st.playlist ? { ...st.playlist, show: st.playing ? st.show : null, block: st.block || null, name: st.playlist.name } : null;
  playlistPlaying = now;
  const nowText = !now ? ""
    : `▶ Playing ${now.name}: ${now.show ? (playlistShows.find((x) => x.id === now.show)?.name || now.show)
      : now.block ? playlistBlockLabel(now.block) : "a pause"}`
      + (st.playlist?.finishing ? ". Its time is up, so it stops when this show ends." : "");
  for (const p of document.querySelectorAll("[data-playlist-now]")) p.textContent = nowText;
  markPlaylistPlaying();
}

// Marks what's playing without redrawing, so a name being typed isn't lost.
function markPlaylistPlaying() {
  const byId = playlistShowById();
  for (const row of document.querySelectorAll("[data-playlist-list] .show-row")) {
    const playing = playlistPlaying?.id === row.dataset.playlistId;
    row.classList.toggle("playing", playing);
    const play = row.querySelector(".playlist-play");
    play.textContent = playing ? "■ Stop" : "▶ Play";
    play.disabled = !playing && play.dataset.empty === "1";
    const next = row.querySelector(".playlist-next");
    const pl = playlists.find((x) => x.id === row.dataset.playlistId);
    if (pl) next.textContent = scheduleNote(pl);
  }
  const pl = openPlaylist();
  if (!pl || $("view-playlist").hidden) return;
  const playing = playlistPlaying?.id === pl.id;
  for (const li of document.querySelectorAll("#pl-order > li[data-k]")) {
    li.classList.toggle("current", playing && (li.dataset.show ? playlistPlaying.show === li.dataset.show
      : !!li.dataset.blockId && playlistPlaying.block?.id === li.dataset.blockId));
  }
  const play = $("pl-play");
  const empty = !pl.shows.some((id) => byId[id]?.baked);
  play.textContent = playing ? "■ Stop" : "▶ Play";
  play.disabled = !playing && empty;
  play.title = !playing && empty ? "Add a saved show first" : "";
  const next = document.querySelector("#pl-schedule .playlist-next");
  if (next) next.textContent = scheduleNote(pl);
}

// Where sunset is worked out for: shown once a playlist starts at sunset.
function renderSunPlace() {
  const form = $("sun-place");
  const usesSunset = playlists.some((p) => p.schedule?.on && p.schedule.start === "sunset");
  const loc = scheduleState.location;
  form.hidden = !usesSunset && !(loc?.source === "you");
  if (form.hidden || form.contains(document.activeElement)) return;
  $("sun-place-text").textContent = !loc
    ? "Sunset times need to know where you are. Type your latitude and longitude (on Google Maps, right-click your house and click the numbers at the top to copy them)."
    : loc.source === "ha" ? `Sunset times are for Home Assistant's location (${loc.lat}, ${loc.lon}). Type another place to use that instead.`
      : `Sunset times are for ${loc.lat}, ${loc.lon}.`;
  $("sun-lat").value = loc?.source === "you" ? loc.lat : "";
  $("sun-lon").value = loc?.source === "you" ? loc.lon : "";
  $("sun-place-clear").hidden = loc?.source !== "you";
}

async function saveSunPlace(e) {
  e.preventDefault();
  // "51.5074, -0.1278" (as Google Maps copies it) pasted into the first box fills both. Only a comma
  // with a space after it, or a space, splits them, so a decimal comma ("51,5") isn't taken apart.
  const both = $("sun-lon").value.trim() ? [] : $("sun-lat").value.trim().split(/\s*,\s+|\s+/);
  const [lat, lon] = both.length === 2 ? both : [$("sun-lat").value, $("sun-lon").value];
  try {
    if (!lat.trim() || !String(lon).trim()) throw new Nudge("Type both a latitude and a longitude");
    scheduleState = await api("api/location", { method: "PUT", json: { lat: lat.trim(), lon: String(lon).trim() } });
    status("Saved where you are, for sunset times", "saved", "location");
  } catch (err) { status(err.message, errorKind(err), "location"); }
  document.activeElement?.blur();
  refreshPlaylistStatus();
}

function scheduleNote(pl) {
  const s = pl.schedule;
  if (!s?.on) return "";
  if (scheduleState.scheduled === pl.id) return `Playing now on its schedule (${describeSchedule(s)}).`;
  const next = scheduleState.next?.[pl.id];
  if (s.start === "sunset" && !scheduleState.location) return "To know when sunset is, it needs where you are: add it under When it plays.";
  if (!next || !scheduleState.now) return s.days.length ? "" : "Pick at least one day.";
  return `Next starts ${whenNext(next, scheduleState.now)}.`;
}

// The schedule part of a playlist's card: times, days and (optionally) dates.
function scheduleEditor(pl) {
  const box = document.createElement("div");
  const on = document.createElement("input");
  on.type = "checkbox";
  on.checked = !!pl.schedule?.on;
  const onLabel = document.createElement("label");
  onLabel.append(on, " Play on a schedule");
  const body = document.createElement("div");
  body.className = "playlist-schedule";
  const note = document.createElement("p");
  note.className = "hint playlist-next";
  const changed = () => {
    savePlaylists();
    note.textContent = scheduleNote(pl);
    setTimeout(refreshPlaylistStatus, 700); // after the save, for the new next start
  };
  const draw = () => {
    body.hidden = !pl.schedule?.on;
    body.replaceChildren();
    if (!pl.schedule?.on) return;
    const s = pl.schedule;
    const time = (key, label) => {
      const el = document.createElement("input");
      el.type = "time";
      el.value = s[key];
      el.setAttribute("aria-label", label);
      el.addEventListener("change", () => {
        const other = key === "start" ? s.end : s.start;
        if (!el.value || el.value === other) {
          status("The start and end need different times", "hint");
          el.value = s[key];
          return;
        }
        s[key] = el.value;
        changed();
        draw();
      });
      return el;
    };
    const times = document.createElement("div");
    times.className = "row";
    const kind = document.createElement("select");
    kind.setAttribute("aria-label", "Start at");
    kind.add(new Option("a time", "time"));
    kind.add(new Option("sunset", "sunset"));
    kind.value = s.start === "sunset" ? "sunset" : "time";
    kind.addEventListener("change", () => {
      if (kind.value === "sunset") { s.start = "sunset"; s.offset = 0; } else { s.start = s.end === "17:00" ? "16:00" : "17:00"; delete s.offset; }
      changed();
      draw();
    });
    times.append("From", kind);
    if (s.start === "sunset") {
      const mins = document.createElement("input");
      mins.type = "number";
      mins.min = 0;
      mins.max = 180;
      mins.step = 5;
      mins.value = Math.abs(s.offset || 0);
      mins.setAttribute("aria-label", "Minutes from sunset");
      const side = document.createElement("select");
      side.setAttribute("aria-label", "Before or after sunset");
      side.add(new Option("minutes after", "after"));
      side.add(new Option("minutes before", "before"));
      side.value = (s.offset || 0) < 0 ? "before" : "after";
      const set = () => {
        const m = Math.min(Math.max(Math.round(Number(mins.value) || 0), 0), 180);
        mins.value = m;
        s.offset = side.value === "before" ? -m : m;
        changed();
      };
      mins.addEventListener("change", set);
      side.addEventListener("change", set);
      times.append("(", mins, side, ")");
    } else times.append(time("start", "Start time"));
    times.append("to", time("end", "End time"));
    if (s.start === "sunset" ? s.end < "12:00" : s.end <= s.start) times.append(" (the next day)");
    if (s.start === "sunset" && s.end >= "12:00" && s.end < "22:00") {
      const warn = document.createElement("span");
      warn.className = "hint";
      warn.textContent = "On evenings the sun sets after this, it won't play.";
      times.append(warn);
    }
    const days = document.createElement("div");
    days.className = "row days";
    DAYS.forEach((name, d) => {
      const c = document.createElement("input");
      c.type = "checkbox";
      c.checked = s.days.includes(d);
      c.addEventListener("change", () => {
        s.days = c.checked ? [...s.days, d].sort() : s.days.filter((x) => x !== d);
        changed();
      });
      const l = document.createElement("label");
      l.append(c, name);
      days.append(l);
    });
    const dated = document.createElement("input");
    dated.type = "checkbox";
    dated.checked = !!s.from;
    const datesRow = document.createElement("div");
    datesRow.className = "row";
    const dl = document.createElement("label");
    dl.append(dated, " Only between");
    datesRow.append(dl);
    const pick = (key) => {
      const day = document.createElement("select"), month = document.createElement("select");
      for (let k = 1; k <= 31; k++) day.add(new Option(String(k), String(k).padStart(2, "0")));
      MONTHS.forEach((m, k) => month.add(new Option(m, String(k + 1).padStart(2, "0"))));
      day.setAttribute("aria-label", key === "from" ? "First day" : "Last day");
      month.setAttribute("aria-label", key === "from" ? "First month" : "Last month");
      [month.value, day.value] = s[key].split("-");
      const set = () => {
        const most = new Date(Date.UTC(2000, Number(month.value), 0)).getUTCDate(); // 29 in February
        if (Number(day.value) > most) day.value = String(most).padStart(2, "0");
        s[key] = `${month.value}-${day.value}`;
        changed();
      };
      day.addEventListener("change", set);
      month.addEventListener("change", set);
      return [day, month];
    };
    if (s.from) datesRow.append(...pick("from"), "and", ...pick("to"), "every year");
    dated.addEventListener("change", () => {
      if (dated.checked) {
        // From today on HA-liday Show's clock, for a week.
        const md = (d) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        const today = new Date(`${(scheduleState.now || new Date().toISOString()).slice(0, 10)}T00:00Z`);
        s.from = md(today);
        s.to = md(new Date(today.getTime() + 6 * 86400000));
      } else s.from = s.to = "";
      changed();
      draw();
    });
    body.append(times, days, datesRow);
  };
  on.addEventListener("change", () => {
    pl.schedule = { ...(pl.schedule || DEFAULT_SCHEDULE), days: [...(pl.schedule || DEFAULT_SCHEDULE).days], on: on.checked };
    changed();
    draw();
  });
  draw();
  note.textContent = scheduleNote(pl);
  box.append(onLabel, body, note);
  return box;
}

let savePlaylistsTimer = null;
function savePlaylists() {
  if (!playlistsLoaded) return;
  clearTimeout(savePlaylistsTimer);
  savePlaylistsTimer = setTimeout(async () => {
    try {
      await api("api/playlists", { method: "PUT", json: playlists });
      savePlaylistsTimer = null;
      status("Playlists saved", "saved", "playlists");
      bakeBlocks();
    } catch (e) { status(`Couldn't save playlists: ${e.message}`, true, "playlists"); }
  }, 300);
}

async function flushPlaylists() {
  if (!savePlaylistsTimer || !playlistsLoaded) return;
  clearTimeout(savePlaylistsTimer);
  savePlaylistsTimer = null;
  await api("api/playlists", { method: "PUT", json: playlists });
  await bakeBlocks();
}

// A playlist's colour, off and effect blocks play baked frames, as shows do, made here from
// effects.js. They're made again whenever a block or your lights change, or when HA-liday Show has
// none for a block (after an import, say). Which settings each was made with is kept in this
// browser; another browser makes them again once.
let blocksBaking = null, blocksAgain = false;
const lightsKey = () => JSON.stringify((app.deviceList || []).map((d) => [d.id, d.segments, d.parts, d.whole]));

function bakeBlocks() {
  if (blocksBaking) { blocksAgain = true; return blocksBaking; }
  blocksBaking = (async () => {
    do {
      blocksAgain = false;
      try { await bakeBlocksOnce(); } catch (e) { status(`Couldn't get a playlist's blocks ready: ${e.message}`, true, "playlists"); }
    } while (blocksAgain);
    blocksBaking = null;
  })();
  return blocksBaking;
}

async function bakeBlocksOnce() {
  if (!playlistsLoaded || !app.deviceList?.length) return;
  const { baked } = await api("api/blocks");
  const have = new Set(baked);
  const made = prefs.get("blockBakes", {});
  const lk = lightsKey();
  const todo = playlists.flatMap((p) => itemsOf(p)).filter((x) => ["off", "colour", "effect"].includes(x.type)
    && (!have.has(x.id) || made[x.id] !== bakeKey(x, lk)));
  for (const block of todo) {
    const lights = app.deviceList;
    const probe = blockShow(block, lights, PLAYLIST_MAX_BLOCK_S);
    const trackOf = (id) => probe.tracks.find((tr) => tr.device === id);
    const look = (t) => lights.flatMap((l) => [...composeLight(l, trackOf, t)]);
    const loop = loopLength(block, FPS, look);
    const blob = bake(blockShow(block, lights, loop), app.devices, FPS);
    const path = `api/blocks/${encodeURIComponent(block.id)}/baked`;
    try {
      if (blob.byteLength > PART) await sendParts(api, `${path}/part`, new Blob([blob]));
      else await api(path, { method: "PUT", body: blob, headers: { "Content-Type": "application/octet-stream" } });
    } catch (e) {
      if (/no such building block/.test(e.message)) continue; // taken out meanwhile
      throw e;
    }
    made[block.id] = bakeKey(block, lk);
  }
  // Forget blocks that have gone.
  const ids = new Set(playlists.flatMap((p) => itemsOf(p)).map((x) => x.id));
  for (const id of Object.keys(made)) if (!ids.has(id)) delete made[id];
  prefs.set("blockBakes", made);
}

// Whenever HA-liday Show opens in a browser, and when your lights change, so blocks a schedule
// starts are ready even if the Playlist editor hasn't been opened since.
async function keepBlocksReady() {
  try {
    if (!playlistsLoaded) {
      const found = await api("api/playlists");
      if (!playlistsLoaded) { playlists = found; playlistsLoaded = true; }
    }
    await bakeBlocks();
  } catch { /* the Playlist editor tries again */ }
}

let openPlaylistId = null; // the playlist open in the Playlist editor
const openPlaylist = () => playlists.find((p) => p.id === openPlaylistId) || null;
const playlistShowById = () => Object.fromEntries(playlistShows.map((x) => [x.id, x]));

function renderPlaylists() {
  renderPlaylistLists();
  if (!$("view-playlist").hidden) renderPlaylistEditor();
  markPlaylistPlaying();
}

// Your playlists (the Playlist editor's start) and Library → Playlists.
function renderPlaylistLists() {
  const rows = playlistRows(playlists, playlistShows);
  for (const b of document.querySelectorAll("[data-playlist-new]")) b.disabled = !playlistsLoaded;
  for (const box of document.querySelectorAll("[data-playlist-list]")) {
    if (!rows.length) {
      box.removeAttribute("role");
      box.innerHTML = playlistsLoaded ? `<p class="hint">No playlists yet. Press <b>+ New playlist</b> to make one.</p>` : "";
      continue;
    }
    box.setAttribute("role", "list");
    box.setAttribute("aria-label", "Your playlists");
    box.replaceChildren(...rows.map(playlistRow));
  }
}

function playlistRow(r) {
  const row = document.createElement("div");
  row.className = "show-row";
  row.setAttribute("role", "listitem");
  row.dataset.playlistId = r.id;
  const main = document.createElement("div");
  main.className = "show-main";
  const name = document.createElement("b");
  name.className = "show-name";
  name.textContent = r.name;
  const details = document.createElement("div");
  details.className = "hint";
  details.textContent = r.details;
  const next = document.createElement("div");
  next.className = "hint playlist-next";
  main.append(name, details, next);
  const actions = document.createElement("div");
  actions.className = "group show-actions";
  const open = button("Open", () => openPlaylistEditor(r.id), "primary");
  open.setAttribute("aria-label", `Open ${r.name}`);
  const play = button("▶ Play", () => { const pl = playlists.find((x) => x.id === r.id); if (pl) togglePlaylist(pl); }, "ghost playlist-play");
  play.dataset.empty = r.playable ? "0" : "1";
  if (!r.playable) play.title = "Add a saved show first";
  const del = button("Delete", async () => {
    const pl = playlists.find((x) => x.id === r.id);
    if (pl && await deletePlaylist(pl)) renderPlaylists();
  }, "ghost");
  del.setAttribute("aria-label", `Delete ${r.name}`);
  actions.append(open, play, del);
  row.append(main, actions);
  return row;
}

function openPlaylistEditor(id) {
  openPlaylistId = id;
  app.playlistChosen = true;
  showView("playlist");
}

async function togglePlaylist(pl) {
  try {
    if (playlistPlaying?.id === pl.id) await api("api/player/stop", { method: "POST" });
    else {
      await flushPlaylists();
      await bakeBlocks();
      await api(`api/playlists/${encodeURIComponent(pl.id)}/play`, { method: "POST" });
      status(`Playing ${pl.name}. It carries on until you press Stop, even with this page closed.`);
    }
  } catch (e) { status(e.message, true); }
  refreshPlaylistStatus();
}

async function deletePlaylist(pl) {
  if (!confirm(`Delete the playlist "${pl.name}"? Its shows are kept.`)) return false;
  if (playlistPlaying?.id === pl.id) await api("api/player/stop", { method: "POST" }).catch(() => {});
  playlists = playlists.filter((x) => x !== pl);
  savePlaylists();
  return true;
}

function newPlaylist() {
  if (!playlistsLoaded) return;
  const taken = new Set(playlists.map((p) => p.name.toLowerCase()));
  let name = "My playlist";
  for (let k = 2; taken.has(name.toLowerCase()); k++) name = `My playlist ${k}`;
  const pl = { id: `pl-${Date.now().toString(36)}`, name, shows: [], gap: 0, items: [] };
  playlists.push(pl);
  savePlaylists();
  openPlaylistEditor(pl.id);
}

// The Playlist editor ---------------------------------------------------------------
function renderPlaylistEditor() {
  const pl = openPlaylist();
  if (!pl) {
    if (playlistsLoaded) { app.playlistChosen = false; showView("playlist", { push: false }); }
    return;
  }
  pl.items = itemsOf(pl);
  if (document.activeElement !== $("pl-name")) $("pl-name").value = pl.name;
  renderBlockPalette();
  renderPlaylistBin();
  renderPlaylistOrder();
  $("pl-schedule").replaceChildren(scheduleEditor(pl)); // the list was just read again, so a new pl
}

const showHue = (k) => (k * 67 + 200) % 360; // each place in the order has its own colour, on the strip too

function cardShell(cls) {
  const li = document.createElement("li");
  li.className = `pl-card ${cls}`;
  const grip = document.createElement("span");
  grip.className = "pl-grip";
  grip.textContent = "⠿";
  grip.title = "Drag";
  grip.setAttribute("aria-hidden", "true");
  const text = document.createElement("div");
  text.className = "pl-card-text";
  li.append(grip, text);
  return [li, text];
}

function showCard(show, id) {
  const [li, text] = cardShell("pl-show");
  li.dataset.show = id;
  const name = document.createElement("b");
  const shelved = !show && playlistArchived.find((x) => x.id === id);
  name.textContent = show ? show.name : shelved ? shelved.name : "Deleted show";
  const details = document.createElement("span");
  details.className = "hint";
  details.textContent = shelved ? "Archived, so skipped until it's restored"
    : !show ? "Skipped"
      : [songName(show.song) || "No song", fmtLength(show.duration), show.baked ? "" : "not saved yet, so skipped"].filter(Boolean).join(" · ");
  li.classList.toggle("unplayable", !show?.baked);
  text.append(name, details);
  return li;
}

// The swatch at the left of a block's card, as on the strip.
function blockSwatch(type, colour) {
  const s = document.createElement("span");
  s.className = `pl-swatch pl-swatch-${type}`;
  if (type === "colour") s.style.background = colour;
  s.setAttribute("aria-hidden", "true");
  return s;
}

// Building blocks, to drag into the running order like a show.
function renderBlockPalette() {
  $("pl-blocks").replaceChildren(...Object.entries(PLAYLIST_BLOCKS).map(([type, b]) => {
    const [li, text] = cardShell("pl-block-card");
    li.dataset.block = type;
    text.before(blockSwatch(type, "#ff0000"));
    const name = document.createElement("b");
    name.textContent = b.label;
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = b.hint;
    text.append(name, hint);
    const add = button("+", () => changeOrder(inserted(openPlaylist().items, newBlock(type)), true), "ghost pl-add");
    add.title = "Add at the end";
    add.setAttribute("aria-label", `Add ${b.label} at the end`);
    li.append(add);
    li.addEventListener("pointerdown", (e) => dragCard(e, li, () => newBlock(type), null));
    return li;
  }));
}

function renderPlaylistBin() {
  const pl = openPlaylist();
  if (!pl) return;
  const q = $("pl-filter").value.trim().toLowerCase();
  const shows = [...playlistShows].sort((a, b) => a.name.localeCompare(b.name))
    .filter((s) => !q || s.name.toLowerCase().includes(q));
  $("pl-bin").replaceChildren(...shows.map((s) => {
    const li = showCard(s, s.id);
    const add = button("+", () => changeOrder(inserted(openPlaylist().items, { type: "show", id: s.id }), true), "ghost pl-add");
    add.title = "Add at the end";
    add.setAttribute("aria-label", `Add ${s.name} at the end`);
    li.append(add);
    li.addEventListener("pointerdown", (e) => dragCard(e, li, () => ({ type: "show", id: s.id }), null));
    return li;
  }));
  if (!shows.length) {
    $("pl-bin").innerHTML = `<li class="hint pl-empty">${playlistShows.length ? "No shows match that." : "No shows yet. Make one in the Show editor first."}</li>`;
  }
  markFull();
}

// + is greyed out once a playlist is full.
function markFull() {
  const pl = openPlaylist();
  if (!pl) return;
  for (const b of document.querySelectorAll("#pl-bin .pl-add, #pl-blocks .pl-add")) {
    const show = !!b.closest("#pl-bin");
    b.disabled = !fitsPlaylist(pl.items, { type: show ? "show" : "pause" });
    b.title = b.disabled ? (show ? `A playlist holds up to ${PLAYLIST_MAX} shows` : "This playlist is full") : "Add at the end";
  }
}

// A block's own settings, on its card in the running order.
function blockEditor(block) {
  const box = document.createElement("div");
  box.className = "pl-block-edit";
  const changed = (redraw = false) => {
    savePlaylists();
    if (redraw) renderPlaylistOrder();
    else drawPlaylistStrip();
  };
  const secs = document.createElement("input");
  secs.type = "number";
  secs.min = 0.5;
  secs.max = PLAYLIST_MAX_BLOCK_S;
  secs.step = 0.5;
  secs.value = block.seconds;
  secs.setAttribute("aria-label", "Seconds");
  secs.addEventListener("change", () => {
    const v = Math.min(Math.max(Math.round(Number(secs.value) * 10) / 10 || 0, 0.5), PLAYLIST_MAX_BLOCK_S);
    block.seconds = v;
    secs.value = v;
    changed(true);
  });
  const sl = document.createElement("label");
  sl.append(secs, " seconds");
  box.append(sl);
  if (block.type === "colour") {
    const c = document.createElement("input");
    c.type = "color";
    c.value = block.colour;
    c.setAttribute("aria-label", "Colour");
    c.addEventListener("change", () => { block.colour = c.value; changed(true); });
    box.append(c);
  }
  if (block.type === "effect") {
    const eff = document.createElement("select");
    eff.setAttribute("aria-label", "Effect");
    for (const k of PLAYLIST_BLOCK_EFFECTS) eff.add(new Option(EFFECTS[k].label, k, false, k === block.effect));
    eff.addEventListener("change", () => {
      block.effect = eff.value;
      block.params = defaultParams(eff.value);
      changed(true);
    });
    const style = document.createElement("select");
    style.setAttribute("aria-label", "Style");
    const presets = presetsFor(block.effect);
    const clip = { effect: block.effect, ...defaultParams(block.effect), ...block.params };
    style.add(new Option("Style…", ""));
    presets.forEach((p, k) => style.add(new Option(p.label || p.name, String(k), false, matchesPreset(p, clip))));
    style.hidden = !presets.length;
    style.addEventListener("change", () => {
      const p = presets[Number(style.value)];
      if (!p) return;
      block.params = { ...block.params, ...presetParams(p, clip) };
      changed();
    });
    const colours = document.createElement("select");
    colours.setAttribute("aria-label", "Colours");
    colours.add(new Option("Colours…", ""));
    allPalettes().forEach((p, k) => colours.add(new Option(p.name, String(k))));
    colours.hidden = !paletteKeys(block.effect).length;
    colours.addEventListener("change", () => {
      const p = allPalettes()[Number(colours.value)];
      if (!p) return;
      const c = { effect: block.effect, ...block.params };
      applyPalette(c, p.colors);
      for (const k of paletteKeys(block.effect)) block.params[k] = c[k];
      changed(true);
    });
    const sw = document.createElement("span");
    sw.className = "pl-colours";
    for (const k of paletteKeys(block.effect)) {
      const s = document.createElement("span");
      s.style.background = clip[k];
      sw.append(s);
    }
    box.append(eff, style, colours, sw);
  }
  return box;
}

function drawPlaylistStrip() {
  const pl = openPlaylist();
  if (!pl) return;
  const byId = playlistShowById();
  $("pl-summary").textContent = playlistSummary(pl.items, byId);
  const s = playlistStrip(pl.items, byId);
  $("pl-strip").hidden = !s.blocks.length;
  $("pl-strip").replaceChildren(...s.blocks.map((b) => {
    const el = document.createElement("span");
    el.className = `pl-block pl-block-${b.type}`;
    el.style.left = `${b.start * 100}%`;
    el.style.width = `${b.width * 100}%`;
    if (b.type === "show") el.style.setProperty("--hue", showHue(b.k));
    if (b.type === "colour") el.style.background = b.colour;
    el.title = `${b.k + 1}. ${b.name}${b.type === "show" ? `, ${fmtLength(b.seconds)}` : ""}`;
    if (b.width > 0.08 && b.type === "show") el.textContent = b.name;
    return el;
  }));
  $("pl-strip").setAttribute("aria-label", `What plays each time round: ${s.blocks.map((b) => b.name).join(", ")}`);
}

function renderPlaylistOrder() {
  const pl = openPlaylist();
  if (!pl) return;
  const byId = playlistShowById();
  drawPlaylistStrip();
  const order = $("pl-order");
  const items = pl.items;
  order.replaceChildren(...items.map((item, k) => {
    let li;
    if (item.type === "show") {
      li = showCard(byId[item.id], item.id);
      li.style.setProperty("--hue", showHue(k));
    } else {
      const [card, text] = cardShell(`pl-block-card pl-in-order pl-${item.type}`);
      li = card;
      li.dataset.blockId = item.id;
      text.before(blockSwatch(item.type, item.colour));
      const name = document.createElement("b");
      name.textContent = playlistBlockLabel(item);
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = PLAYLIST_BLOCKS[item.type]?.hint || "";
      text.append(name, hint, blockEditor(item));
    }
    li.dataset.k = k;
    const what = li.querySelector("b").textContent;
    const n = document.createElement("span");
    n.className = "pl-number";
    n.textContent = k + 1;
    li.querySelector(".pl-grip").after(n);
    const up = button("↑", () => changeOrder(moved(openPlaylist().items, k, k - 1)), "ghost");
    up.title = "Play earlier";
    up.setAttribute("aria-label", `Play ${what} earlier`);
    up.disabled = k === 0;
    const down = button("↓", () => changeOrder(moved(openPlaylist().items, k, k + 2)), "ghost");
    down.title = "Play later";
    down.setAttribute("aria-label", `Play ${what} later`);
    down.disabled = k === items.length - 1;
    const rm = button("✕", () => changeOrder(openPlaylist().items.filter((_, j) => j !== k)), "ghost");
    rm.title = "Take out of the playlist";
    rm.setAttribute("aria-label", `Take ${what} out`);
    const tools = document.createElement("span");
    tools.className = "pl-tools";
    tools.append(up, down, rm);
    li.append(tools);
    li.addEventListener("pointerdown", (e) => dragCard(e, li, null, k));
    return li;
  }));
  if (!items.length) order.innerHTML = `<li class="pl-empty">Drag shows and blocks here</li>`;
  markFull();
  markPlaylistPlaying();
}

function changeOrder(items, adding = false) {
  const pl = openPlaylist();
  if (!pl) return;
  if (items.length === pl.items.length && items.every((x, k) => x === pl.items[k])) {
    if (adding) status(`A playlist holds up to ${PLAYLIST_MAX} shows and ${PLAYLIST_MAX_ITEMS} things in all`, "hint");
    return;
  }
  pl.items = items;
  pl.shows = items.filter((x) => x.type === "show").map((x) => x.id);
  savePlaylists();
  renderPlaylistOrder();
}

// Dragging a card: a show or block into the running order, within it, or back out of it. `make`
// gives what a card from Your shows or Building blocks adds; `from` is a running-order card's place.
// Pointer events rather than the browser's own dragging, so it works with a finger too; a finger
// drags by the grip, so the lists still scroll.
function dragCard(e, card, make, from) {
  if (e.button !== 0 || e.target.closest("button, input, select, label")) return;
  if (e.pointerType !== "mouse" && !e.target.closest(".pl-grip")) return;
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY;
  const box = $("pl-order-box"), order = $("pl-order");
  let ghost = null, line = null, at = null, dx = 0, dy = 0;
  card.setPointerCapture(e.pointerId);
  const place = (ev) => {
    ghost.style.transform = `translate(${ev.clientX - dx}px, ${ev.clientY - dy}px)`;
    const r = box.getBoundingClientRect();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    const cards = [...order.querySelectorAll(":scope > li[data-k]")];
    if (inside) {
      at = dropIndex(cards.map((c) => { const b = c.getBoundingClientRect(); return b.top + b.height / 2; }), ev.clientY);
      const top = !cards.length ? 0 : at < cards.length ? cards[at].offsetTop - 4 : cards.at(-1).offsetTop + cards.at(-1).offsetHeight + 2;
      line.style.top = `${top}px`;
      if (!line.isConnected) order.append(line);
    } else {
      at = null;
      line.remove();
    }
    ghost.classList.toggle("pl-ghost-out", from !== null && !inside);
    if (ev.clientY < 50) window.scrollBy(0, -12);
    else if (ev.clientY > innerHeight - 50) window.scrollBy(0, 12);
  };
  const move = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      const r = card.getBoundingClientRect();
      dx = x0 - r.left;
      dy = y0 - r.top;
      ghost = card.cloneNode(true);
      ghost.classList.add("pl-ghost");
      ghost.style.width = `${r.width}px`;
      ghost.setAttribute("aria-hidden", "true");
      document.body.append(ghost);
      line = document.createElement("li");
      line.className = "pl-drop-line";
      line.setAttribute("aria-hidden", "true");
      card.classList.add("pl-dragging");
      document.body.classList.add("pl-drag-on");
    }
    place(ev);
  };
  const end = (ev, drop) => {
    card.removeEventListener("pointermove", move);
    card.removeEventListener("pointerup", up);
    card.removeEventListener("pointercancel", cancel);
    if (!ghost) return; // just a click
    ghost.remove();
    line.remove();
    card.classList.remove("pl-dragging");
    document.body.classList.remove("pl-drag-on");
    const pl = openPlaylist();
    if (!drop || !pl) return;
    if (at !== null) changeOrder(from === null ? inserted(pl.items, make(), at) : moved(pl.items, from, at), from === null);
    else if (from !== null) changeOrder(pl.items.filter((_, k) => k !== from));
  };
  const up = (ev) => end(ev, true);
  const cancel = (ev) => end(ev, false);
  card.addEventListener("pointermove", move);
  card.addEventListener("pointerup", up);
  card.addEventListener("pointercancel", cancel);
}

// selected stretch of time ---------------------------------------------------------
const rangeTracks = (r) => r.tracks.filter((t) => app.show.tracks[t]);

function renderRangeInspector(r) {
  const box = $("inspector");
  box.replaceChildren();
  const tracks = rangeTracks(r);
  const h = document.createElement("h3");
  const lights = tracks.filter((t) => !isHouse(t));
  h.textContent = `Selected ${fmtTime(r.start)} to ${fmtTime(r.end)} on `
    + (tracks.length === 1 ? trackName(tracks[0]) : lights.length === tracks.length ? `${tracks.length} lights`
      : `the House lane and ${lights.length} light${lights.length === 1 ? "" : "s"}`);
  box.append(h);
  const timeInput = (key) => {
    const el = document.createElement("input");
    el.type = "number";
    el.step = "0.01";
    el.min = "0";
    el.value = r[key].toFixed(2);
    el.addEventListener("change", () => {
      const v = Number(el.value);
      if (!Number.isFinite(v)) return;
      if (key === "start") r.start = Math.min(Math.max(0, v), r.end - 0.05);
      else r.end = Math.max(v, r.start + 0.05);
      app.select(app.selected);
    });
    const l = document.createElement("label");
    l.append(key === "start" ? "Start" : "End", el);
    return l;
  };
  const overlaps = tracks.some((t) => app.show.tracks[t].clips.some((c) => c.start < r.end && c.end > r.start));
  const del = button("Delete effects here", deleteRange, "ghost danger");
  del.disabled = !overlaps;
  // With the House lane in the selection, House effects go there and light effects on the lights.
  const onHouse = tracks.some(isHouse);
  const groups = !onHouse ? [[null, false]] : !lights.length ? [[null, true]]
    : [["For the lights", false], ["For the House lane, across all lights by where they are on the house photo", true]];
  const actions = document.createElement("div");
  actions.className = "add-actions";
  const choose = button("＋ Add effect…", () => chooseEffect({
    title: `Add an effect to ${h.textContent.replace(/^Selected /, "")}`,
    groups, dev: app.devices[app.show.tracks[lights[0] ?? tracks[0]]?.device], length: r.end - r.start,
    current: null, suggested: lights.length ? suggestionsFor(r, lights) : null,
    fit: (c, then) => fitAcross(c, tracks, then),
    onPick: (key, preset) => { app.lastAdd = { key, preset }; addToRange(key, preset); },
  }), "primary");
  actions.append(choose);
  const last = app.lastAdd;
  if (last && tracks.some((t) => fitsTrack(last.key, t))) {
    actions.append(button(`Add ${EFFECTS[last.key].label}${last.preset ? ` · ${last.preset.label}` : ""} again`,
      () => addToRange(last.key, last.preset), "ghost"));
  }
  // Adding is what a selection is for, so it comes first; clearing sits last, away from it.
  const times = document.createElement("div");
  times.className = "group";
  times.append(timeInput("start"), timeInput("end"),
    button("▶ Play this part", () => { app.setRegion(r); app.seek(r.start); play(); }, "ghost"));
  box.append(actions, times, del);
}

// Looks that suit the selected part of the song, in the current palette's colours.
function suggestionsFor(r, lights) {
  if (!app.show.sections?.length && !app.show.tempo) return null;
  const dev = app.devices[app.show.tracks[lights[0]].device];
  const { section, tier, looks } = suggestLooks({ ...app.show, duration: app.duration() }, r.start, r.end,
    dev?.segments || 15, prefs.get("genStyle", "balanced"), isSlow(dev));
  const colors = currentPalette().colors;
  for (const look of looks) {
    const tmp = { effect: look.effect };
    applyPalette(tmp, colors);
    delete tmp.effect;
    Object.assign(look.params, tmp);
  }
  const mood = { low: "quiet", mid: "steady", high: "loud" }[tier];
  return { heading: `Suggested for this ${section ? `part (${section.label}, ${mood})` : "part"} in ${currentPalette().name} colours`, looks };
}

function addToRange(effect, preset = null) {
  const r = app.selected.range;
  const clipFor = () => ({ effect, start: r.start, end: r.end, ...chosenParams(effect, preset) });
  const kind = rangeTracks(r).filter((t) => fitsTrack(effect, t));
  // Left off the lights it won't work on, unless that's allowed.
  const tracks = kind.filter((t) => !unfit(clipFor(), t));
  const left = kind.filter((t) => !tracks.includes(t));
  const label = `${EFFECTS[effect].label}${preset ? ` (${preset.label})` : ""}`;
  if (!tracks.length) { status(`${label} won't work on ${left.map(trackName).join(", ")}`, "hint"); return; }
  const added = tracks.map((t) => {
    const clip = clipFor();
    app.show.tracks[t].clips.push(clip);
    return { track: t, clip };
  });
  // One light: edit the new clip straight away. Several: keep the selection to add more.
  if (added.length === 1) app.selected = added[0];
  status(`Added ${label} to ${added.length === 1 ? trackName(tracks[0]) : `${added.length} lights`}`
    + (left.length ? `, not ${left.map(trackName).join(", ")}, where it won't work` : ""));
  app.changed();
}

// Clears the selected stretch: clips inside it go, clips crossing its edges are trimmed.
function deleteRange() {
  const r = app.selected.range;
  let n = 0;
  for (const t of rangeTracks(r)) {
    const kept = [];
    for (const c of app.show.tracks[t].clips) {
      if (c.end <= r.start || c.start >= r.end) { kept.push(c); continue; }
      n++;
      if (c.start < r.start) kept.push({ ...c, end: r.start });
      if (c.end > r.end) kept.push({ ...c, start: r.end });
    }
    app.show.tracks[t].clips = kept;
  }
  if (!n) { status("No effects in the selection"); return; }
  status(`Cleared ${n} effect${n > 1 ? "s" : ""} from the selection`);
  app.changed();
}

function deleteSelected() {
  const sel = app.selected;
  if (sel?.range) { deleteRange(); return; }
  if (!sel?.clip) return;
  const clips = app.show.tracks[sel.track].clips;
  clips.splice(clips.indexOf(sel.clip), 1);
  app.selected = null;
  app.changed();
}

function duplicateSelected() {
  const sel = app.selected;
  if (!sel?.clip) return;
  const len = sel.clip.end - sel.clip.start;
  const copy = { ...sel.clip, start: sel.clip.end, end: sel.clip.end + len };
  app.show.tracks[sel.track].clips.push(copy);
  app.selected = { track: sel.track, clip: copy };
  app.changed();
}

// demo ------------------------------------------------------------------------
function renderDemo() {
  const on = hasDemo(app.deviceList), can = canStartDemo(app.deviceList);
  $("btn-demo").hidden = on;
  $("btn-demo").disabled = !can;
  $("btn-demo-remove").hidden = !on;
  $("demo-hint").innerHTML = on
    ? `The demo is set up: ${DEMO_LIGHTS.length} planned lights on the sample house, a sample song and <b>${DEMO_SHOW}</b>. `
      + "Remove it when you're ready to add your own lights. The sample song stays in your songs."
    : can
      ? `Adds ${DEMO_LIGHTS.length} planned lights on the sample house, a sample song and a show ready to play, so you `
        + "can try everything before your lights are up. Nothing is sent to real lights."
      : "The demo is for a fresh start, before you add lights of your own.";
}

async function tryDemo() {
  if (!canStartDemo(app.deviceList)) { status("The demo is only for a fresh start, with no lights yet", "hint"); return; }
  if (!(await confirmDiscard())) return;
  showView("editor");
  try {
    status("Setting up the demo…");
    app.deviceList = DEMO_LIGHTS.map((d) => ({ ...d }));
    await saveDevices();
    if (house.sample) {
      const { paths, styles } = placeOnSample(app.deviceList, house.paths);
      Object.assign(house.paths, paths);
      Object.assign(house.styles, styles);
      await api("api/house", { method: "PUT", json: { paths: house.paths, styles: house.styles, pins: house.pins, dim: house.dim } });
    }
    const christmas = allPalettes().find((p) => p.name === "Christmas") || currentPalette();
    await makeShow(DEMO_SHOW, await sampleSong(), christmas.colors);
    status("The demo is ready: press ▶ Play");
  } catch (e) {
    status(`Couldn't set up the demo: ${e.message}`, true);
  }
}

async function sampleSong() {
  const song = await (await fetch(DEMO_SONG)).blob();
  return new File([song], DEMO_SONG_NAME, { type: "audio/mpeg" });
}

// A new show called `name` on the song `file`: uploaded to the songs folder (so speakers can play it),
// listened to, generated in `colors` (or left blank without them) and saved.
async function makeShow(name, file, colors) {
  status(`Adding ${file.name}…`);
  const ref = await uploadSong(api, file);
  await openShow(null);
  app.show.name = name;
  $("show-name").value = name;
  app.show.audio = ref;
  app.changed();
  await loadAudio(ref);
  if (!songBuffer) throw new Error("the song didn't load");
  if (colors) {
    if (!(await analyseSong())) throw new Error("the song couldn't be listened to");
    await generate({ colors, style: "balanced", house: true, build: prefs.get("genBuild", true) });
  }
  await save();
}

async function removeDemo() {
  if (!confirm("Remove the demo's lights and its show? Your own shows and songs are kept.")) return;
  const shows = await api("api/shows");
  for (const s of shows.filter((x) => x.name === DEMO_SHOW)) {
    await api(`api/shows/${encodeURIComponent(s.id)}`, { method: "DELETE" });
  }
  if (app.show.name === DEMO_SHOW) { app.dirty = false; app.chosen = false; await openShow(null, { chosen: false }); }
  Object.assign(house, withoutDemo(house));
  await api("api/house", { method: "PUT", json: { paths: house.paths, styles: house.styles, pins: house.pins, dim: house.dim } });
  app.deviceList = app.deviceList.filter((d) => !isDemoId(d.id));
  await saveDevices();
  await refreshShows();
  status("Removed the demo");
}

// your data -------------------------------------------------------------------
async function renderCopies() {
  let copies = [];
  try { copies = await api("api/backup/copies"); } catch { /* shown as none */ }
  const when = (s) => new Date(s * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  $("data-copies").replaceChildren(...copies.map((c) => {
    const get = Object.assign(document.createElement("a"), { className: "button ghost", textContent: "Download",
      href: `api/backup/copies/${encodeURIComponent(c.name)}`, download: c.name });
    const put = button("Put back", () => replaceData(`api/backup/copies/${encodeURIComponent(c.name)}/restore`, null,
      `Put back the copy from ${when(c.made)}? It replaces what you have now, and a copy of that is kept first.`));
    return wizardRow(c.reason === "import" ? "Before an import" : c.reason === "delete" ? "Before deleting" : "Before a fresh start",
      `${when(c.made)} · ${Math.max(1, Math.round(c.size / 1024))} KB`, get, put);
  }));
}

// Import, put back or start afresh: the add-on keeps a copy first, then the page reloads with the new data.
async function replaceData(url, body, question) {
  if (!confirm(question)) return;
  clearTimeout(autoSaveTimer);
  await stop();
  try {
    // Save the open show first, so the copy kept beforehand has your latest changes.
    if (app.dirty && worthSaving()) await save();
    status("Working…");
    const r = await api(url, { method: "POST", ...(body ? { body, headers: { "Content-Type": "application/zip" } } : {}) });
    if (url.endsWith("/reset")) {
      // A fresh start in this browser too: its layout, choices and the setup guide's "done".
      for (const k of Object.keys(localStorage)) if (k.startsWith("halidayshow.")) localStorage.removeItem(k);
    } else {
      prefs.set("lastShow", null);
    }
    status(r.restored ? `Imported ${r.restored} files` : "Done");
    app.dirty = false;  // what was open has been replaced, so don't ask about leaving it
    location.reload();
  } catch (e) {
    status(e.message, true);
    renderCopies();
  }
}

function wireData() {
  $("import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) replaceData("api/backup", file, `Import ${file.name}? It replaces your lights, shows, palettes, presets, `
      + "settings and house photo with the ones in the file. A copy of what you have now is kept first, under Your data.");
  });
  $("btn-afresh").addEventListener("click", () => replaceData("api/backup/reset", null, "Start afresh? This removes your "
    + "lights, shows, palettes, presets, settings and house photo, and resets this browser's layout, so HA-liday Show is "
    + "like new and the setup guide opens. Your songs are kept, and so is a copy of everything, under Your data."));
  $("btn-export").addEventListener("click", () => status("Exporting… check your downloads"));
}

// The Public page: switched on under Setup → Settings, set up on its own tab. What visitors can pick
// (shows and playlists, each with optional dates every year) and the queue they're waiting in.
let publicView = null;
let publicNames = { show: {}, playlist: {}, archived: {}, empty: new Set() };

function showPublicTab(on) {
  $("tab-public").hidden = !on;
  $("pub-open").hidden = !on;
}

// The queue and address from the server. It never touches publicView.items: those are yours, and an
// answer that left before your latest edit would undo it.
function renderPublicQueue(view) {
  showPublicTab(view.on);
  if (!view.on && shownPage === "public") showView("settings", { push: false });
  $("pub-now").textContent = queueText(view);
  $("pub-clear").hidden = !view.waiting.length;
  // The link with the code is on the Who can start shows card; this line is for problems with the port.
  $("pub-address").textContent = view.error || !view.listening ? addressText(view, location.hostname) : "";
  $("pub-address").hidden = !$("pub-address").textContent;
}

function renderPublicLook() {
  const view = publicView, look = view.look;
  const keep = (id, value) => { if (document.activeElement !== $(id)) $(id).value = value; };
  keep("pub-title", look.title);
  keep("pub-welcome", look.welcome);
  keep("pub-link-url", look.link);
  keep("pub-link-text", look.link_text);
  $("pub-theme").value = look.theme;
  $("pub-mode").value = look.mode;
  const own = look.theme === "custom";
  $("pub-colours").hidden = !own;
  $("pub-mode-label").hidden = own;
  for (const input of document.querySelectorAll("#pub-colours input[data-colour]")) {
    if (document.activeElement !== input) input.value = look.colours[input.dataset.colour];
  }
  const problems = own ? readability(look.colours) : [];
  $("pub-readability").textContent = problems.length ? `⚠ ${problems.join(" ")}` : own ? "✓ Everything is easy to read." : "";
  $("pub-readability").classList.toggle("warn", problems.length > 0);
  $("pub-spacing").value = look.spacing;
  $("pub-corners").value = look.corners;
  $("pub-size").value = look.size;
  $("pub-borders").checked = look.borders;
  $("pub-snow").checked = look.snow;
  for (const r of document.querySelectorAll("input[name=pub-picture]")) {
    r.checked = r.value === look.picture;
    if (r.value === "house") r.disabled = !view.has_house_photo;
    if (r.value === "upload") r.disabled = !view.has_picture;
  }
  $("pub-picture-hint").textContent = !view.has_house_photo && !view.has_picture
    ? "Add a photo under Setup → House, or choose a picture of your own."
    : !view.has_house_photo ? "There's no house photo yet (Setup → House)." : "";
  const src = look.picture === "house" ? "api/house/photo" : look.picture === "upload" ? "api/public/picture" : "";
  const preview = $("pub-picture-preview");
  if (src && preview.dataset.src !== `${src}#${view.has_picture}`) {
    preview.dataset.src = `${src}#${view.has_picture}`;
    preview.src = `${src}?t=${Date.now()}`;
  }
  preview.hidden = !src;
  $("pub-open-page").href = visitorLink(view, location.hostname);
}

function renderPublicHours() {
  const h = publicView.hours;
  const sunset = h.start === "sunset";
  $("pub-hours-on").checked = h.on;
  $("pub-hours").hidden = !h.on;
  $("pub-hours-start-kind").value = sunset ? "sunset" : "time";
  $("pub-hours-start").hidden = sunset;
  $("pub-hours-offset-wrap").hidden = !sunset;
  const keep = (id, value) => { if (document.activeElement !== $(id)) $(id).value = value; };
  if (!sunset) keep("pub-hours-start", h.start);
  keep("pub-hours-offset", h.offset ?? 0);
  keep("pub-hours-end", h.end);
  const days = $("pub-hours-days");
  if (!days.children.length) {
    DAYS.forEach((name, k) => {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = String(k);
      label.append(box, name);
      days.append(label);
    });
  }
  for (const box of days.querySelectorAll("input")) box.checked = h.days.includes(Number(box.value));
  const now = publicView.hours_now || { open: true };
  const hint = !h.on ? "Open all the time." : now.open ? "✓ Open now."
    : now.next ? `Closed now. Opens ${whenNext(now.next, now.now)}.`
      : sunset && !publicView.home ? "⚠ There's no home location to work out sunset from, so the page won't open. Set it in Home Assistant (Settings → System → General)."
        : !h.days.length ? "⚠ No days are ticked, so the page never opens."
          : "⚠ These hours don't come round: the sun doesn't set before they end. Pick a later closing time.";
  $("pub-hours-hint").textContent = hint;
  $("pub-hours-hint").classList.toggle("warn", hint.startsWith("⚠"));
}

function renderPublicGuard() {
  const view = publicView;
  const keep = (id, value) => { if (document.activeElement !== $(id)) $(id).value = value; };
  keep("pub-address-input", view.address);
  keep("pub-distance", view.distance);
  $("pub-nearby").checked = view.nearby;
  $("pub-distance").disabled = !view.nearby;
  $("pub-link").textContent = visitorLink(view, location.hostname);
  $("pub-sign").href = "sign";
  if (document.activeElement !== $("pub-sign-text")) $("pub-sign-text").value = view.look?.sign_text || "";
  $("pub-nearby-hint").textContent = nearbyText(view);
  $("pub-nearby-hint").classList.toggle("warn", view.nearby && !view.home);
}

function renderPublicItems() {
  const view = publicView;
  renderPublicGuard();
  renderPublicHours();
  renderPublicLook();
  const dayPick = (k, key, label) => {
    const it = view.items[k];
    const day = document.createElement("select"), month = document.createElement("select");
    for (let k = 1; k <= 31; k++) day.add(new Option(String(k), String(k).padStart(2, "0")));
    MONTHS.forEach((m, k) => month.add(new Option(m, String(k + 1).padStart(2, "0"))));
    day.setAttribute("aria-label", `${label} day`);
    month.setAttribute("aria-label", `${label} month`);
    [month.value, day.value] = it[key].split("-");
    const set = () => {
      const most = new Date(Date.UTC(2000, Number(month.value), 0)).getUTCDate(); // 29 in February
      if (Number(day.value) > most) day.value = String(most).padStart(2, "0");
      publicView.items[k][key] = `${month.value}-${day.value}`;
      savePublic();
    };
    day.addEventListener("change", set);
    month.addEventListener("change", set);
    return [day, month];
  };
  const rows = view.items.map((it, k) => {
    const row = document.createElement("div");
    row.className = "pub-item";
    const text = document.createElement("div");
    text.className = "pub-item-text";
    const name = document.createElement("div");
    name.className = "pub-item-name";
    const archived = it.kind === "show" && !(it.id in publicNames.show) && it.id in publicNames.archived;
    const missing = !archived && !(it.id in publicNames[it.kind]);
    const empty = it.kind === "playlist" && publicNames.empty.has(it.id);
    name.textContent = publicNames[it.kind][it.id] ?? publicNames.archived[it.id] ?? it.id;
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = archived ? "Archived, so visitors don't see it. Restore it under Library → Shows to show it again."
      : missing ? `Not found or not saved yet, so visitors don't see it.`
        : empty ? "Its shows are all archived or not saved yet, so visitors don't see it."
        : itemText(it, view.today);
    const dates = document.createElement("div");
    dates.className = "row";
    const dated = document.createElement("input");
    dated.type = "checkbox";
    dated.checked = !!it.from;
    const dl = document.createElement("label");
    dl.append(dated, " Only from");
    dates.append(dl);
    if (it.from) dates.append(...dayPick(k, "from", "First"), "until", ...dayPick(k, "to", "Last"), "every year");
    dated.addEventListener("change", () => {
      const cur = publicView.items[k];
      if (dated.checked) [cur.from, cur.to] = ["12-01", "01-06"];
      else cur.from = cur.to = "";
      savePublic();
    });
    text.append(name, hint, dates);
    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Remove";
    remove.title = "Takes it off the public page. The show or playlist itself stays.";
    remove.addEventListener("click", () => { publicView.items.splice(k, 1); savePublic(); });
    row.append(text, remove);
    return row;
  });
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Nothing yet. Add a show or playlist below.";
    rows.push(p);
  }
  $("pub-items").replaceChildren(...rows);
  const pick = $("pub-add-pick");
  const added = new Set(view.items.map((it) => `${it.kind}:${it.id}`));
  pick.replaceChildren();
  for (const kind of ["show", "playlist"]) {
    const group = document.createElement("optgroup");
    group.label = kind === "show" ? "Shows" : "Playlists";
    for (const [id, name] of Object.entries(publicNames[kind]).sort((a, b) => a[1].localeCompare(b[1]))) {
      if (!added.has(`${kind}:${id}`) && !(kind === "playlist" && publicNames.empty.has(id))) {
        group.append(new Option(name, `${kind}:${id}`));
      }
    }
    if (group.children.length) pick.append(group);
  }
  $("pub-add-row").hidden = !pick.options.length;
  $("pub-all-added").hidden = !!pick.options.length;
  $("pub-per-phone").value = view.per_phone;
  $("pub-queue").value = view.queue;
}

async function loadPublic({ items = false } = {}) {
  try {
    const view = await api("api/public");
    if (!pubPending) publicView = view;
    renderPublicQueue(view);
    $("pub-on").checked = view.on;
    if (!items) return;
    const [shows, lists, archived] = await Promise.all([api("api/shows"), api("api/playlists"),
      api("api/shows/archived").catch(() => [])]);
    // Archived shows aren't offered: visitors can't see them until they're restored.
    publicNames = {
      show: Object.fromEntries(shows.filter((s) => s.baked).map((s) => [s.id, s.name])),
      playlist: Object.fromEntries(lists.map((p) => [p.id, p.name])),
      archived: Object.fromEntries(archived.map((s) => [s.id, s.name])),
    };
    // Playlists with nothing visitors could play: every show archived, deleted or not saved yet.
    publicNames.empty = emptyPlaylists(lists, new Set(Object.keys(publicNames.show)));
    renderPublicItems();
  } catch (e) {
    status(`Couldn't load the public page settings: ${e.message}`, true, "public");
  }
}

// The preview beside the settings catches up as soon as something's saved.
function refreshPreview() {
  $("pub-preview-frame").contentWindow?.postMessage("refresh", location.origin);
}

// Saves go one at a time, each sending your latest settings; only the last answer is drawn.
let pubSaving = Promise.resolve();
let pubPending = 0;

function savePublic() {
  if (!publicView) {
    status("Couldn't save the public page settings: they haven't loaded. Reload the page and try again.", true, "public");
    return pubSaving;
  }
  publicView.on = $("pub-on").checked;
  publicView.address = $("pub-address-input").value.trim().replace(/\/+$/, "");
  publicView.nearby = $("pub-nearby").checked;
  if (Number($("pub-distance").value)) publicView.distance = Number($("pub-distance").value);
  if (shownPage === "public") {
    const sunset = $("pub-hours-start-kind").value === "sunset";
    const hours = {
      on: $("pub-hours-on").checked,
      start: sunset ? "sunset"
        : $("pub-hours-start").value || (publicView.hours.start === "sunset" ? "17:00" : publicView.hours.start),
      end: $("pub-hours-end").value || publicView.hours.end,
      days: [...$("pub-hours-days").querySelectorAll("input:checked")].map((b) => Number(b.value)),
      from: "", to: "",
    };
    if (sunset) hours.offset = Math.max(-180, Math.min(180, Math.round(Number($("pub-hours-offset").value) || 0)));
    // Start and end can't be the same time: say so, and keep the saved hours (everything else saves).
    if (hours.start !== hours.end) publicView.hours = hours;
    else status("Opening and closing can't be the same time. Pick a different time for one of them.", "hint");
    const picked = document.querySelector("input[name=pub-picture]:checked");
    publicView.look = {
      ...publicView.look,
      title: $("pub-title").value, welcome: $("pub-welcome").value, theme: $("pub-theme").value,
      mode: $("pub-mode").value, snow: $("pub-snow").checked, picture: picked ? picked.value : publicView.look.picture,
      link: $("pub-link-url").value.trim(), link_text: $("pub-link-text").value,
      sign_text: $("pub-sign-text").value,
      spacing: $("pub-spacing").value, corners: $("pub-corners").value, size: $("pub-size").value,
      borders: $("pub-borders").checked,
      colours: Object.fromEntries([...document.querySelectorAll("#pub-colours input[data-colour]")]
        .map((i) => [i.dataset.colour, i.value])),
    };
  }
  if (Number($("pub-per-phone").value)) publicView.per_phone = Number($("pub-per-phone").value);
  if (Number($("pub-queue").value)) publicView.queue = Number($("pub-queue").value);
  if (shownPage === "public") renderPublicItems();
  pubPending++;
  pubSaving = pubSaving.then(async () => {
    const { on, items, per_phone, queue, address, nearby, distance, look, hours } = publicView;
    try {
      const view = await api("api/public", {
        method: "PUT", json: { on, items, per_phone, queue, address, nearby, distance, look, hours },
      });
      if (pubPending === 1) {
        publicView = view;
        if (shownPage === "public") renderPublicItems();
      }
      renderPublicQueue(view);
      refreshPreview();
      status("Public page saved", "saved", "public");
    } catch (e) {
      status(`Couldn't save the public page settings: ${e.message}`, true, "public");
    } finally {
      pubPending--;
    }
  });
  return pubSaving;
}

function wirePublic() {
  $("pub-on").addEventListener("change", () => savePublic());
  $("pub-open").addEventListener("click", () => showView("public"));
  $("pub-per-phone").addEventListener("change", savePublic);
  for (const id of ["pub-address-input", "pub-nearby", "pub-distance", "pub-sign-text"]) {
    $(id).addEventListener("change", savePublic);
  }
  $("pub-hours-card").addEventListener("change", () => savePublic());
  $("pub-look").addEventListener("change", (e) => { if (e.target.id !== "pub-picture-file") savePublic(); });
  $("pub-picture-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      await pubSaving;
      status("Uploading the picture…");
      const view = await api("api/public/picture", { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      publicView = { ...view, items: publicView.items };
      renderPublicItems();
      refreshPreview();
      status("Public page picture saved", "saved", "public");
    } catch (e2) {
      status(`Couldn't save the picture: ${e2.message}`, true, "public");
    }
  });
  $("pub-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("pub-link").textContent);
      status("Visitors' link copied");
    } catch {
      status("Couldn't copy it here. Select the link and copy it yourself.", "hint");
    }
  });
  $("pub-new-code").addEventListener("click", async () => {
    if (!confirm("Make a new code? The old link, and any QR code you've printed, stop working.")) return;
    try {
      await pubSaving;
      const view = await api("api/public/code", { method: "POST" });
      publicView.code = view.code;
      renderPublicGuard();
      status("New code made. Share the new link", "saved", "public");
    } catch (e) {
      status(`Couldn't make a new code: ${e.message}`, true, "public");
    }
  });
  $("pub-queue").addEventListener("change", savePublic);
  $("pub-add").addEventListener("click", () => {
    const [kind, id] = $("pub-add-pick").value.split(":");
    if (!kind || !publicView) return;
    publicView.items.push({ kind, id, from: "", to: "" });
    savePublic();
  });
  $("pub-clear").addEventListener("click", async () => {
    try {
      renderPublicQueue(await api("api/public/clear", { method: "POST" }));
      status("Visitors' queue cleared");
    } catch (e) {
      status(`Couldn't clear the queue: ${e.message}`, true, "public");
    }
  });
  // Keep the queue up to date while you're looking at it.
  setInterval(async () => {
    if (document.hidden || shownPage !== "public") return;
    try {
      const view = await api("api/public");
      renderPublicQueue(view);
      // Open or closed changes by the clock, so the Opening hours line follows it.
      if (publicView && !pubPending) { publicView.hours_now = view.hours_now; renderPublicHours(); }
    } catch { /* offline for a moment */ }
  }, 5000);
}

// setup guide ----------------------------------------------------------------
// One window that walks a new user from nothing to a show. Each step uses the add-on's own windows
// (Add a light, Find, Add a speaker), so there's one way of doing each thing.
const WZ_STEPS = ["welcome", "lights", "check", "speaker", "house", "show"];
const wz = { step: "welcome", start: "setup", house: "sample", song: "sample", file: null };

function openWizard() {
  Object.assign(wz, { start: canStartDemo(app.deviceList) ? "demo" : "setup", house: "sample", song: "sample", file: null });
  $("wz-show-name").value = "My first show";
  $("wz-song-name").textContent = "An MP3 or other song file from this device.";
  wizardStep("welcome");
  if (!$("wizard").open) $("wizard").showModal();
}

function closeWizard() {
  prefs.set("wizard.done", true);
  if ($("wizard").open) $("wizard").close();
}

function pick(box, attr, value) {
  for (const b of $(box).querySelectorAll(`[data-${attr}]`)) b.classList.toggle("sel", b.dataset[attr] === value);
}

function wizardStep(step) {
  wz.step = step;
  const n = WZ_STEPS.indexOf(step);
  for (const sec of $("wizard").querySelectorAll("[data-wz-step]")) sec.hidden = sec.dataset.wzStep !== step;
  $("wz-dots").replaceChildren(...WZ_STEPS.map((s, i) => Object.assign(document.createElement("span"),
    { className: i <= n ? "on" : "" })));
  $("wz-step").textContent = `Step ${n + 1} of ${WZ_STEPS.length}`;
  $("wz-title").textContent = { welcome: "Welcome to HA-liday Show", lights: "Add your lights", check: "Check each light",
    speaker: "Where should the music play?", house: "Your house", show: "Make your first show" }[step];
  const q = (w) => $("wizard").querySelector(`[data-wz="${w}"]`);
  const back = q("back"), second = q("secondary"), first = q("primary");
  back.hidden = step === "welcome";
  second.hidden = step === "lights" || step === "check";
  $("wz-error").hidden = true;
  if (step === "welcome") {
    $("wz-start").querySelector('[data-start="demo"]').hidden = !canStartDemo(app.deviceList);
    pick("wz-start", "start", wz.start);
    second.textContent = "Skip, I'll look around";
    first.textContent = wz.start === "demo" ? "Start the demo" : "Let's start";
  } else if (step === "lights") {
    renderWizardLights();
    first.textContent = "Next";
  } else if (step === "check") {
    renderWizardCheck();
    first.textContent = "Next";
  } else if (step === "speaker") {
    renderWizardSpeakers();
    second.textContent = "Skip";
    first.textContent = "Next";
  } else if (step === "house") {
    const own = house.photo && !house.sample;
    $("wz-house").hidden = own;
    if (own) wz.house = "photo";
    pick("wz-house", "house", wz.house);
    $("wz-house-note").innerHTML = own ? "Your photo is already up. Trace your lights on it under <b>Setup → House</b>."
      : wz.house === "photo" && !house.sample ? "Photo saved. Trace your lights on it under <b>Setup → House</b> when you're ready." : "";
    second.textContent = "Skip";
    first.textContent = "Next";
  } else if (step === "show") {
    pick("wz-song", "song", wz.song);
    second.textContent = "Start with a blank show";
    first.textContent = "✨ Generate my show";
    first.disabled = !app.deviceList.length;
    first.title = app.deviceList.length ? "" : "Add a light first, so there's something to put effects on";
    return;
  }
  first.disabled = false;
  first.title = "";
}

function wizardRow(title, detail, ...end) {
  const row = document.createElement("div");
  row.className = "wz-row";
  const grow = document.createElement("span");
  grow.className = "grow";
  grow.append(Object.assign(document.createElement("b"), { textContent: title }),
    Object.assign(document.createElement("span"), { textContent: detail }));
  row.append(grow, ...end);
  return row;
}

const lightWhere = (d) => isHa(d) ? (d.entity || "Home Assistant") : d.ip || "Planned, no IP yet";
const lightKind = (d) => isWled(d) ? "WLED" : isHa(d) ? "Home Assistant" : d.kind === "twinkly" ? "Twinkly"
  : d.kind === "ddp" ? "DDP" : d.kind === "e131" ? "E1.31" : d.sku || "Govee";

function renderWizardLights() {
  $("wz-lights").replaceChildren(...app.deviceList.map((d) => wizardRow(d.name, `${lightKind(d)} · ${lightWhere(d)}`)));
  $("wz-add-light").textContent = app.deviceList.length ? "+ Add another light" : "+ Add a light";
}

function renderWizardCheck() {
  const box = $("wz-check");
  if (!app.deviceList.length) {
    box.replaceChildren(wizardRow("No lights yet", "Go back to add one, or carry on and add them later."));
    return;
  }
  box.replaceChildren(...app.deviceList.map((d) => {
    const end = [];
    if (!linked(d)) end.push(Object.assign(document.createElement("span"), { className: "hint", textContent: "Planned: test it when it arrives" }));
    else if (isPixels(d) || isHa(d)) {
      end.push(button("Test", () => testLight(d)));
      end.push(Object.assign(document.createElement("span"), { className: "hint ok", textContent: "✓ Set up" }));
    } else {
      end.push(button("Test", async () => { if (await testLight(d)) status(`Testing ${d.name} for 20 seconds`); }));
      const find = button("Find", () => findSegments(d), "ghost");
      find.disabled = LONG_PROTOCOLS.includes(d.protocol);
      end.push(find);
    }
    return wizardRow(d.name, isHa(d) ? "One colour at a time" : `${d.segments} segments`, ...end);
  }));
}

function renderWizardSpeakers() {
  const off = app.haAvailable === false;
  $("wz-speaker-help").innerHTML = off
    ? "Home Assistant isn't reachable from HA-liday Show, so songs play in this browser for now. You can add a speaker later under <b>Setup → Speakers</b>."
    : "Add the speaker the music should play on, and the lights follow it. Or skip this and play songs in this browser while you design.";
  $("wz-add-speaker").hidden = off;
  $("wz-speakers").replaceChildren(...(off ? [] : app.speakers.map((s) => wizardRow(s.name, s.entity_id,
    Object.assign(document.createElement("span"), { className: "hint ok", textContent: "✓ Added" })))));
}

async function wizardNext() {
  const step = wz.step;
  if (step === "welcome") {
    if (wz.start === "demo") { closeWizard(); await tryDemo(); return; }
    wizardStep("lights");
  } else if (step === "lights") wizardStep("check");
  else if (step === "check") wizardStep("speaker");
  else if (step === "speaker") {
    // The first speaker added plays shows started from automations, until one is picked in Setup → Speakers.
    if (app.speakers.length && !app.defaultSpeaker) {
      try {
        await api("api/speakers/show", { method: "PUT", json: { entity_id: app.speakers[0].entity_id } });
        await loadSpeakers();
      } catch { /* it can be picked under Setup → Speakers */ }
    }
    wizardStep("house");
  } else if (step === "house") {
    if (wz.house === "sample" && house.sample) {
      const todo = houseLights().filter((d) => !house.paths[d.id]?.length);
      if (todo.length) placeLightsOnSample(todo);
    }
    wizardStep("show");
  } else if (step === "show") await wizardMakeShow(true);
}

async function wizardMakeShow(generated) {
  const name = $("wz-show-name").value.trim() || "My first show";
  const file = wz.song === "file" ? wz.file : await sampleSong();
  if (!file) { $("wz-error").textContent = "Choose a song first, or use the sample song."; $("wz-error").hidden = false; return; }
  closeWizard();
  showView("editor");
  try {
    await makeShow(name, file, generated ? (seasonalPalette() || allPalettes().find((p) => p.name === "Christmas")).colors : null);
    status(generated ? `${name} is ready: press ▶ Play` : `${name} is ready for your effects`);
  } catch (e) {
    status(`Couldn't make the show: ${e.message}`, true);
  }
}

function wireWizard() {
  const dlg = $("wizard");
  $("btn-wizard").addEventListener("click", openWizard);
  dlg.addEventListener("cancel", () => prefs.set("wizard.done", true));
  dlg.addEventListener("click", (e) => {
    const what = e.target.closest("[data-wz]")?.dataset.wz;
    if (what === "close") closeWizard();
    else if (what === "back") wizardStep(WZ_STEPS[WZ_STEPS.indexOf(wz.step) - 1]);
    else if (what === "primary") wizardNext();
    else if (what === "secondary") {
      if (wz.step === "welcome") closeWizard();
      else if (wz.step === "show") wizardMakeShow(false);
      else wizardStep(WZ_STEPS[WZ_STEPS.indexOf(wz.step) + 1]);
    }
    const start = e.target.closest("[data-start]")?.dataset.start;
    if (start) { wz.start = start; wizardStep("welcome"); }
    const where = e.target.closest("[data-house]")?.dataset.house;
    if (where === "sample") { wz.house = "sample"; pick("wz-house", "house", "sample"); }
    const song = e.target.closest("[data-song]")?.dataset.song;
    if (song === "sample") { wz.song = "sample"; pick("wz-song", "song", "sample"); }
  });
  $("wz-photo").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    await house.upload(file);
    wz.house = "photo";
    renderHouseLights();
    wizardStep("house");
  });
  $("wz-song-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    wz.file = file;
    wz.song = "file";
    $("wz-song-name").textContent = file.name;
    if ($("wz-show-name").value === "My first show") $("wz-show-name").value = file.name.replace(/\.[^.]+$/, "");
    pick("wz-song", "song", "file");
  });
  $("wz-add-light").addEventListener("click", openAddLight);
  $("add-dialog").addEventListener("close", () => { if (dlg.open) renderWizardLights(); });
  $("wz-add-speaker").addEventListener("click", openAddSpeaker);
  $("speaker-dialog").addEventListener("close", () => { if (dlg.open) renderWizardSpeakers(); });
  $("finder").addEventListener("close", () => { if (dlg.open && wz.step === "check") renderWizardCheck(); });
}

// shows -----------------------------------------------------------------------
// Your shows, drawn into every [data-show-list]: the Show editor's start and Library → Shows.
let showListCache = [];
async function renderShowLists(shows = null) {
  try { showListCache = shows || await api("api/shows"); } catch { return; }
  renderArchivedShows();
  const rows = showRows(showListCache, prefs.get("lastShow", null));
  for (const box of document.querySelectorAll("[data-show-list]")) {
    if (rows.length) {
      box.setAttribute("role", "list");
      box.setAttribute("aria-label", "Your shows");
    } else {
      box.removeAttribute("role");
      box.removeAttribute("aria-label");
    }
    if (!rows.length) {
      box.innerHTML = `<p class="hint">No shows yet. Press <b>+ New show</b> to make your first one.</p>`;
      continue;
    }
    box.replaceChildren(...rows.map((r) => showRow(r)));
  }
}

function showRow(r) {
  const row = document.createElement("div");
  row.className = "show-row";
  row.setAttribute("role", "listitem");
  row.dataset.showId = r.id;
  const main = document.createElement("div");
  main.className = "show-main";
  const name = document.createElement("b");
  name.className = "show-name";
  name.textContent = r.name;
  const head = document.createElement("div");
  head.append(name);
  if (r.last) {
    const badge = document.createElement("span");
    badge.className = "show-last";
    badge.textContent = "Last edited";
    head.append(badge);
  }
  const details = document.createElement("div");
  details.className = "hint";
  details.textContent = r.details;
  main.append(head, details);
  const actions = document.createElement("div");
  actions.className = "group show-actions";
  const open = button("Open", () => openFromList(r.id), "primary");
  open.setAttribute("aria-label", `Open ${r.name}`);
  const dup = button("Duplicate", () => duplicateShow(r), "ghost");
  dup.setAttribute("aria-label", `Duplicate ${r.name}`);
  const ren = button("Rename", () => renameInPlace(row, head, r), "ghost");
  open.dataset.act = "open";
  ren.dataset.act = "rename";
  ren.setAttribute("aria-label", `Rename ${r.name}`);
  const share = button("Share", () => shareShow(r), "ghost");
  share.setAttribute("aria-label", `Share ${r.name}`);
  share.title = "Download this show as a file you can send to anyone with HA-liday Show";
  const rm = button("Remove…", () => openRemoveShow(r), "ghost");
  rm.setAttribute("aria-label", `Archive or delete ${r.name}`);
  rm.dataset.act = "remove";
  actions.append(open, dup, ren, share, rm);
  row.append(main, actions);
  return row;
}

// Sharing shows (sharing.js) ------------------------------------------------------
// Share downloads a .halidayshow file; Import show reads one into a new show, in two steps: its
// name and song, then which of your lights plays each of theirs.
const shareContext = () => ({ models: app.models || {}, positions: housePositionsAll() });

function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function shareShow(r) {
  try {
    // The open show with changes not yet saved is shared as you see it.
    const show = r.id === app.showId ? app.show : await api(`api/shows/${encodeURIComponent(r.id)}`);
    const share = makeShare(show, app.deviceList, shareContext());
    if (!share.tracks.length) { status(`${r.name} has no effects yet, so there's nothing to share`, "hint"); return; }
    const file = shareFileName(share.name);
    downloadText(file, JSON.stringify(share));
    status(`Downloaded ${file}. Send it to anyone with HA-liday Show. The song isn't in it, so they use their own copy`);
  } catch (err) {
    status(`Couldn't share ${r.name}: ${err.message}`, true);
  }
}

const imp = { step: 1, share: null, song: "", taken: [], mine: [], plan: {}, suggested: {}, length: null, asked: 0 };

async function importFile(file) {
  let share;
  try {
    share = readShare(await file.text());
  } catch (err) {
    status(`Couldn't import ${file.name}: ${err.message}`, true);
    return;
  }
  if (!(await confirmDiscard())) return;
  await refreshAudio().catch(() => {});
  imp.taken = (await api("api/shows").catch(() => [])).map((s) => s.name);
  imp.share = share;
  imp.mine = myLights(app.deviceList.filter((d) => !isDemoId(d.id)), shareContext());
  imp.plan = suggest(share.lights, imp.mine);
  imp.suggested = Object.fromEntries(Object.entries(imp.plan).map(([k, p]) => [k, p.light]));
  const guess = share.song ? suggestSong(share.song.name, app.songs || []) : null;
  imp.song = guess ? JSON.stringify(guess) : "";
  imp.length = null;
  $("im-name").value = freeName(share.name, imp.taken);
  $("im-title").textContent = `Import show: ${share.name}`;
  $("import-dialog").showModal();
  imSongs();
  imStep(1);
}

function imSongs() {
  const s = imp.share.song;
  $("im-song-hint").textContent = s
    ? `It was made to ${s.name} (${fmtLength(s.length)}). Songs aren't shared, so pick your copy.`
    : "It was made with no song.";
  const rows = [...$("audio-select").options].map((o) => {
    const ref = o.value ? JSON.parse(o.value) : null;
    return { value: o.value, label: ref ? songLabel(ref) : "No song for now",
      detail: ref ? `${ref.source === "media" ? "Media" : "Uploaded"}: ${ref.path}` : "Add it later in the editor, under ⚙ Show settings…" };
  });
  nsRadioRows($("im-songs"), "im-song", rows, imp.song, (v) => { imp.song = v; imSongs(); });
  imLength();
}

// The picked song's length against theirs, read from the file's own details (nothing is decoded).
function songSeconds(ref) {
  return new Promise((done) => {
    const a = new Audio();
    a.preload = "metadata";
    a.addEventListener("loadedmetadata", () => done(Number.isFinite(a.duration) ? a.duration : null));
    a.addEventListener("error", () => done(null));
    setTimeout(() => done(null), 8000);
    a.src = audioUrl(ref);
  });
}

async function imLength() {
  const mine = ++imp.asked, el = $("im-length"), theirs = imp.share.song?.length;
  if (!imp.song || !theirs) { imp.length = null; el.hidden = true; return; }
  const secs = await songSeconds(JSON.parse(imp.song));
  if (mine !== imp.asked) return;
  imp.length = lengthNote(theirs, secs);
  el.hidden = !imp.length;
  if (imp.length) notice(el, imp.length.ok ? "ok" : "warn", imp.length.ok ? `Your copy is ${imp.length.text}.` : `${imp.length.text}.`);
}

function imStep(step) {
  imp.step = step;
  $("im-step-1").hidden = step !== 1;
  $("im-step-2").hidden = step !== 2;
  $("im-back").hidden = step !== 2;
  $("im-add-song").hidden = step !== 1;
  $("im-next").textContent = step === 1 ? "Next →" : "Import show";
  if (step === 1) {
    $("im-count").textContent = "";
    $("im-name").focus();
    return;
  }
  const note = $("im-song-note");
  const ref = imp.song ? JSON.parse(imp.song) : null;
  note.hidden = false;
  if (!ref) notice(note, "warn", "No song yet. Add it later in the editor, under ⚙ Show settings….");
  else if (imp.length && !imp.length.ok) notice(note, "warn", `${songLabel(ref)}: ${imp.length.text}.`);
  else notice(note, "ok", `Song: your copy of ${songLabel(ref)}${imp.length ? `, ${imp.length.text}` : ""}.`);
  imLights();
  $("im-lights").querySelector("select")?.focus();
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A small map of a house: every light as a faint box, the one that matters filled in.
function miniMap(all, current, label) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 72 46");
  svg.setAttribute("class", "im-map");
  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
  };
  el("rect", { x: 1, y: 1, width: 70, height: 44, rx: 4, class: "frame" });
  if (!current?.where) {
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("empty");
    return svg;
  }
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  const box = (w, cls) => el("rect", { x: 5 + w.x * 62, y: 5 + w.y * 36, width: Math.max(w.w * 62, 2.5),
    height: Math.max(w.h * 36, 2.5), rx: 1, class: cls });
  for (const l of all) if (l !== current && l.where) box(l.where, "other");
  box(current.where, "this");
  return svg;
}

function imLights() {
  const { share, mine, plan } = imp;
  const box = $("im-lights");
  const focused = document.activeElement?.id;
  const byId = new Map(mine.map((m) => [m.id, m]));
  let hint = share.lights.length
    ? `It was made for ${plural(share.lights.length, "light")}. Pick which of your lights plays each one. Effects stretch to fit your light, however many bulbs it has.`
    : "It only has effects across the whole house, so there are no lights to match.";
  if (share.lights.length && !mine.length) hint += " You haven't any lights yet: add them under Setup → Devices first.";
  $("im-lights-hint").textContent = hint;
  const usedBy = (id, but) => share.lights.filter((l) => l.key !== but && plan[l.key]?.light === id).map((l) => l.name);
  const rows = [];
  if (share.lights.length && mine.length) {
    const head = document.createElement("div");
    head.className = "im-head";
    head.setAttribute("aria-hidden", "true");
    head.innerHTML = "<span>In the show</span><span></span><span>Plays on your light</span>";
    rows.push(head);
  }
  for (const t of share.lights) {
    const p = plan[t.key];
    const m = p.light ? byId.get(p.light) : null;
    const row = document.createElement("div");
    row.className = "im-row";
    const theirs = document.createElement("div");
    theirs.className = "im-light";
    const text = document.createElement("div");
    const name = document.createElement("b");
    name.textContent = t.name;
    const detail = document.createElement("span");
    detail.className = "hint";
    detail.textContent = [t.type.label, t.segments === 1 ? "one colour" : plural(t.segments, "segment"),
      t.parts.length ? plural(t.parts.length, "part") : ""]
      .filter(Boolean).join(" · ");
    text.append(name, detail);
    theirs.append(miniMap(share.lights, t, `Where ${t.name} is on their house`), text);
    const arrow = document.createElement("span");
    arrow.className = "im-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    const yours = document.createElement("div");
    yours.className = "im-pick";
    const col = document.createElement("div");
    const label = document.createElement("label");
    label.className = "im-on";
    label.htmlFor = `im-l-${t.key}`;
    label.textContent = "Plays on your light";
    const pick = document.createElement("select");
    pick.id = `im-l-${t.key}`;
    pick.setAttribute("aria-label", `Your light for ${t.name}`);
    for (const l of mine) {
      const others = usedBy(l.id, t.key);
      pick.add(new Option(others.length ? `${l.name} (also playing ${listOf(others)})` : l.name, l.id, false, l.id === p.light));
    }
    pick.add(new Option("Leave it out", "", false, !p.light));
    pick.addEventListener("change", () => {
      const to = byId.get(pick.value) || null;
      plan[t.key] = { light: to?.id || null, why: "", parts: partPlan(t, to) };
      imLights();
    });
    const why = document.createElement("span");
    why.className = "im-why";
    const shared = m ? usedBy(m.id, t.key) : [];
    if (m && shared.length) {
      why.classList.add("hint");
      why.textContent = `Shares this light with ${listOf(shared)}. Where both play at once, the later effect shows.`;
    } else if (m && p.why && imp.suggested[t.key] === m.id) {
      why.classList.add("ok");
      why.textContent = `✓ Suggested: ${p.why}`;
    } else if (!m && !imp.suggested[t.key] && mine.length) {
      why.classList.add("warn");
      why.textContent = "⚠ None of your lights is much like it. Its effects won't come across unless you pick one.";
    } else if (!m) {
      why.classList.add("hint");
      why.textContent = "Left out: its effects won't come across.";
    }
    col.append(label, pick, why);
    // Your own map only once your lights are on the house photo.
    if (mine.some((l) => l.where)) yours.append(miniMap(mine, m, `Where ${m?.name} is on your house`));
    yours.append(col);
    row.append(theirs, arrow, yours);
    if (m && t.parts.length) row.append(imParts(t, m, p));
    rows.push(row);
  }
  box.replaceChildren(...rows);
  if (focused?.startsWith("im-")) $(focused)?.focus();
  const { matched, left, total } = matchCount(share, plan);
  $("im-count").textContent = total ? `${matched} of ${plural(total, "light")} matched${left ? ` · ${left} left out` : ""}` : "";
}

// Their light's parts, each onto one of your parts, your whole light, or nowhere.
function imParts(t, m, p) {
  const box = document.createElement("div");
  box.className = "im-parts";
  const head = document.createElement("span");
  head.className = "im-parts-head";
  head.textContent = "Parts";
  box.append(head);
  for (const part of t.parts) {
    const name = document.createElement("label");
    name.htmlFor = `im-p-${t.key}-${part.key}`;
    name.textContent = part.name;
    const pick = document.createElement("select");
    pick.id = `im-p-${t.key}-${part.key}`;
    const at = p.parts[part.key] ?? null;
    for (const mp of m.parts) pick.add(new Option(mp.name, mp.id, false, mp.id === at));
    pick.add(new Option(m.whole ? "Whole light" : "All its parts", "whole", false, at === "whole"));
    pick.add(new Option("Leave it out", "", false, !at));
    pick.addEventListener("change", () => { p.parts[part.key] = pick.value || null; });
    box.append(name, pick);
  }
  return box;
}

async function imSubmit(e) {
  e.preventDefault();
  const name = $("im-name").value.trim();
  if (imp.step === 1) {
    if (!name) { $("im-name").focus(); return; }
    if (imp.taken.some((n) => n.toLowerCase() === name.toLowerCase())) {
      status(`There's already a show called ${name}. Give this one its own name`, "hint");
      $("im-name").select();
      return;
    }
    imStep(2);
    return;
  }
  const share = imp.share;
  $("import-dialog").close();
  await openShow(null);
  Object.assign(app.show, { name, audio: imp.song ? JSON.parse(imp.song) : null, duration: share.duration,
    beats: share.beats, bars: share.bars, sections: share.sections, tracks: buildTracks(share, imp.plan, imp.mine) });
  if (share.tempo !== null) app.show.tempo = share.tempo;
  ensureTracks();
  $("show-name").value = name;
  $("duration").value = Math.round(share.duration);
  showView("editor");
  try {
    await loadAudio(app.show.audio);
    app.changed();
    await save();
    status(`${name} imported`, "saved", "show");
  } catch (err) {
    status(`Couldn't save ${name}: ${err.message}`, true, "show");
  }
  renderSaveState();
  layoutPreview();
  timeline.layout();
  reportUnfit();
}

// Library → Songs --------------------------------------------------------------
let songRowsCache = [], songsMore = false, songsAsked = 0;
async function renderSongsPage() {
  const mine = ++songsAsked; // only the latest answer is drawn
  try {
    const [list, shows, drafts] = await Promise.all([api("api/songs"), api("api/shows"), api("api/drafts").catch(() => [])]);
    if (mine !== songsAsked) return;
    songRowsCache = songRows(list.songs, shows);
    songDrafts = drafts;
    songsMore = list.more;
  } catch (e) { status(`Couldn't list your songs: ${e.message}`, true, "songs"); return; }
  status("", "info", "songs");
  drawSongRows();
  renderArchivedSongs();
}

function drawSongRows() {
  const rows = filterRows(songRowsCache, $("song-filter").value);
  const box = $("songs-page-list");
  songSeen?.disconnect();
  const all = `${songRowsCache.length}${songsMore ? "+" : ""}`;
  $("song-count").textContent = !songRowsCache.length ? ""
    : (rows.length === songRowsCache.length ? `${all} song${rows.length === 1 && !songsMore ? "" : "s"}` : `${rows.length} of ${all}`)
      + (songsMore ? ". Only the first 2000 songs in your media folder are listed." : "");
  if (!rows.length) {
    box.removeAttribute("role");
    box.innerHTML = songRowsCache.length
      ? `<p class="hint">No songs match that.</p>`
      : `<p class="hint">No songs yet. Press <b>+ Add a song</b> to add one.</p>`;
    return;
  }
  box.setAttribute("role", "list");
  box.setAttribute("aria-label", "Your songs");
  box.replaceChildren(...rows.map(songRow));
  // Drafts whose song has been archived, deleted or moved, so they can still be found and deleted.
  const keys = new Set(songRowsCache.map((r) => r.key));
  const lost = songDrafts.filter((d) => d.base && !keys.has(songKey(d.base)));
  if (lost.length && !$("song-filter").value.trim() && !songsMore) {
    const row = document.createElement("div");
    row.className = "show-row has-drafts-row";
    const head = document.createElement("div");
    head.className = "show-main";
    head.innerHTML = `<div><b class="show-name">Drafts of songs that aren't here any more</b></div>
      <div class="hint">Restore the song (under Archived songs) to open one, or delete it.</div>`;
    row.append(head);
    const list = draftList({ key: null, name: "songs that aren't here" }, lost);
    if (list) row.append(list);
    box.append(row);
  }
}

// The Music editor's drafts, listed under the song each started from.
let songDrafts = [];
let draftsRedraw = null;
function draftsChanged() {
  clearTimeout(draftsRedraw);
  draftsRedraw = setTimeout(() => {
    if (!$("view-songlist").hidden || !$("view-songs").hidden) renderSongsPage();
  }, 300);
}

function draftList(r, drafts = null) {
  const mine = (drafts || songDrafts.filter((d) => d.base && songKey(d.base) === r.key))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  if (!mine.length) return null;
  const box = document.createElement("div");
  box.className = "song-drafts";
  box.setAttribute("aria-label", `Drafts of ${r.name}`);
  for (const d of mine) {
    const line = document.createElement("div");
    line.className = "song-draft";
    const name = document.createElement("b");
    name.textContent = `✎ ${d.name}`;
    const about = document.createElement("span");
    about.className = "hint";
    about.textContent = d.length ? fmtTime(d.length, false) : "";
    line.append(name, about);
    if (d.made) {
      const made = document.createElement("span");
      made.className = "hint";
      made.textContent = `· made ${d.made.path.split("/").pop()}`;
      line.append(made);
    } else {
      const badge = document.createElement("span");
      badge.className = "show-last";
      badge.textContent = "Draft";
      line.append(badge);
    }
    const spacer = document.createElement("span");
    spacer.className = "spacer";
    const open = button("Open", () => openDraft(d.id), "");
    open.setAttribute("aria-label", `Open the draft ${d.name}`);
    const rename = button("Rename…", () => renameDraft(d), "ghost");
    rename.setAttribute("aria-label", `Rename the draft ${d.name}`);
    const del = button("Delete…", () => deleteDraft(d), "ghost danger");
    del.setAttribute("aria-label", `Delete the draft ${d.name}`);
    line.append(spacer, open, rename, del);
    box.append(line);
  }
  return box;
}

async function openDraft(id) {
  app.songChosen = true;
  showView("music");
  await refreshAudio().catch(() => {});
  if (!(await music.openDraft(id))) { app.songChosen = !!music.base; showView("music"); }
}

async function renameDraft(d) {
  const name = prompt("Rename the draft", d.name)?.trim();
  if (!name || name === d.name) return;
  if (music.draft?.id === d.id) {
    $("music-name").value = name;
    music.draftChanged();
    return;
  }
  try {
    await api(`api/drafts/${encodeURIComponent(d.id)}/rename`, { method: "POST", json: { name } });
    music.keeper.renamed(d.id, name);
    renderSongsPage();
  } catch (e) { status(`Couldn't rename the draft: ${e.message}`, true, "songs"); }
}

async function deleteDraft(d) {
  const made = d.made ? ` The song file it made (${d.made.path.split("/").pop()}) stays.` : "";
  if (!confirm(`Delete the draft "${d.name}"? The song it started from isn't changed.${made}`)) return;
  // Forgotten first, so a save on its way (or waiting to be tried again) can't make it again.
  music.keeper.forgetId(d.id);
  try {
    await api(`api/drafts/${encodeURIComponent(d.id)}`, { method: "DELETE" }).catch((e) => {
      if (e.status !== 404) throw e; // already gone (deleted in another tab) is fine
    });
    status(`Deleted the draft "${d.name}"`, "saved", "songs");
    renderSongsPage();
  } catch (e) { status(`Couldn't delete the draft: ${e.message}`, true, "songs"); }
}

function songRow(r) {
  const row = document.createElement("div");
  row.className = "show-row has-drafts-row";
  row.setAttribute("role", "listitem");
  const main = document.createElement("div");
  main.className = "show-main";
  const head = document.createElement("div");
  const name = document.createElement("b");
  name.className = "show-name";
  name.textContent = r.name;
  head.append(name);
  if (r.key === prefs.get("lastSong", "")) {
    const badge = document.createElement("span");
    badge.className = "show-last";
    badge.textContent = "Last edited";
    head.append(badge);
  }
  if (r.folder) {
    const where = document.createElement("span");
    where.className = "hint";
    where.textContent = `in ${r.folder}`;
    head.append(where);
  }
  const details = document.createElement("div");
  details.className = "hint";
  // "Length" is there for screen readers; on screen the time speaks for itself.
  const label = document.createElement("span");
  label.className = "sr-only";
  label.textContent = "Length ";
  const len = document.createElement("span");
  len.textContent = "…";
  details.append(label, len, ` · ${r.found}`);
  const uses = document.createElement("div");
  uses.className = "hint";
  uses.textContent = r.uses;
  main.append(head, details, uses);
  const actions = document.createElement("div");
  actions.className = "group show-actions";
  const edit = button("Edit", () => editSong(r.ref), "primary");
  edit.setAttribute("aria-label", `Edit ${r.name} in the Music editor`);
  actions.append(edit);
  const rm = button("Remove…", () => openRemoveSong(r), "ghost");
  rm.setAttribute("aria-label", `Archive or delete ${r.name}`);
  if (!r.own) {
    rm.disabled = true;
    rm.title = "Only songs in HA-liday Show's own folder (haliday_show in your media folder) can be archived or deleted here";
  }
  actions.append(rm);
  row.append(main, actions);
  const drafts = draftList(r);
  if (drafts) row.append(drafts);
  // The length is read once the row is on screen; a redraw starts over with new rows.
  row._songLength = () => songLength(r).then((text) => { len.textContent = text; });
  songSeen ? songSeen.observe(row) : row._songLength();
  return row;
}

async function editSong(ref) {
  // Ask before switching tabs, rather than after.
  await music.flush();
  if (music.unsaved && !confirm("Your last change to the draft couldn't be kept (is HA-liday Show still running?). Leave it anyway?")) return;
  app.songChosen = true;
  showView("music");
  await refreshAudio().catch(() => {});
  music.open(ref, { asked: true });
}

// Add a song: step 1 picks the file and its name, step 2 whether to detect it straight away (the
// default, so shows that use it get its beats and parts at once). Nothing is uploaded until Add song.
// `onAdded` is for the windows that open this one to pick the new song (New show, Choose a song).
const addSong = { step: 1, file: null, named: false, mode: "detect", busy: false, onAdded: null };

function asStarts() {
  const rows = detectChoices(Boolean(aiVia));
  if (!rows.some((r) => r.value === addSong.mode)) addSong.mode = rows[0].value;
  nsRadioRows($("as-starts"), "as-start", rows, addSong.mode, (v) => { addSong.mode = v; asStarts(); });
}

function asStep(step) {
  const note = $("add-song-dialog").querySelector(".dialog-note");
  if (note) note.hidden = true;
  addSong.step = step;
  $("as-step-1").hidden = step !== 1;
  $("as-step-2").hidden = step !== 2;
  $("as-back").hidden = step !== 2;
  $("as-next").textContent = step === 1 ? "Next →" : "Add song";
  if (step === 2) { asStarts(); $("as-starts").querySelector("input:checked")?.focus(); }
}

function asBusy(on, text = "") {
  addSong.busy = on;
  $("as-progress").textContent = text;
  for (const b of $("add-song-dialog").querySelectorAll("button, input")) b.disabled = on;
}

function openAddSong({ onAdded = null } = {}) {
  Object.assign(addSong, { file: null, named: false, mode: aiVia ? "ai" : "detect", busy: false, onAdded });
  $("as-file-name").textContent = "No file chosen yet";
  $("as-name").value = "";
  asBusy(false);
  $("add-song-dialog").showModal();
  asStep(1);
}

function asFilePicked(f) {
  if (!f) return;
  if (!isAudioName(f.name)) { status("Pick a song file: MP3, M4A, WAV, FLAC, OGG, Opus or WebM", "hint"); return; }
  addSong.file = f;
  $("as-file-name").textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`;
  if (!addSong.named) $("as-name").value = nameFromFile(f.name);
}

async function asSubmit(e) {
  e.preventDefault();
  if (addSong.busy) return;
  const f = addSong.file, name = $("as-name").value.trim();
  if (addSong.step === 1) {
    if (!f) { status("Choose a song file first", "hint"); return; }
    if (!name) { $("as-name").focus(); return; }
    let paths;
    try { paths = (await api("api/songs")).songs.map((s) => s.path); } catch (err) {
      status(`Couldn't check your songs: ${err.message}`, true, "songs");
      return;
    }
    if (nameTaken(savedName(name, f.name), paths)) {
      status(`There's already a song called ${name}. Give this one its own name`, "hint");
      $("as-name").select();
      return;
    }
    asStep(2);
    return;
  }
  asBusy(true, `Uploading ${name}…`);
  let ref;
  try {
    ref = await uploadSong(api, f, savedName(name, f.name), (done) => {
      if (done < 1) $("as-progress").textContent = `Uploading ${name}… ${Math.round(done * 100)}%`;
    });
  } catch (err) {
    asBusy(false);
    status(`Couldn't add ${name}: ${err.message}`, true, "songs");
    return;
  }
  let info = null, failed = null;
  const withAI = addSong.mode === "ai" && Boolean(aiVia);
  if (addSong.mode !== "later") {
    asBusy(true, `Listening to ${name}…`);
    try {
      audioCtx ||= new AudioContext();
      const song = await audioCtx.decodeAudioData(await f.arrayBuffer());
      const channels = Array.from({ length: song.numberOfChannels }, (_, c) => song.getChannelData(c));
      const { samples, rate } = toMono(channels, song.sampleRate);
      const r = await analyseInWorker(samples, rate);
      info = { tempo: r.tempo || null, beats: r.beats, bars: r.bars, sections: describeSections(r.sections, r.traits) };
      await api(songInfoUrl(ref), { method: "PUT", json: info });
      // The AI's names and notes follow when they come, unless the song's sections were edited meanwhile.
      const first = info;
      if (withAI) {
        aiSectionNotes(info.sections, r.traits, { name, duration: song.duration, tempo: info.tempo }).then(async (got) => {
          if (!got?.used || !sameSections((await songInfo(ref))?.sections, first.sections)) return;
          await api(songInfoUrl(ref), { method: "PUT", json: { ...first, sections: got.sections } });
          music.reloadInfo?.(ref);
          status(`${name}: the AI named the parts and wrote their notes`, "saved", "songs");
        }).catch(() => {});
      }
    } catch (err) {
      failed = songLoadMessage(err);
      info = null;
    }
  }
  asBusy(false);
  $("add-song-dialog").close();
  await refreshAudio().catch(() => {});
  renderSongsPage();
  if (failed) status(`${name} added, but couldn't be detected: ${failed}. Try Detect in the Music editor`, true, "songs");
  else status(addedMessage(name, info, { ai: withAI && info?.sections.length > 0 }), "saved", "songs");
  addSong.onAdded?.([...$("audio-select").options].find((o) => o.value && JSON.parse(o.value).path === ref.path)?.value || "");
}

// Song lengths, read from each file's header by the browser, a few at a time. Kept for the visit,
// by file size and time too, so a song saved over or uploaded again is read afresh.
const songLengths = new Map(), songLengthQueue = [];
let songLengthsRunning = 0;
const songSeen = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { songSeen.unobserve(e.target); e.target._songLength?.(); }
  }) : null;
function songLength(r) {
  const key = `${r.key}|${r.size}|${r.modified}`;
  if (!songLengths.has(key)) {
    songLengths.set(key, new Promise((resolve) => {
      songLengthQueue.push(() => readSongLength(r.ref).then(resolve));
      pumpSongLengths();
    }));
  }
  return songLengths.get(key);
}
function pumpSongLengths() {
  while (songLengthsRunning < 3 && songLengthQueue.length) {
    songLengthsRunning++;
    songLengthQueue.shift()().finally(() => { songLengthsRunning--; pumpSongLengths(); });
  }
}
function readSongLength(ref) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    let settled = false;
    const done = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      a.removeAttribute("src");
      a.load();
      resolve(text);
    };
    // A file that never answers mustn't hold up the rest.
    const timer = setTimeout(() => done("?:??"), 10000);
    a.addEventListener("loadedmetadata", () => done(Number.isFinite(a.duration) ? fmtTime(a.duration, false) : "?:??"), { once: true });
    a.addEventListener("error", () => done("can't play here"), { once: true });
    a.src = audioUrl(ref);
  });
}

// Archive or delete -------------------------------------------------------------
// One window for both: a show (from its row or Show settings) or a song (from Library → Songs).
let removing = null;
// A note in a window, in the same style as the top bar's messages: ✓ when all's well, ⚠ when it
// needs your attention before you go on.
function notice(el, kind, text) {
  el.className = `notice is-${kind}`;
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = kind === "ok" ? "✓" : "⚠";
  const msg = document.createElement("span");
  msg.textContent = text;
  el.replaceChildren(mark, msg);
}
const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function openRemoveShow(r) {
  let lists = [];
  try { lists = (await api("api/playlists")).filter((p) => p.shows.includes(r.id)).map((p) => p.name); } catch { /* still removable */ }
  removing = { kind: "show", id: r.id, name: r.name };
  $("rm-title").textContent = `Remove ${r.name}`;
  notice($("rm-what"), lists.length ? "warn" : "ok",
    lists.length ? `It's in ${lists.length === 1 ? "the playlist" : "the playlists"} ${listOf(lists)}.` : "It isn't in any playlist.");
  $("rm-shows").hidden = true;
  $("rm-archive-note").innerHTML = `<b>Archive</b> keeps it, out of the way, under <b>Archived shows</b> at the foot of
    your shows, where <b>Restore</b> brings it back.${lists.length ? " Its playlists skip it until then." : ""}
    Automations that start it won't find it while it's archived.`;
  $("rm-delete-note").innerHTML = `<b>Delete for good</b> removes it${lists.length ? ` and takes it out of ${esc(listOf(lists))}` : ""}.
    A copy of everything is kept under <b>Setup → Settings → Your data</b>, just in case.`;
  $("remove-dialog").showModal();
}

async function openRemoveSong(r) {
  let users = [];
  try { users = (await api(`api/songs/users?path=${encodeURIComponent(r.ref.path)}`)).shows; } catch { /* asked below */ }
  removing = { kind: "song", path: r.ref.path, name: r.name, users };
  $("rm-title").textContent = `Remove ${r.name}`;
  notice($("rm-what"), users.length ? "warn" : "ok", users.length ? `Used by ${listOf(users.map((s) => s.name))}.` : "No show uses it.");
  $("rm-shows").hidden = !users.length;
  const sel = $("rm-replacement");
  sel.replaceChildren(...(app.songs || []).filter((x) => x.source === "media" && x.path !== r.ref.path)
    .map((x) => new Option(x.path, JSON.stringify(x))));
  const radio = document.querySelector("input[name=rm-instead][value=song]");
  radio.disabled = sel.disabled = !sel.options.length;
  (sel.options.length ? radio : document.querySelector("input[name=rm-instead][value=none]")).checked = true;
  $("rm-archive-note").innerHTML = `<b>Archive</b> moves it to the <b>Archived</b> folder in HA-liday Show's songs folder,
    out of its song lists. <b>Restore</b>, under <b>Archived songs</b>, puts it back${users.length
    ? " and gives it back to any of these shows left without a song" : ""}.`;
  $("rm-delete-note").innerHTML = `<b>Delete for good</b> removes the song file. A copy of your shows and settings is kept
    under <b>Setup → Settings → Your data</b>, but the song file itself can't be brought back.`;
  $("remove-dialog").showModal();
}

async function doRemove(forGood) {
  const r = removing;
  if (!r) return;
  if (forGood && !confirm(`Delete ${r.name} for good?`)) return;
  try {
    if (r.kind === "show") {
      if (r.id === app.showId) {
        // An archived show keeps your latest changes; a deleted one doesn't need them. Either way
        // nothing saves it again afterwards.
        clearTimeout(autoSaveTimer);
        if (saving) await saving;
        if (!forGood && app.dirty && worthSaving()) await save();
      }
      if (forGood) await api(`api/shows/${encodeURIComponent(r.id)}`, { method: "DELETE" });
      else await api(`api/shows/${encodeURIComponent(r.id)}/archive`, { method: "POST" });
      $("remove-dialog").close();
      status(forGood ? `Deleted ${r.name}` : `Archived ${r.name}`, "saved", "shows");
      if (r.id === app.showId) {
        app.dirty = false;
        app.chosen = false;
        await openShow(null, { chosen: false });
        showView("editor", { push: false }); // the show is gone, so Back mustn't lead to it
      } else await refreshShows();
    } else {
      // The server changes the shows' songs on disk, so the open show must be on disk first, or a
      // later save would put the old song back.
      if (app.showId) {
        clearTimeout(autoSaveTimer);
        if (saving) await saving;
        if (app.dirty && worthSaving()) {
          if (!autoSaveOn()) {
            $("remove-dialog").close();
            status(`Save ${app.show.name} first, then remove the song`, "hint");
            return;
          }
          await save();
        }
      }
      const keep = !$("rm-shows").hidden && document.querySelector("input[name=rm-instead][value=song]").checked;
      const replacement = keep ? JSON.parse($("rm-replacement").value) : null;
      const res = await api(`api/songs/${forGood ? "delete" : "archive"}`, { method: "POST", json: { path: r.path, replacement } });
      $("remove-dialog").close();
      status(forGood ? `Deleted ${r.name}` : `Archived ${r.name}`, "saved", "songs");
      await songMovedFor(res.shows);
    }
  } catch (e) {
    status(`Couldn't ${forGood ? "delete" : "archive"} ${r.name}: ${e.message}`, true, r.kind === "show" ? "shows" : "songs");
    scheduleAutoSave(); // it was paused for the removal; the open show still saves as you edit
  }
}

// The server changed these shows' songs; the open one follows, without counting as an edit.
async function songMovedFor(shows) {
  const mine = (shows || []).find((s) => s.id === app.showId);
  if (mine) {
    if (mine.audio) app.show.audio = mine.audio; else delete app.show.audio;
    await loadAudio(app.show.audio);
  }
  await refreshAudio().catch(() => {});
  await Promise.all([renderSongsPage(), refreshShows()]);
}

function archivedRow(name, details, actions) {
  const row = document.createElement("div");
  row.className = "show-row";
  row.setAttribute("role", "listitem");
  const main = document.createElement("div");
  main.className = "show-main";
  const head = document.createElement("div");
  const b = document.createElement("b");
  b.className = "show-name";
  b.textContent = name;
  head.append(b);
  main.append(head);
  for (const d of details) {
    const line = document.createElement("div");
    line.className = "hint";
    line.textContent = d;
    main.append(line);
  }
  const group = document.createElement("div");
  group.className = "group show-actions";
  group.append(...actions);
  row.append(main, group);
  return row;
}

function fillArchived(box, rows) {
  const summary = box.querySelector("summary");
  summary.dataset.label ||= summary.textContent;
  summary.textContent = `${summary.dataset.label} (${rows.length})`;
  box.hidden = !rows.length;
  const list = box.querySelector(".show-list");
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", summary.dataset.label);
  list.replaceChildren(...rows);
}

async function renderArchivedShows() {
  let list = [];
  try { list = await api("api/shows/archived"); } catch { return; }
  const rows = () => showRows(list, null).map((r) => {
    const restore = button("Restore", async () => {
      try {
        const res = await api(`api/shows/${encodeURIComponent(r.id)}/restore`, { method: "POST" });
        status(res.name === r.name ? `Restored ${r.name}` : `Restored ${r.name} as ${res.name}`, "saved", "shows");
        await refreshShows();
      } catch (e) { status(`Couldn't restore ${r.name}: ${e.message}`, true, "shows"); }
    }, "ghost");
    restore.setAttribute("aria-label", `Restore ${r.name}`);
    const del = button("Delete for good…", async () => {
      if (!confirm(`Delete ${r.name} for good? It's also taken out of any playlists.`)) return;
      try {
        await api(`api/shows/${encodeURIComponent(r.id)}?archived=1`, { method: "DELETE" });
        status(`Deleted ${r.name}`, "saved", "shows");
        await refreshShows();
      } catch (e) { status(`Couldn't delete ${r.name}: ${e.message}`, true, "shows"); }
    }, "ghost danger");
    del.setAttribute("aria-label", `Delete ${r.name} for good`);
    return archivedRow(r.name, [r.details], [restore, del]);
  });
  for (const box of document.querySelectorAll("[data-show-archived]")) fillArchived(box, rows());
}

async function renderArchivedSongs() {
  let list = [];
  try { list = await api("api/songs/archived"); } catch { return; }
  const rows = list.map((x) => {
    const name = x.path.split("/").pop().replace(/\.[^.]+$/, "");
    const restore = button("Restore", async () => {
      try {
        const res = await api("api/songs/restore", { method: "POST", json: { path: x.path } });
        status(`Restored ${name}`, "saved", "songs");
        await songMovedFor(res.shows);
      } catch (e) { status(`Couldn't restore ${name}: ${e.message}`, true, "songs"); }
    }, "ghost");
    restore.setAttribute("aria-label", `Restore ${name}`);
    const del = button("Delete for good…", async () => {
      if (!confirm(`Delete ${name} for good? The song file can't be brought back.`)) return;
      try {
        await api("api/songs/delete", { method: "POST", json: { path: x.path, archived: true } });
        status(`Deleted ${name}`, "saved", "songs");
        renderArchivedSongs();
      } catch (e) { status(`Couldn't delete ${name}: ${e.message}`, true, "songs"); }
    }, "ghost danger");
    del.setAttribute("aria-label", `Delete ${name} for good`);
    const from = x.from.split("/").slice(0, -1).join("/");
    return archivedRow(name, [`was in ${from || "your songs folder"}`,
      x.songless.length ? `Left without a song: ${x.songless.join(", ")}` : "No show was left without it"], [restore, del]);
  });
  fillArchived($("songs-archived"), rows);
}

// After the list is redrawn, puts keyboard focus back on a row's button in the list you're looking at.
function focusRow(id, act) {
  const box = [...document.querySelectorAll("[data-show-list]")].find((b) => b.offsetParent);
  box?.querySelector(`.show-row[data-show-id="${CSS.escape(id)}"] [data-act="${act}"]`)?.focus();
}

async function openFromList(id) {
  if (id !== app.showId) {
    if (!(await confirmDiscard())) return;
    await openShow(id);
  }
  app.chosen = true;
  showView("editor");
  $("btn-all-shows").focus();
}

async function duplicateShow(r) {
  const name = copyName(r.name, showListCache.map((s) => s.name));
  try {
    const { id } = await api(`api/shows/${encodeURIComponent(r.id)}/duplicate`, { method: "POST", json: { name } });
    status(`Made ${name}`, "saved", "shows");
    await refreshShows();
    focusRow(id, "open");
  } catch (e) { status(`Couldn't duplicate ${r.name}: ${e.message}`, true, "shows"); }
}

// Rename right in the row: Enter or leaving the box saves, Escape puts it back.
function renameInPlace(row, head, r) {
  if (row.querySelector(".show-rename")) return;
  const input = document.createElement("input");
  input.className = "show-rename";
  input.value = r.name;
  input.maxLength = 80;
  input.setAttribute("aria-label", `New name for ${r.name}`);
  const before = [...head.childNodes];
  head.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (keep, byKey = false) => {
    if (done) return;
    done = true;
    const refocus = () => { if (byKey) focusRow(r.id, "rename"); };
    const name = input.value.trim().replace(/\s+/g, " ");
    if (!keep || !name || name === r.name) { head.replaceChildren(...before); refocus(); return; }
    if (showListCache.some((s) => s.id !== r.id && s.name.toLowerCase() === name.toLowerCase())) {
      status("Give each show its own name", "hint");
      head.replaceChildren(...before);
      refocus();
      return;
    }
    const isOpen = r.id === app.showId;
    if (isOpen && saving) await saving;
    const old = app.show.name;
    if (isOpen) { app.show.name = name; $("show-name").value = name; }
    try {
      await api(`api/shows/${encodeURIComponent(r.id)}/rename`, { method: "POST", json: { name } });
      status("Show renamed", "saved", "shows");
      await refreshShows();
      refocus();
    } catch (e) {
      if (isOpen) { app.show.name = old; $("show-name").value = old; }
      head.replaceChildren(...before);
      refocus();
      status(`Couldn't rename ${r.name}: ${e.message}`, true, "shows");
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true, true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false, true); }
  });
  input.addEventListener("blur", () => finish(true));
}

async function refreshShows() {
  const shows = await api("api/shows");
  renderShowLists(shows);
  renderSaveState();
}

async function confirmDiscard() {
  if (!app.dirty) return true;
  if (autoSaveOn() && worthSaving()) {
    try { await autoSave(); return true; } catch { /* fall through to asking */ }
  }
  return confirm("You have unsaved changes. Discard them?");
}

// auto save -------------------------------------------------------------------
// Saves (and bakes) a couple of seconds after the last change. A brand-new show is only
// created once it has an effect in it, so trying things out doesn't litter the show list.
const AUTOSAVE_MS = 2000;
let autoSaveTimer = null, saving = null;
const autoSaveOn = () => $("autosave").checked;
const worthSaving = () => !!app.showId || app.show.tracks.some((t) => t.clips.length);

function renderSaveState(text) {
  $("show-title").textContent = app.show.name;
  $("save-state").textContent = text ?? (app.dirty ? (autoSaveOn() && worthSaving() ? "Unsaved changes…" : "Unsaved changes") : app.showId ? "All changes saved" : "");
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  renderSaveState();
  if (!autoSaveOn() || !app.dirty || !worthSaving()) return;
  autoSaveTimer = setTimeout(() => {
    // Saving re-bakes the show, so wait until playback stops.
    if (app.playing) { scheduleAutoSave(); return; }
    autoSave().catch((e) => status(`Auto save failed: ${e.message}`, true, "show"));
  }, AUTOSAVE_MS);
}

async function autoSave() {
  clearTimeout(autoSaveTimer);
  if (saving) await saving;
  if (!app.dirty) return;
  renderSaveState("Saving…");
  saving = save().finally(() => { saving = null; });
  try { await saving; status("Show saved", "saved", "show"); } finally {
    renderSaveState();
    if (app.dirty) scheduleAutoSave(); // edited while saving
  }
}

// chosen: whether you picked this show (so the Show editor shows it), rather than the blank show
// that's loaded behind Your shows when the page opens.
async function openShow(id, { chosen = true } = {}) {
  await stop();
  clearTimeout(autoSaveTimer);
  if (id) {
    app.show = await api(`api/shows/${encodeURIComponent(id)}`);
    app.show.beats ||= [];
    app.show.bars ||= [];
    app.show.sections ||= [];
    app.show.tracks ||= [];
  } else {
    app.show = blankShow();
  }
  app.showId = id || null;
  app.region = null;
  renderRegion();
  app.dirty = false;
  app.bakedKey = null;
  app.selected = null;
  app.history = [];
  ensureTracks();
  commit();
  if (app.showId) prefs.set("lastShow", app.showId);
  if (chosen) app.chosen = true;
  renderSaveState();
  $("show-name").value = app.show.name;
  $("duration").value = Math.round(app.show.duration || 60);
  renderOutput();
  renderInspector();
  await loadAudio(app.show.audio);
  app.seek(0);
  await refreshShows();
  layoutPreview();
  timeline.layout();
  reportUnfit();
  // Opened from Your shows (or by the setup guide or demo while it shows): go to the show.
  if (chosen && !$("view-showlist").hidden) showView("editor");
}

// Once a show is open, says how many of its clips won't work on their lights (worked out in the
// background). They stay in the show and play as they always did; the timeline marks them.
function reportUnfit() {
  const show = app.show, clips = [];
  show.tracks.forEach((tr, i) => tr.clips.forEach((c) => clips.push([c, i])));
  let left = clips.length, count = 0;
  const done = (fit) => {
    if (fit.level === "no") count++;
    if (--left || !count || show !== app.show) return;
    status(`${count} clip${count === 1 ? " won't" : "s won't"} work on ${count === 1 ? "its light" : "their lights"}. `
      + "They're hatched on the timeline: select one to see why.", "hint");
  };
  for (const [c, i] of clips) {
    const fit = clipFitOn(c, i, done);
    if (fit) done(fit);
  }
}

async function save() {
  if (!app.showId) {
    const { id } = await api("api/shows", { method: "POST", json: { name: app.show.name } });
    app.showId = id;
    prefs.set("lastShow", id);
  }
  const pos = housePositions();
  const key = JSON.stringify([app.deviceList.map((d) => [d.id, d.segments, d.parts]), pos]);
  if (app.dirty || app.bakedKey === null) {
    app.show.duration = app.duration();
    const edits = app.edits;
    await api(`api/shows/${app.showId}`, { method: "PUT", json: app.show });
    if (app.edits === edits) app.dirty = false;
    app.bakedKey = null;  // saving the show clears the server's bake
  }
  if (app.bakedKey !== key) {
    const blob = bake(app.show, app.devices, FPS, pos);
    // A long show on many bulbs is more than Home Assistant passes on in one go, so it goes in pieces.
    if (blob.byteLength > PART) await sendParts(api, `api/shows/${app.showId}/baked/part`, new Blob([blob]));
    else {
      await api(`api/shows/${app.showId}/baked`, {
        method: "PUT", body: blob, headers: { "Content-Type": "application/octet-stream" },
      });
    }
    app.bakedKey = key;
  }
  await refreshShows();
  renderOutput();
}

async function saveClicked() {
  clearTimeout(autoSaveTimer);
  try {
    status("Saving…");
    if (saving) await saving;
    await save();
    status("Show saved", "saved", "show");
  } catch (e) { status(`Save failed: ${e.message}`, true, "show"); }
  renderSaveState();
}

// audio -----------------------------------------------------------------------
async function refreshAudio() {
  const list = await api("api/audio");
  app.songs = list;
  const sel = $("audio-select");
  sel.replaceChildren(new Option("No song (lights only)", ""));
  const current = app.show?.audio;
  for (const a of list) {
    const label = `${a.source === "media" ? "Media" : "Uploaded"}: ${a.path}`;
    const value = JSON.stringify(a);
    sel.add(new Option(label, value, false, !!current && current.source === a.source && current.path === a.path));
  }
}

let audioCtx;
let songBuffer = null; // the decoded song, for Detect
async function loadAudio(ref) {
  app.peaks = null;
  songBuffer = null;
  app.songMarks = [];
  loadSongMarks();
  app.audioDuration = 0;
  await refreshAudio();
  if (!ref) {
    audio.removeAttribute("src");
    audio.load();
    timeline.layout();
    renderSongSummary();
    return;
  }
  const url = audioUrl(ref);
  audio.src = url;
  status("Loading song…");
  try {
    const buf = await fetchSong(url);
    audioCtx ||= new AudioContext();
    const decoded = await audioCtx.decodeAudioData(buf);
    app.peaks = computePeaks(decoded);
    songBuffer = decoded;
    app.audioDuration = decoded.duration;
    status("", "info", "song");
  } catch (e) {
    status(songLoadMessage(e), true, "song");
  }
  timeline.layout();
  renderSongSummary();
}

const songLabel = (ref) => ref.path.split("/").pop().replace(/\.[^.]+$/, "");

// The Song panel's one line: the song's name, then its length, tempo and sections when known.
function renderSongSummary() {
  const ref = app.show?.audio;
  $("song-title").textContent = ref ? songLabel(ref) : "No song";
  const n = app.show?.sections?.length || 0;
  const meta = ref
    ? [app.audioDuration ? fmtTime(app.audioDuration, false) : "",
      app.show.tempo ? `${Math.round(app.show.tempo)} BPM` : "",
      n ? `${n} section${n === 1 ? "" : "s"}` : ""]
    : ["Lights only", `${Math.round(app.show?.duration || 60)} s`];
  $("song-meta").textContent = meta.filter(Boolean).join(" · ");
  $("song-title").title = ref ? `${ref.source === "media" ? "Media" : "Uploaded"}: ${ref.path}` : "";
}

// Choose a song: a row per song (the hidden select stays the source of truth), applied on Use.
let songPick = "";
function renderSongList() {
  const box = $("song-list");
  box.replaceChildren(...[...$("audio-select").options].map((o) => {
    const ref = o.value ? JSON.parse(o.value) : null;
    const row = document.createElement("label");
    row.className = `song-row${o.value === songPick ? " picked" : ""}`;
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "song-pick";
    radio.checked = o.value === songPick;
    radio.addEventListener("change", () => { songPick = o.value; renderSongList(); });
    const text = document.createElement("span");
    const name = document.createElement("b");
    name.textContent = ref ? songLabel(ref) : "No song, lights only";
    const where = document.createElement("span");
    where.className = "hint";
    where.textContent = ref ? `${ref.source === "media" ? "Media" : "Uploaded"}: ${ref.path}` : "Set how long the show runs";
    text.append(name, where);
    row.append(radio, text);
    return row;
  }));
  $("duration-wrap").hidden = songPick !== "";
}

function openSongDialog() {
  songPick = $("audio-select").value;
  renderSongList();
  $("song-dialog").returnValue = ""; // Escape keeps the last value, so a cancel must not look like Use
  $("song-dialog").showModal();
}

function computePeaks(buffer, rate = 100) {
  const size = Math.max(1, Math.floor(buffer.sampleRate / rate));
  const n = Math.ceil(buffer.length / size);
  const data = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let m = data[i];
      for (let j = i * size, end = Math.min(j + size, ch.length); j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > m) m = v;
      }
      data[i] = m;
    }
  }
  let max = 0;
  for (const v of data) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < n; i++) data[i] /= max;
  return { rate, data };
}

// speakers --------------------------------------------------------------------
// Two speakers: the one the editor plays on while you design (kept per browser), and the show
// speaker that automations play the show on (the show's own, or the default in Settings).
const speaker = () => prefs.get("editorSpeaker", "");
const speakerName = (id) => app.speakers.find((s) => s.entity_id === id)?.name || id;

async function loadSpeakers() {
  try {
    const body = await api("api/speakers");
    app.speakers = body.speakers;
    app.speakerCandidates = body.candidates || [];
    app.haAvailable = body.available;
    app.defaultSpeaker = body.show_speaker || null;
  } catch { app.speakers = []; app.speakerCandidates = []; }
  renderOutput();
  renderSpeakers();
}

// The Speakers tab: the speakers the editor offers, and HA's other media players to test and add.
const speakerTests = {}; // entity -> {busy, ok, text}

function renderSpeakers() {
  $("speakers-ha").textContent = app.haAvailable === false
    ? "Home Assistant isn't reachable from HA-liday Show, so speakers can't be listed or tested right now." : "";
  const cells = (tr, ...items) => {
    for (const it of items) {
      const td = document.createElement("td");
      td.append(it);
      tr.append(td);
    }
    return tr;
  };
  const result = (entity) => {
    const t = speakerTests[entity];
    const span = document.createElement("span");
    span.className = `hint${t && !t.busy && !t.ok ? " error" : ""}`;
    span.textContent = t ? ` ${t.text}` : "";
    return span;
  };
  const testButton = (entity, label, cls = "") => {
    const b = button(speakerTests[entity]?.busy ? "Testing…" : label, () => testSpeaker(entity), cls);
    b.disabled = !!speakerTests[entity]?.busy;
    b.title = "Plays a short chime on it";
    return b;
  };
  const rows = $("speaker-rows");
  rows.replaceChildren(...app.speakers.map((s) => {
    const delay = document.createElement("input");
    Object.assign(delay, { type: "number", step: 10, value: s.delay_ms ?? 0 });
    delay.setAttribute("aria-label", `Delay for ${s.name}, in milliseconds`);
    delay.addEventListener("change", async () => {
      try {
        await api("api/speakers/delay", { method: "PUT", json: { entity_id: s.entity_id, delay_ms: Number(delay.value) || 0 } });
        s.delay_ms = Number(delay.value) || 0;
        renderOutput();
      } catch (err) { status(`Couldn't save the delay: ${err.message}`, true); }
    });
    const actions = document.createElement("span");
    actions.className = "group";
    actions.append(testButton(s.entity_id, "Test again", "ghost"), button("Remove", () => removeSpeaker(s.entity_id), "ghost danger"),
      result(s.entity_id));
    return cells(document.createElement("tr"), s.name, s.entity_id, s.state, delay, actions);
  }));
  if (!app.speakers.length) {
    rows.innerHTML = `<tr><td colspan="5" class="hint">None yet. Press <b>+ Add a speaker</b> to add one.</td></tr>`;
  }
  renderSpeakerCandidates();
}

// The Add a speaker window. Speakers added while it's open stay in its list with their tick, so you can see it worked.
const addedHere = new Set();

function renderSpeakerCandidates() {
  const q = $("speaker-filter").value.trim().toLowerCase();
  const all = (app.speakerCandidates || []).filter((c) => !c.added || addedHere.has(c.entity_id));
  $("speaker-filter").hidden = all.length < 8;
  const shown = all.filter((c) => !q || `${c.name} ${c.entity_id}`.toLowerCase().includes(q));
  const list = $("candidate-rows");
  list.replaceChildren(...shown.map((c) => {
    const row = document.createElement("div");
    row.className = "speaker-row";
    const who = document.createElement("span");
    who.className = "speaker-who";
    who.append(Object.assign(document.createElement("b"), { textContent: c.name }),
      Object.assign(document.createElement("span"), { textContent: c.state ? `${c.entity_id} · ${c.state}` : c.entity_id }));
    const actions = document.createElement("span");
    actions.className = "speaker-actions";
    const t = speakerTests[c.entity_id];
    if (c.added) {
      actions.append(Object.assign(document.createElement("span"), { className: "hint ok", textContent: t?.text || "✓ Added" }));
    } else if (c.can_play) {
      const b = button(t?.busy ? "Testing…" : t && !t.ok ? "Try again" : "Test and add", () => testSpeaker(c.entity_id, true),
        t && !t.ok ? "" : "primary");
      b.disabled = !!t?.busy;
      b.title = "Plays a short chime on it";
      actions.append(b);
      if (t) actions.append(Object.assign(document.createElement("span"), { className: `hint${t.busy ? "" : " error"}`, textContent: t.text }));
    } else {
      actions.append(Object.assign(document.createElement("span"), { className: "hint", textContent: "Can't be sent a song to play" }));
    }
    row.append(who, actions);
    return row;
  }));
  if (!shown.length) {
    list.innerHTML = `<p class="hint">${app.haAvailable === false ? "Home Assistant isn't reachable, so speakers can't be listed right now."
      : q ? "No speakers match that." : "No other media players in Home Assistant."}</p>`;
  }
}

function openAddSpeaker() {
  addedHere.clear();
  $("speaker-filter").value = "";
  for (const c of app.speakerCandidates || []) if (!c.added) delete speakerTests[c.entity_id];
  renderSpeakerCandidates();
  $("speaker-dialog").showModal();
  loadSpeakers();
}

async function testSpeaker(entity, adding = false) {
  speakerTests[entity] = { busy: true, text: "Playing a chime…" };
  renderSpeakers();
  try {
    const r = await api("api/speakers/test", { method: "POST", json: { entity_id: entity } });
    speakerTests[entity] = r.ok
      ? { ok: true, text: `✓ ${adding ? "Added" : "Works"}. It took ${r.start_s} s to start.` }
      : { ok: false, text: `✗ ${r.error}` };
    if (r.ok && adding) addedHere.add(entity);
  } catch (e) {
    speakerTests[entity] = { ok: false, text: `✗ ${e.message}` };
  }
  await loadSpeakers();
}

async function removeSpeaker(entity) {
  try { await api("api/speakers/remove", { method: "POST", json: { entity_id: entity } }); } catch (e) {
    status(`Couldn't remove it: ${e.message}`, true);
  }
  delete speakerTests[entity];
  await loadSpeakers();
}

// Fills a speaker <select>; a saved choice that HA no longer lists stays, marked unavailable.
function speakerOptions(sel, first, current, label = (s) => s.name) {
  sel.replaceChildren(new Option(first, ""));
  for (const s of app.speakers) sel.add(new Option(label(s), s.entity_id));
  if (current && !app.speakers.some((s) => s.entity_id === current)) {
    sel.add(new Option(`${current} (not added under Setup → Speakers)`, current));
  }
  sel.value = current || "";
}

function renderOutput() {
  const current = speaker();
  speakerOptions($("output-select"), "Song in this browser", current, (s) => `Speaker: ${s.name}`);
  speakerOptions($("show-speaker"), app.defaultSpeaker ? `Default (${speakerName(app.defaultSpeaker)})`
    : "Default (lights only)", app.show.media_player);
  speakerOptions($("default-speaker"), "None (lights only)", app.defaultSpeaker);
  const sp = app.speakers.find((s) => s.entity_id === current);
  $("lights-wrap").hidden = !!current;
  $("volume-wrap").hidden = !!current;
  $("offset-label").textContent = current ? "Speaker delay" : "Light offset";
  $("offset-hint").textContent = current
    ? "How late this speaker plays after it reports starting. Raise it if the lights lead the music."
    : "Use this to line the lights up with the audio if they lead or lag.";
  $("offset").value = current ? (sp?.delay_ms ?? 0) : prefs.get("offset", 0);
  $("automation-input").textContent = JSON.stringify({ action: "play", show: app.showId || app.show.name });
  $("automation-show").textContent = `"${app.show.name}"`;
}

async function offsetChanged(e) {
  const v = Number(e.target.value) || 0;
  if (!speaker()) { prefs.set("offset", v); return; }
  try {
    await api("api/speakers/delay", { method: "PUT", json: { entity_id: speaker(), delay_ms: v } });
    const sp = app.speakers.find((s) => s.entity_id === speaker());
    if (sp) sp.delay_ms = v;
  } catch (err) { status(`Couldn't save the delay: ${err.message}`, true); }
}

// transport -------------------------------------------------------------------
const lightsOn = () => $("lights").checked && app.show.tracks.some((t) => linked(playingDev(t)));
const offset = () => (Number($("offset").value) || 0) / 1000;

function currentTime() {
  return hasAudio() && !app.remote ? audio.currentTime : (performance.now() - app.clockStart) / 1000;
}

// While a speaker plays, follow the add-on's clock.
async function followRemote() {
  try {
    const st = await api("api/player");
    if (!app.playing || !app.remote) return;
    if (!st.playing) { stop(); return; }
    app.clockStart = performance.now() - st.position * 1000;
  } catch { /* try again next tick */ }
}

async function syncLights() {
  if (app.remote) { followRemote(); return; }
  if (!app.playing || !lightsOn()) return;
  // The position is a little old by the time it arrives, so add half the last round trip.
  const sent = performance.now();
  try {
    await api("api/player/sync", { method: "POST", json: { position: currentTime() + (app.syncLatency || 0) } });
    const half = (performance.now() - sent) / 2000;
    app.syncLatency = app.syncLatency == null ? half : app.syncLatency * 0.8 + half * 0.2;
  } catch { /* the next sync will retry */ }
}

// Browser playback plays the region (when set) instead of the whole show.
const playEnd = () => (app.region && !app.remote ? Math.min(app.region.end, app.duration()) : app.duration());

function renderRegion() {
  const r = app.region;
  $("region-wrap").hidden = !r;
  if (r) $("region-label").textContent = `Region ${fmtTime(r.start)} to ${fmtTime(r.end)}`;
}

async function play() {
  if (app.playing || app.starting) return;
  app.starting = true;
  try {
    await stopLightPreview();
    await startPlaying();
  } finally {
    app.starting = false;
  }
}

async function startPlaying() {
  const r = app.region;
  if (r && !speaker() && (app.time < r.start || app.time >= r.end - 0.01)) app.seek(r.start);
  else if (app.time >= app.duration() - 0.01) app.seek(0);
  if (speaker()) {
    if (!app.show.audio) { status("Pick a song to play on a speaker", "hint"); return; }
    try {
      status("Starting the speaker…");
      await save();
      const st = await api("api/player/play", {
        method: "POST", json: { show: app.showId, position: app.time, media_player: speaker() },
      });
      if (r || app.loop) status("Play region and Loop only work with the song in this browser", "hint");
      else status("", "info", "play");
      app.clockStart = performance.now() - st.position * 1000;
    } catch (e) { status(`Couldn't play: ${e.message}`, true, "play"); return; }
    app.remote = true;
    app.playing = true;
    $("btn-play").textContent = "⏸ Stop";
    app.syncTimer = setInterval(syncLights, 500);
    return;
  }
  if (lightsOn()) {
    try {
      status("Preparing lights…");
      await save();
      await api("api/player/play", {
        method: "POST", json: { show: app.showId, position: app.time, offset: offset() },
      });
      status("", "info", "play");
    } catch (e) {
      status(`Lights unavailable: ${e.message}`, true, "play");
    }
  }
  if (hasAudio()) {
    audio.currentTime = app.time;
    try { await audio.play(); } catch (e) { status(`Can't play audio: ${e.message}`, true); return; }
  } else {
    app.clockStart = performance.now() - app.time * 1000;
  }
  app.playing = true;
  $("btn-play").textContent = "⏸ Pause";
  syncLights();
  app.syncTimer = setInterval(syncLights, 1000);
}

async function stop() {
  const wasPlaying = app.playing;
  app.playing = false;
  app.remote = false;
  clearInterval(app.syncTimer);
  audio.pause();
  $("btn-play").textContent = "▶ Play";
  if (wasPlaying) {
    try { await api("api/player/stop", { method: "POST" }); } catch { /* nothing to stop */ }
  }
}

function tapBeat() {
  app.show.beats.push(app.time);
  app.show.beats.sort((a, b) => a - b);
  app.changed();
}

function fillBeats() {
  const bpm = Number($("bpm").value);
  if (!(bpm >= 20 && bpm <= 300)) { status("Enter a BPM between 20 and 300", "hint"); return; }
  const start = app.time, step = 60 / bpm, end = app.duration();
  const beats = app.show.beats.filter((b) => b < start - 0.001);
  for (let t = start; t <= end; t += step) beats.push(Math.round(t * 1000) / 1000);
  app.show.beats = beats;
  app.changed();
}

// What Detect found in a song is also kept with the song file (in the Music editor or here), so any
// show using that song can start from it.
const songInfoUrl = (a) => `api/audio/info?source=${encodeURIComponent(a.source)}&path=${encodeURIComponent(a.path)}`;
async function songInfo(ref) {
  try { return ref ? await api(songInfoUrl(ref)) : null; } catch { return null; }
}

// The marks put on the show's song in the Music editor, drawn on the beat lane and snapped to. They
// stay with the song (not the show), so they're read afresh whenever the editor shows.
async function loadSongMarks() {
  const ref = app.show?.audio;
  const info = ref ? await songInfo(ref) : null;
  if (ref !== app.show?.audio) return;
  const marks = info?.marks || [];
  if (JSON.stringify(marks) === JSON.stringify(app.songMarks || [])) return;
  app.songMarks = marks;
  timeline.layout();
}

function applySongInfo(info) {
  Object.assign(app.show, {
    beats: [...info.beats], bars: [...info.bars], sections: info.sections.map((s) => ({ ...s })), tempo: info.tempo || null,
  });
  if (info.tempo) $("bpm").value = info.tempo;
}

// After picking a song: take its saved beats and sections, asking first if the show has its own.
async function importSongInfo({ quiet = true } = {}) {
  const ref = app.show.audio;
  const info = await songInfo(ref);
  if (ref !== app.show.audio) return;
  if (!info?.beats?.length && !info?.sections?.length) { // nothing, or only its marks
    if (!quiet) status("No beats saved for this song yet. Use Detect here or in the Music editor", "hint");
    return;
  }
  const has = app.show.beats.length || app.show.sections?.length;
  if (has && !confirm("Replace this show's beat markers and sections with the ones saved for this song?")) return;
  applySongInfo(info);
  app.changed();
  status(`Using the song's ${info.beats.length} beats and ${info.sections.length} sections`);
}

// Finds the beats, bars and sections in the song, in a worker so the editor stays responsive.
async function detectBeats() {
  if (!songBuffer) { status("Choose a song first", "hint"); return; }
  if ((app.show.beats.length || app.show.sections?.length)
      && !confirm("Replace the beat markers and sections with ones found in the song?")) return;
  const r = await analyseSong({ ai: true });
  if (!r) return;
  app.changed();
  const parts = `${r.sections.length} section${r.sections.length === 1 ? "" : "s"}`;
  status((r.tempo ? `Found ${r.beats.length} beats at ${r.tempo} BPM, and ${parts}` : `No steady beat found; found ${parts}`)
    + (aiVia ? ". The AI is writing notes for them; carry on meanwhile" : ""));
}

// Analyses the loaded song and puts its beats, bars, sections and tempo on the show (without
// committing the change). Returns the result, or null if it failed or the song changed meanwhile.
// With ai (the Detect button only), the AI then rewrites the section notes in the background.
async function analyseSong({ ai = false, cancelled = () => false } = {}) {
  const song = songBuffer;
  const channels = Array.from({ length: song.numberOfChannels }, (_, c) => song.getChannelData(c));
  const { samples, rate } = toMono(channels, song.sampleRate);
  status("Listening to the song…");
  $("btn-detect").disabled = true;
  let r;
  try {
    r = await analyseInWorker(samples, rate);
  } catch (e) {
    status(`Couldn't analyse the song: ${e.message}`, true);
    return null;
  } finally {
    $("btn-detect").disabled = false;
  }
  if (song !== songBuffer || cancelled()) return null;
  // Names and notes you wrote on the song's sections (in either editor) carry over to the new ones.
  const saved = app.show.audio ? await songInfo(app.show.audio) : null;
  if (song !== songBuffer || cancelled()) return null;
  const old = [...(saved?.sections || []), ...(app.show.sections || [])];
  const info = { tempo: r.tempo || null, beats: r.beats, bars: r.bars,
    sections: describeSections(keepYours(r.sections, old), r.traits) };
  applySongInfo(info);
  const ref = app.show.audio;
  if (ref) api(songInfoUrl(ref), { method: "PUT", json: info }).catch(() => {});
  // Then the AI's notes, when they come, if nothing (here or in the Music editor) has changed the
  // sections meanwhile. Not an undo step: Ctrl+Z still takes back what you did last.
  const applied = app.show.sections;
  if (ai) {
    aiSectionNotes(info.sections, r.traits, { name: songTitle(ref), duration: song.duration, tempo: info.tempo }).then(async (got) => {
      if (!got?.used || app.show.sections !== applied || ref !== app.show.audio) return;
      if (ref && !sameSections((await songInfo(ref))?.sections, info.sections)) return;
      if (app.show.sections !== applied || ref !== app.show.audio) return;
      const better = { ...info, sections: got.sections };
      app.show.sections = better.sections.map((s) => ({ ...s }));
      // Folded into the current undo step, so Ctrl+Z takes back your last change, not the notes.
      if (app.history.length) app.history[app.historyIndex] = JSON.stringify(app.show);
      app.dirty = true;
      app.edits++;
      timeline.layout();
      renderSongSummary();
      scheduleAutoSave();
      if (ref) await api(songInfoUrl(ref), { method: "PUT", json: better });
      music.reloadInfo?.(ref);
      status("The AI wrote the section notes; see them in the Music editor");
    }).catch(() => {});
  }
  return r;
}

const sameSections = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

const songTitle = (ref) => (ref?.path || "").split("/").pop().replace(/\.[^.]+$/, "");

// The AI's notes (and better names) for a song's sections, from what was measured in each:
// {sections, used} (used: how many of its notes or names were kept), or null without an AI or if it
// fails, when the notes stay as they were.
async function aiSectionNotes(sections, traits, song) {
  if (!aiVia || !sections?.length) return null;
  const { request, context } = aiRequest(sections, traits, song);
  try {
    const reply = await api("api/ai/sections", { method: "POST", json: { request, context } });
    const got = describeWithAI(sections, traits, reply);
    if (!got.used) status("The AI's reply couldn't be used, so the section notes stay as they were", "hint");
    return got;
  } catch (e) {
    status(`The AI couldn't write the section notes, so they stay as they were: ${e.message}`, "hint");
    return null;
  }
}

// Generate: a first draft of the whole show from the song, a palette and a style.
let generateSeed = 0;

// The settings Generate asks for, shared by its own window and step 2 of New show. `nodes` go in a
// form; read() gives what to generate with (and remembers the choices for next time).
function generateControls() {
  const palette = document.createElement("select");
  const preferred = seasonalPalette() || currentPalette();
  for (const p of allPalettes()) {
    const label = p === seasonalPalette() ? `${p.name} (in season)` : p.name;
    palette.add(new Option(label, p.name, false, p.name === preferred.name));
  }
  const pl = document.createElement("label");
  pl.append("Colours", palette);
  const style = document.createElement("select");
  for (const [key, st] of Object.entries(STYLES)) style.add(new Option(st.label, key, false, key === prefs.get("genStyle", "balanced")));
  const sl = document.createElement("label");
  sl.append("Style", style);
  const house = document.createElement("input");
  house.type = "checkbox";
  house.checked = true;
  const hl = document.createElement("label");
  hl.append(house, "Sweep across the house as the music lifts");
  hl.hidden = !Object.keys(housePositionsAll()).length;
  const build = document.createElement("input");
  build.type = "checkbox";
  build.checked = prefs.get("genBuild", true);
  const bl = document.createElement("label");
  bl.append(build, "Build up: a few lights in quiet parts, more as the music builds, all of them in the loudest");
  // How long one effect may run before the look changes, in bars (a bar is four beats).
  const longest = document.createElement("select");
  for (const [v, label] of [[2, "2 bars"], [4, "4 bars"], [8, "8 bars"], [0, "Any length"]]) {
    longest.add(new Option(label, String(v), false, v === prefs.get("genMaxBars", 4)));
  }
  const ll = document.createElement("label");
  ll.append("Longest effect", longest);
  ll.title = "How long one effect may run before the look changes. A bar is four beats: 4 bars is about 8 seconds at 120 BPM. "
    + "An effect from the AI that runs longer is cut into pieces in the next colours of the palette.";
  const read = () => {
    prefs.set("genStyle", style.value);
    prefs.set("genBuild", build.checked);
    prefs.set("genMaxBars", Number(longest.value));
    const chosen = allPalettes().find((p) => p.name === palette.value) || currentPalette();
    return { colors: chosen.colors, paletteName: chosen.name, style: style.value, house: !hl.hidden && house.checked,
      build: build.checked, maxBars: Number(longest.value) };
  };
  return { nodes: [pl, sl, ll, bl, hl], read };
}

function generateDialog() {
  const dlg = document.createElement("dialog");
  dlg.className = "effect-dialog save-preset-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const h = document.createElement("h3");
  h.textContent = "Generate a show";
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Fills your lights with effects that follow the song's beats and sections: soft looks in quiet "
    + "parts, fast ones on the beat when it gets loud, and the same looks each time a chorus comes back. It replaces "
    + "the lights' effects; Ctrl+Z brings them back. Generate again for a different take.";
  const controls = generateControls();
  // Made by the rules (instant, the same looks every time) or by the AI, which also reads your section notes.
  const maker = document.createElement("select");
  maker.add(new Option("Rules (instant)", "rules"));
  maker.add(new Option("AI (follows your section notes)", "ai"));
  maker.value = aiVia && prefs.get("genMaker", "rules") === "ai" ? "ai" : "rules";
  const ml = document.createElement("label");
  ml.append("Made by", maker);
  ml.hidden = !aiVia;
  const noted = (app.show.sections || []).filter((x) => x.notes).length;
  const notesHint = document.createElement("p");
  notesHint.className = "hint";
  notesHint.textContent = noted ? `${noted} section${noted === 1 ? " has" : "s have"} notes from the Music editor; the AI follows them.`
    : "Add notes to the song's sections in the Music editor to tell the AI what happens in each part.";
  const showNotes = () => { notesHint.hidden = maker.value !== "ai"; };
  maker.addEventListener("change", showNotes);
  showNotes();
  const actions = document.createElement("div");
  actions.className = "insp-actions";
  const go = button("Generate", () => {}, "primary");
  go.type = "submit";
  const cancel = button("Cancel", () => dlg.close(), "ghost");
  cancel.type = "button";
  actions.append(go, cancel);
  form.append(h, hint, ml, notesHint, ...controls.nodes, actions);
  dlg.append(form);
  form.addEventListener("submit", () => {
    if (!ml.hidden) prefs.set("genMaker", maker.value);
    const opts = controls.read();
    if (maker.value === "ai") generateWithAI(opts);
    else generate(opts);
  });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// New show: step 1 is its name and song, step 2 (with an AI set up) how it starts: empty, or made by
// the AI. Nothing is made until Create show, so Cancel leaves everything as it was.
const newShow = { step: 1, song: "", start: "empty", named: false, taken: [], gen: null };

function nsRadioRows(box, name, rows, picked, onPick) {
  const hadFocus = box.contains(document.activeElement);
  box.replaceChildren(...rows.map((r) => {
    const row = document.createElement("label");
    row.className = `song-row${r.value === picked ? " picked" : ""}${r.disabled ? " disabled" : ""}`;
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = name;
    radio.checked = r.value === picked;
    radio.disabled = Boolean(r.disabled);
    radio.addEventListener("change", () => onPick(r.value));
    const text = document.createElement("span");
    const b = document.createElement("b");
    b.textContent = r.label;
    const detail = document.createElement("span");
    detail.className = "hint";
    detail.textContent = r.detail;
    text.append(b, detail);
    if (r.why) {
      const why = document.createElement("span");
      why.className = "hint why";
      why.textContent = r.why;
      text.append(why);
    }
    row.append(radio, text);
    return row;
  }));
  // Redrawing would drop the keyboard focus of someone arrowing through the list.
  if (hadFocus) box.querySelector("input:checked")?.focus();
}

function nsSongs() {
  const rows = [...$("audio-select").options].map((o) => {
    const ref = o.value ? JSON.parse(o.value) : null;
    return { value: o.value, label: ref ? songLabel(ref) : "No song, lights only",
      detail: ref ? `${ref.source === "media" ? "Media" : "Uploaded"}: ${ref.path}` : "Set how long the show runs" };
  });
  nsRadioRows($("ns-songs"), "ns-song", rows, newShow.song, (v) => { newShow.song = v; nsSongPicked(); });
  $("ns-length-wrap").hidden = newShow.song !== "";
}

// Until you type a name of your own, the show is named after its song.
function nsSongPicked() {
  if (!newShow.named) {
    const ref = newShow.song ? JSON.parse(newShow.song) : null;
    $("ns-name").value = freeName(ref ? songLabel(ref) : "Untitled show", newShow.taken);
  }
  nsSongs();
}

function nsStarts() {
  const choices = startChoices({ song: newShow.song !== "", lights: app.deviceList.some((d) => !d.light), ai: Boolean(aiVia) });
  if (!choices.some((c) => c.value === newShow.start && !c.disabled)) newShow.start = "empty";
  nsRadioRows($("ns-starts"), "ns-start", choices, newShow.start, (v) => { newShow.start = v; nsStarts(); });
  $("ns-gen").hidden = newShow.start === "empty";
  $("ns-next").textContent = newShow.start === "empty" ? "Create show" : "Create and generate";
}

function nsStep(step) {
  newShow.step = step;
  $("ns-step-1").hidden = step !== 1;
  $("ns-step-2").hidden = step !== 2;
  $("ns-back").hidden = step !== 2;
  $("ns-upload-wrap").hidden = step !== 1;
  if (step === 1) {
    $("ns-next").textContent = aiVia ? "Next →" : "Create show";
    $("ns-step-1-label").textContent = aiVia ? "Step 1 of 2: name and song" : "Name and song";
    $("ns-name").focus();
  } else {
    nsStarts();
    $("ns-starts").querySelector("input:checked")?.focus();
  }
}

async function openNewShow() {
  if (!(await confirmDiscard())) return;
  await refreshAudio().catch(() => {});
  newShow.taken = (await api("api/shows").catch(() => [])).map((s) => s.name);
  Object.assign(newShow, { song: "", start: "empty", named: false, gen: generateControls() });
  $("ns-gen").replaceChildren(...newShow.gen.nodes);
  nsSongPicked();
  $("ns-length").value = 60;
  $("new-show-dialog").showModal();
  nsStep(1);
}

async function nsSubmit(e) {
  e.preventDefault();
  if (newShow.step === 1) {
    const name = $("ns-name").value.trim();
    if (!name) { $("ns-name").focus(); return; }
    if (newShow.taken.some((n) => n.toLowerCase() === name.toLowerCase())) {
      status(`There's already a show called ${name}. Give this one its own name`, "hint");
      $("ns-name").select();
      return;
    }
    // With no AI there's only Start empty, so there's nothing to choose in step 2.
    if (aiVia) { nsStep(2); return; }
    newShow.start = "empty";
  }
  const show = { name: $("ns-name").value.trim(), audio: newShow.song ? JSON.parse(newShow.song) : null,
    length: Math.max(1, Number($("ns-length").value) || 60), start: newShow.start,
    gen: newShow.start === "empty" ? null : newShow.gen.read() };
  $("new-show-dialog").close();
  await createShow(show);
}

async function createShow({ name, audio: ref, length, start, gen }) {
  await openShow(null);
  app.show.name = name;
  $("show-name").value = name;
  app.show.audio = ref;
  if (!ref) {
    app.show.duration = length;
    $("duration").value = length;
  }
  showView("editor");
  try {
    await loadAudio(ref);
    if (ref) await importSongInfo();
    app.changed();
    await save();
    status(`${name} saved`, "saved", "show");
  } catch (err) {
    status(`Couldn't save ${name}: ${err.message}`, true, "show");
  }
  renderSaveState();
  if (start === "ai") await generateWithAI(gen);
}

async function generate({ colors, style, house, build, maxBars = prefs.get("genMaxBars", 4) }) {
  // A split light gets effects on its parts; its own track (all the parts at once) is left for you.
  // Its parts light up and go dark together when building up.
  const lights = app.show.tracks.filter((tr) => tr.device !== HOUSE && playingDev(tr) && !playingDev(tr).light)
    .map((tr) => {
      const dev = app.devices[tr.device];
      return { id: tr.device, group: dev.parent || dev.id, segments: dev.segments, slow: isSlow(dev),
        fits: (c) => fitFor(c, dev).level !== "no" };
    });
  if (!lights.length) { status("Add your lights under Setup → Devices first", "hint"); return; }
  // Listen to the song first if that hasn't been done yet.
  if (songBuffer && !app.show.beats.length && !app.show.sections?.length && !(await analyseSong())) return;
  const show = app.show;
  const result = generateShow({ ...show, duration: app.duration() }, lights, colors, { style, house, build, maxBars, seed: ++generateSeed });
  applyGenerated(show, result);
  app.select(null);
  app.changed();
  status(`Generated effects for ${lights.length} light${lights.length === 1 ? "" : "s"}. Ctrl+Z to undo`);
}

// Generate with the AI: the whole show from the song, its sections and their notes, in one request.
async function generateWithAI({ colors, paletteName, style, house, build, maxBars = prefs.get("genMaxBars", 4) }) {
  // A window over the editor while the AI works, so it's plain it's busy and nothing is changed
  // underneath it; Cancel (or Esc) stops waiting and leaves the show as it was.
  if (!aiLights().some((l) => !l.house)) { status("Add your lights under Setup → Devices first", "hint"); return; }
  const busy = busyWindow(`Generating ${app.show.name || "your show"}`);
  if (songBuffer && !app.show.beats.length && !app.show.sections?.length) {
    busy.say("Listening to the song first…");
    const heard = await analyseSong({ cancelled: () => busy.cancelled });
    if (!heard || busy.cancelled) { busy.close(); return; }
  }
  const feel = { calm: "calm and gentle, with slow movement", balanced: "balanced, building with the music",
    lively: "lively, with lots of movement on the beat" }[style] || "balanced";
  const request = `Make a complete light show for the whole song${build ? "" : " on every light"}. Use the "${paletteName}" colours `
    + `(${colors.join(", ")}). Keep it ${feel}: quiet sections soft, loud sections bright and on the beat, and the `
    + "same looks each time a section comes back. Change looks on bar lines. Follow each section's notes."
    + (build ? " Build it up as a person would: in quiet sections use only one or a few lights and leave the rest "
      + "dark; bring more lights in as the music builds, adding them on bar lines; use every light together only "
      + "in the loudest sections and the chorus. Keep the parts of one light (named Light · Part) on or off together." : "")
    + (house ? " Add sweeps across the house as the music lifts into louder sections." : "");
  // Clips longer than Longest effect are cut at bar lines here, rather than asking the AI for more,
  // shorter clips, which could run past how much it may write in one reply.
  const tidy = (placed) => placed.flatMap(({ trackIndex, clip }) => splitLong([clip], {
    maxBars, colors, bars: app.show.bars || [], bps: (app.show.tempo || 120) / 60,
  }).map((c) => ({ trackIndex, clip: c })));
  try {
    await describe(request, null, { replaceAll: true, what: "the show", busy, tidy });
  } finally {
    busy.close();
  }
}

// A window that covers the editor while something long runs: a spinner, what's happening with a
// running count of seconds, and Cancel. Returns {say(text), close(), signal, cancelled}.
function busyWindow(title) {
  const dlg = document.createElement("dialog");
  dlg.className = "effect-dialog busy-dialog";
  dlg.setAttribute("aria-labelledby", "busy-title");
  const h = document.createElement("h3");
  h.id = "busy-title";
  h.textContent = title;
  const row = document.createElement("p");
  row.className = "busy-row";
  const spin = document.createElement("span");
  spin.className = "spinner";
  const text = document.createElement("span");
  text.setAttribute("aria-live", "polite");
  row.append(spin, text);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Nothing in the show changes until it's done. Cancel stops waiting and keeps the show as it is.";
  const ctl = new AbortController();
  const cancel = button("Cancel", () => stop(), "ghost");
  const actions = document.createElement("div");
  actions.className = "insp-actions";
  actions.append(cancel);
  dlg.append(h, row, hint, actions);
  const started = performance.now();
  let what = "";
  const tick = () => {
    const secs = Math.round((performance.now() - started) / 1000);
    text.textContent = `${what} ${secs} s`;
  };
  const timer = setInterval(tick, 1000);
  const state = {
    signal: ctl.signal,
    cancelled: false,
    say(t) { what = t; tick(); },
    close() {
      clearInterval(timer);
      if (dlg.open) dlg.close();
      dlg.remove();
    },
  };
  function stop() {
    state.cancelled = true;
    ctl.abort();
    state.close();
    status("Cancelled. Your show is as it was", "hint");
  }
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); stop(); }); // Esc
  document.body.append(dlg);
  dlg.showModal();
  cancel.focus();
  state.say("Getting ready…");
  return state;
}

// Presets from a description in words: the AI suggests a few, shown with live previews on the Presets
// tab until you keep the ones you like.
let aiPresetIdeas = [];

async function describePresets(e) {
  e.preventDefault();
  const request = $("ai-preset-request").value.trim();
  if (!request) { $("ai-preset-request").focus(); return; }
  const context = { effects: effectsForAI(), palettes: allPalettes().map((p) => ({ name: p.name, colors: p.colors })) };
  const done = aiWorking($("btn-ai-preset"), $("ai-preset-request"), $("ai-preset-hint"), "presets");
  let reply;
  try {
    reply = await api("api/ai/presets", { method: "POST", json: { request, context } });
  } catch (err) {
    done(err.message, true);
    return;
  }
  const { presets, skipped } = checkPresets(reply);
  aiPresetIdeas = presets;
  const extra = skipped.length ? ` (left out ${skipped.length}: ${[...new Set(skipped)].slice(0, 2).join("; ")})` : "";
  const message = `${reply.summary || `Made ${presets.length} presets`}${extra}`;
  done(presets.length ? `✓ ${message} Keep the ones you like.` : message, !presets.length);
  renderPresetsTab();
}

function renderAiPresetIdeas() {
  const box = $("ai-preset-ideas");
  box.replaceChildren();
  const dev = presetPreviewDev();
  for (const idea of aiPresetIdeas) {
    const card = document.createElement("div");
    card.className = "ai-preset-idea";
    const strip = document.createElement("canvas");
    strip.className = "fx-strip";
    const name = document.createElement("span");
    name.className = "ai-preset-idea-name";
    name.textContent = idea.name;
    const fx = document.createElement("span");
    fx.className = "hint";
    fx.textContent = EFFECTS[idea.effect].label;
    const actions = document.createElement("div");
    actions.className = "insp-actions";
    const drop = () => { aiPresetIdeas = aiPresetIdeas.filter((x) => x !== idea); };
    actions.append(
      button("Keep", () => {
        const kept = asPreset({ ...idea, name: freePresetName(idea.effect, idea.name) });
        app.myPresets.push(kept);
        presetEditing = kept;
        drop();
        savePresets();
        renderPresetsTab();
        status(`Kept ★ ${kept.name} as a ${EFFECTS[idea.effect].label} preset`);
      }, "primary"),
      button("Dismiss", () => { drop(); renderPresetsTab(); }, "ghost"),
    );
    card.append(strip, name, fx, actions);
    presetTabPreview.items.push({ canvas: strip, clip: presetClip(idea), dev });
    box.append(card);
  }
}

// Palettes from a description in words: the AI suggests a few, shown on the Palettes tab until you
// keep the ones you like.
let aiPaletteIdeas = [];

async function describePalettes(e) {
  e.preventDefault();
  const request = $("ai-palette-request").value.trim();
  if (!request) { $("ai-palette-request").focus(); return; }
  const context = { palettes: allPalettes().map((p) => ({ name: p.name, colors: p.colors })) };
  const done = aiWorking($("btn-ai-palette"), $("ai-palette-request"), $("ai-palette-hint"), "palettes");
  let reply;
  try {
    reply = await api("api/ai/palettes", { method: "POST", json: { request, context } });
  } catch (err) {
    done(err.message, true);
    return;
  }
  const { palettes, skipped } = checkPalettes(reply);
  aiPaletteIdeas = palettes;
  const extra = skipped.length ? ` (left out ${skipped.length}: ${skipped.slice(0, 2).join("; ")})` : "";
  const message = `${reply.summary || `Made ${palettes.length} palettes`}${extra}`;
  done(palettes.length ? `✓ ${message} Keep the ones you like.` : message, !palettes.length);
  renderPalettes();
}

function renderAiPaletteIdeas() {
  const box = $("ai-palette-ideas");
  box.replaceChildren(...aiPaletteIdeas.map((idea) => {
    const card = document.createElement("div");
    card.className = "ai-preset-idea";
    const bar = document.createElement("div");
    bar.className = "palette-bar";
    for (const c of idea.colors) {
      const el = document.createElement("span");
      el.style.background = c;
      bar.append(el);
    }
    const name = document.createElement("span");
    name.className = "ai-preset-idea-name";
    name.textContent = idea.name;
    const actions = document.createElement("div");
    actions.className = "insp-actions";
    const drop = () => { aiPaletteIdeas = aiPaletteIdeas.filter((x) => x !== idea); };
    actions.append(
      button("Keep", () => {
        const kept = { name: uniqueName(idea.name), colors: [...idea.colors] };
        app.palettes.push(kept);
        drop();
        savePalettes();
        renderPalettes();
        status(`Kept ${kept.name} in your palettes`);
      }, "primary"),
      button("Dismiss", () => { drop(); renderPalettes(); }, "ghost"),
    );
    card.append(bar, name, actions);
    return card;
  }));
}

// Describe it: effects from a request in words, made by the AI the add-on is set up with.
let aiVia = null; // how AI requests go ("claude" or "ha"), or null when no AI is set up

async function loadAiStatus() {
  let st = { via: null };
  try { st = await api("api/ai"); } catch { /* older add-on or offline */ }
  aiVia = st.via;
  const text = st.via === "claude" ? `Using Claude (${st.model}) with the API key from the app's Configuration tab.`
    : st.via === "ha" ? `Using Home Assistant's AI Task${st.entity ? ` (${st.entity})` : ""}.`
      : "Not set up yet: add a Claude API key on the app's Configuration tab, or set up an AI integration with an AI Task entity in Home Assistant.";
  $("ai-status").textContent = text;
  $("ai-hint").textContent = st.via ? "" : "Set up an AI under Setup → Settings to use this.";
  $("ai-hint").hidden = !!st.via;
  $("ai-preset-hint").textContent = st.via ? "" : $("ai-hint").textContent;
  $("ai-preset-hint").hidden = !!st.via;
  $("ai-palette-hint").textContent = st.via ? "" : $("ai-hint").textContent;
  $("ai-palette-hint").hidden = !!st.via;
  // With no AI there's nothing for Create to do, so it shouldn't look ready to press.
  $("btn-ai").disabled = $("btn-ai-preset").disabled = $("btn-ai-palette").disabled = !st.via;
}

// The lights as the AI knows them: unique names, with the House lane when the house photo is traced.
function aiLights() {
  const seen = new Set(), traced = Object.keys(housePositionsAll()).length > 0;
  const lights = [];
  app.show.tracks.forEach((tr, i) => {
    if (tr.device === HOUSE) {
      if (traced) lights.push({ name: "House", trackIndex: i, segments: 0, house: true });
      return;
    }
    const dev = playingDev(tr);
    if (!dev) return;
    let name = dev.name || tr.device;
    for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${dev.name || tr.device} (${k})`;
    seen.add(name.toLowerCase());
    lights.push({ name, trackIndex: i, segments: dev.segments, ...(isSlow(dev) ? { slow: true } : {}) });
  });
  return lights;
}

async function describeIt(e) {
  e.preventDefault();
  const request = $("ai-request").value.trim();
  if (!request) { $("ai-request").focus(); return; }
  const sel = app.selected;
  await describe(request, (lights) => {
    const names = (ts) => lights.filter((l) => ts.includes(l.trackIndex)).map((l) => l.name);
    return sel?.range ? { start: sel.range.start, end: sel.range.end, lights: names(rangeTracks(sel.range)) }
      : sel?.clip ? { start: sel.clip.start, end: sel.clip.end, lights: names([sel.track]) } : null;
  });
}

// Sends a request to the AI with the show's context and puts the clips it makes on the show.
// selectionFor(lights) gives the selection to send; replaceAll clears the lights first, as Generate does.
async function describe(request, selectionFor, { replaceAll = false, what = "your effects", busy = null, tidy = (p) => p } = {}) {
  const lights = aiLights();
  if (!lights.some((l) => !l.house)) { status("Add your lights under Setup → Devices first", "hint"); return; }
  const selection = selectionFor ? selectionFor(lights) : null;
  const show = app.show, duration = app.duration();
  const context = buildContext({ show, lights, duration, selection, palettes: allPalettes() });
  const done = aiWorking(undefined, undefined, undefined, what);
  status(`Asking the AI to make ${what}…`);
  busy?.say(`The AI is designing ${what} from the song and its notes (usually under a minute)…`);
  let reply;
  try {
    reply = await api("api/ai/clips", { method: "POST", json: { request, context }, signal: busy?.signal });
  } catch (err) {
    if (busy?.cancelled) { done("Cancelled. Nothing was changed"); return; }
    done(err.message, true);
    status(err.message, true);
    return;
  }
  if (show !== app.show || busy?.cancelled) { done(""); return; } // another show was opened, or Cancel
  const checked = checkClips(reply, lights, duration), skipped = checked.skipped;
  // The AI can't see what each light can show, so clips that won't work on theirs are left out.
  const placed = tidy(checked.placed.filter(({ trackIndex, clip }) => {
    if (clipFitOn(clip, trackIndex).level !== "no") return true;
    skipped.push(`${EFFECTS[clip.effect].label} won't work on ${trackName(trackIndex)}`);
    return false;
  }));
  if (placed.length) {
    if (replaceAll) for (const l of lights) show.tracks[l.trackIndex].clips = [];
    placeClips(show, placed);
    app.select(null);
    app.changed();
  }
  const extra = skipped.length ? ` (left out ${skipped.length}: ${[...new Set(skipped)].slice(0, 2).join("; ")})` : "";
  const message = `${reply.summary || `Added ${placed.length} effects`}${extra}`;
  done(placed.length ? `✓ ${message}` : message, !placed.length);
  status(message, placed.length ? "info" : "hint");
}

// Shows that the AI is working (a spinner and a running count of seconds in the panel) until the
// returned function is called with the outcome to leave there.
function aiWorking(btn = $("btn-ai"), input = $("ai-request"), hint = $("ai-hint"), what = "your effects") {
  const label = btn.innerHTML;
  btn.disabled = input.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Working…`;
  hint.hidden = false;
  hint.classList.remove("error");
  const started = performance.now();
  const tick = () => {
    const secs = Math.round((performance.now() - started) / 1000);
    hint.textContent = `Asking the AI to make ${what}… ${secs} s (usually 10 to 60 seconds)`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  return (message, error = false) => {
    clearInterval(timer);
    btn.disabled = input.disabled = false;
    btn.innerHTML = label;
    hint.textContent = message;
    hint.classList.toggle("error", error);
  };
}

function frame() {
  if (app.playing) {
    app.time = currentTime();
    const end = playEnd();
    if (app.time >= end) {
      if (app.loop && !app.remote) {
        app.seek(app.region ? app.region.start : 0);
        // The add-on's player stops at the end of the show, so start it again for the next lap.
        if (!app.region && lightsOn()) {
          api("api/player/play", { method: "POST", json: { show: app.showId, position: 0, offset: offset() } })
            .catch(() => {});
        }
      } else {
        app.time = end;
        stop();
      }
    }
    timeline.follow(app.time);
  }
  $("clock").textContent = fmtTime(app.time);
  timeline.drawPlayhead();
  drawPreview();
  drawHouse();
  drawClipPreview();
  drawPickerPreviews();
  requestAnimationFrame(frame);
}

// wiring ----------------------------------------------------------------------
// Library and Setup each hold several pages; each remembers the page last open in it.
const SECTIONS = { library: ["shows", "songs", "palettes", "presets", "playlists"], setup: ["devices", "speakers", "house", "settings", "labs"] };
const sectionPage = { library: "shows", setup: "devices" };

// Opens a tab (editor, music, library, setup) or a page in Library or Setup (devices, palettes…).
function showView(view, { push = true } = {}) {
  if (view === "labs" && !labsOn()) view = "settings";
  if (view === "public" && $("tab-public").hidden) view = "settings";
  const section = Object.keys(SECTIONS).find((k) => SECTIONS[k].includes(view));
  if (section) sectionPage[section] = view;
  let page = SECTIONS[view] ? sectionPage[view] : view;
  // Each visit the Show editor starts on Your shows, so nothing changes until you open one.
  if (page === "editor" && !app.chosen) page = "showlist";
  // And the Music editor on Your songs.
  if (page === "music" && !app.songChosen) page = "songlist";
  // And the Playlist editor on Your playlists.
  if (page === "playlist" && !app.playlistChosen) page = "playlistlist";
  const top = section || view;
  for (const t of document.querySelectorAll(".tab")) {
    t.classList.toggle("active", t.dataset.view === ({ showlist: "editor", songlist: "music", playlistlist: "playlist" }[top] || top));
    if (t.dataset.view === top) t.scrollIntoView({ block: "nearest", inline: "nearest" }); // on a phone the tab row scrolls
  }
  for (const t of document.querySelectorAll(".subtab")) t.classList.toggle("active", t.dataset.view === page);
  for (const k of Object.keys(SECTIONS)) $(`section-${k}`).hidden = k !== top;
  for (const v of ["showlist", "editor", "songlist", "music", "playlistlist", "playlist", "public", ...Object.values(SECTIONS).flat()]) $(`view-${v}`).hidden = v !== page;
  if (page === "songlist") document.querySelector("[data-songs-slot]").append($("songs-block"));
  if (page === "songs") $("view-songs").append($("songs-block"));
  if (page === "showlist" || page === "shows") renderShowLists();
  // Going back to Your shows (← All shows, or the browser's Back) puts the show away, so it stops too.
  if (page === "showlist" && app.playing) stop();
  if (page === "songs" || page === "songlist") renderSongsPage();
  if (page === "music") refreshAudio().catch(() => {}).then(() => music.show()); else music.hide();
  if (page === "speakers") loadSpeakers();
  if (page === "house") renderHouseLights();
  if (page === "settings") { renderCopies(); loadPublic(); }
  if (page === "public") {
    loadPublic({ items: true });
    const frame = $("pub-preview-frame");
    if (!frame.src) frame.src = "public-preview/";
  }
  if (["playlists", "playlistlist", "playlist"].includes(page)) loadPlaylists(); else stopPlaylistWatch();
  if (page === "editor") { layoutPreview(); timeline.layout(); loadSongMarks(); }
  rememberPage(page, push);
}

// The browser's Back and Forward move between pages of HA-liday Show (inside Home Assistant too:
// the app's frame shares the tab's history), instead of leaving it. Each page visited is an entry,
// named in the address after # and numbered, so a refused Back can be undone step for step.
let shownPage = null, undoing = false, navigating = false;
let shownN = (() => { try { return Number.isInteger(history.state?.n) ? history.state.n : 0; } catch { return 0; } })();
const isPage = (p) => typeof p === "string" && /^[a-z]+$/.test(p) && !!$(`view-${p}`);

function rememberPage(page, push) {
  if (page === shownPage && push) return;
  const first = shownPage === null;
  shownPage = page;
  try {
    if (push && !first) history.pushState({ page, n: (shownN += 1) }, "", `#${page}`); // drops any Forward
    else history.replaceState({ page, n: shownN }, "", `#${page}`);
  } catch { /* a sandboxed frame may refuse; the pages still work */ }
}

// Back or Forward: go to that page as the app's own buttons would, asking first where they would.
async function pageFromHistory(e) {
  if (undoing) { undoing = false; return; } // the browser putting back a refused move
  const page = e.state?.page || location.hash.slice(1);
  const n = Number.isInteger(e.state?.n) ? e.state.n : shownN;
  // Undo the move (all its steps) and stay where you are.
  const refuse = () => {
    if (n === shownN) return;
    undoing = true;
    history.go(shownN - n);
  };
  if (!isPage(page) || navigating || document.querySelector("dialog[open]")) {
    refuse();
    // Back while the AI is generating is how you'd stop it on a phone: it's Cancel.
    document.querySelector(".busy-dialog[open] .insp-actions button")?.click();
    return;
  }
  navigating = true;
  try {
    if (shownPage === "editor" && page === "showlist") {
      if (!(await confirmDiscard())) { refuse(); return; }
      app.chosen = false;
    }
    if (shownPage === "music" && page === "songlist") {
      await music.flush();
      if (music.unsaved && !confirm("Your last change to the draft couldn't be kept (is HA-liday Show still running?). Leave it anyway?")) { refuse(); return; }
      app.songChosen = false;
    }
    if (shownPage === "playlist" && page === "playlistlist") app.playlistChosen = false;
    // Forward again to the show, song or playlist that was open.
    if (page === "playlist" && !app.playlistChosen && openPlaylist()) app.playlistChosen = true;
    if (page === "editor" && !app.chosen && app.showId) app.chosen = true;
    if (page === "music" && !app.songChosen && music.base) app.songChosen = true;
    shownN = n;
    showView(page, { push: false }); // also puts the page that actually showed in the address
    if (shownPage === "showlist") renderShowLists();
  } finally {
    navigating = false;
  }
}

function wire() {
  // Windows live at the top of the page, so they can open over any tab (the setup guide opens
  // Add a light and Add a speaker from the editor).
  for (const d of document.querySelectorAll(".view dialog")) document.body.append(d);
  for (const tab of document.querySelectorAll(".tab, .subtab")) tab.addEventListener("click", () => showView(tab.dataset.view));

  $("show-name").addEventListener("change", (e) => {
    app.show.name = e.target.value.trim() || "Untitled show";
    app.changed();
    renderSaveState();
  });
  $("btn-save").addEventListener("click", saveClicked);
  $("song-filter").addEventListener("input", drawSongRows);
  $("btn-add-song").addEventListener("click", openAddSong);
  $("as-form").addEventListener("submit", asSubmit);
  $("as-back").addEventListener("click", () => asStep(1));
  $("as-name").addEventListener("input", () => { addSong.named = true; });
  $("as-file").addEventListener("change", (e) => { asFilePicked(e.target.files[0]); e.target.value = ""; });
  for (const b of document.querySelectorAll("[data-as=cancel]")) b.addEventListener("click", () => $("add-song-dialog").close());
  // Not while it's uploading or listening: the song would be half added.
  $("add-song-dialog").addEventListener("cancel", (e) => { if (addSong.busy) e.preventDefault(); });
  $("btn-all-songs").addEventListener("click", async () => {
    await music.flush();
    if (music.unsaved && !confirm("Your last change to the draft couldn't be kept (is HA-liday Show still running?). Leave it anyway?")) return;
    app.songChosen = false;
    showView("music");
  });
  $("btn-all-shows").addEventListener("click", async () => {
    if (!(await confirmDiscard())) return;
    const id = app.showId;
    app.chosen = false;
    showView("editor");
    await renderShowLists();
    if (id) focusRow(id, "open");
  });
  for (const b of document.querySelectorAll("[data-show-new]")) {
    b.addEventListener("click", openNewShow);
  }
  for (const b of document.querySelectorAll("[data-show-import]")) {
    b.addEventListener("click", () => { $("im-file").value = ""; $("im-file").click(); });
  }
  $("im-file").addEventListener("change", (e) => { if (e.target.files[0]) importFile(e.target.files[0]); });
  $("im-form").addEventListener("submit", imSubmit);
  $("im-back").addEventListener("click", () => imStep(1));
  for (const b of document.querySelectorAll("[data-im=cancel]")) b.addEventListener("click", () => $("import-dialog").close());
  $("im-add-song").addEventListener("click", () => openAddSong({ onAdded: (v) => { if (v) imp.song = v; imSongs(); } }));
  $("ns-form").addEventListener("submit", nsSubmit);
  $("ns-back").addEventListener("click", () => nsStep(1));
  $("ns-name").addEventListener("input", () => { newShow.named = true; });
  for (const b of document.querySelectorAll("[data-ns=cancel]")) b.addEventListener("click", () => $("new-show-dialog").close());
  $("ns-upload-wrap").addEventListener("click", () => openAddSong({ onAdded: (v) => { if (v) newShow.song = v; nsSongPicked(); } }));
  $("autosave").checked = prefs.get("autosave", true);
  $("autosave").addEventListener("change", (e) => { prefs.set("autosave", e.target.checked); scheduleAutoSave(); });
  $("btn-delete").addEventListener("click", () => {
    if (!app.showId) return;
    $("show-dialog").close();
    openRemoveShow({ id: app.showId, name: app.show.name });
  });
  for (const b of document.querySelectorAll("[data-rm=close]")) b.addEventListener("click", () => $("remove-dialog").close());
  $("rm-archive").addEventListener("click", () => doRemove(false));
  $("rm-delete").addEventListener("click", () => doRemove(true));
  $("rm-replacement").addEventListener("change", () => { document.querySelector("input[name=rm-instead][value=song]").checked = true; });
  $("btn-show-settings").addEventListener("click", () => {
    $("btn-delete").disabled = !app.showId;
    $("show-dialog").showModal();
  });
  $("btn-song").addEventListener("click", () => refreshAudio().catch(() => {}).then(openSongDialog));
  $("song-dialog").addEventListener("close", () => {
    const sel = $("audio-select");
    if ($("song-dialog").returnValue !== "use" || songPick === sel.value) return;
    sel.value = songPick;
    sel.dispatchEvent(new Event("change"));
  });
  // Opens the picked song in the Music editor, or Your songs when it's lights only.
  $("btn-song-music").addEventListener("click", () => {
    $("song-dialog").close("");
    if (songPick) editSong(JSON.parse(songPick));
    else showView("music");
  });

  $("audio-select").addEventListener("change", async (e) => {
    app.show.audio = e.target.value ? JSON.parse(e.target.value) : null;
    app.changed();
    await stop();
    await loadAudio(app.show.audio);
    await importSongInfo();
  });
  // A song added from Choose a song comes back picked, ready for Use this song.
  $("btn-song-add").addEventListener("click", () => openAddSong({ onAdded: (v) => { if (v) songPick = v; renderSongList(); } }));
  $("duration").addEventListener("change", (e) => {
    app.show.duration = Math.max(1, Number(e.target.value) || 60);
    app.changed();
  });
  audio.addEventListener("ended", stop);

  $("btn-play").addEventListener("click", () => (app.playing ? stop() : play()));
  $("btn-home").addEventListener("click", () => app.seek(app.region ? app.region.start : 0));
  $("loop").checked = app.loop;
  $("loop").addEventListener("change", (e) => { app.loop = e.target.checked; prefs.set("loop", app.loop); });
  $("btn-clear-region").addEventListener("click", () => app.setRegion(null));
  $("btn-tap").addEventListener("click", tapBeat);
  $("btn-fill-beats").addEventListener("click", fillBeats);
  $("btn-detect").addEventListener("click", detectBeats);
  $("btn-song-beats").addEventListener("click", () => importSongInfo({ quiet: false }));
  $("btn-generate").addEventListener("click", generateDialog);
  $("ai-form").addEventListener("submit", describeIt);
  $("ai-preset-form").addEventListener("submit", describePresets);
  $("ai-palette-form").addEventListener("submit", describePalettes);
  $("btn-clear-beats").addEventListener("click", () => {
    if ((app.show.beats.length || app.show.sections?.length) && confirm("Remove all beat markers and sections?")) {
      Object.assign(app.show, { beats: [], bars: [], sections: [] });
      app.changed();
    }
  });
  $("snap").checked = app.snap;
  $("snap").addEventListener("change", (e) => { app.snap = e.target.checked; prefs.set("snap", app.snap); });
  $("lights").checked = prefs.get("lights", true);
  $("lights").addEventListener("change", (e) => {
    prefs.set("lights", e.target.checked);
    if (!e.target.checked && app.playing) api("api/player/stop", { method: "POST" }).catch(() => {});
  });
  $("offset").addEventListener("change", offsetChanged);
  $("output-select").addEventListener("change", async (e) => {
    await stop();
    prefs.set("editorSpeaker", e.target.value);
    renderOutput();
  });
  $("show-speaker").addEventListener("change", (e) => {
    app.show.media_player = e.target.value || null;
    app.changed();
    renderOutput();
  });
  $("default-speaker").addEventListener("change", async (e) => {
    try {
      const body = await api("api/speakers/show", { method: "PUT", json: { entity_id: e.target.value || null } });
      app.defaultSpeaker = body.show_speaker;
    } catch (err) { status(`Couldn't save the default speaker: ${err.message}`, true); }
    renderOutput();
  });
  app.zoomed = () => prefs.set("pps", app.pps);
  $("btn-zoom-in").addEventListener("click", () => timeline.zoom(1.5));
  $("btn-zoom-out").addEventListener("click", () => timeline.zoom(1 / 1.5));

  $("btn-scan").addEventListener("click", () => (addFlow.kind === "wled" ? scanWled() : scan()));
  $("btn-add-light").addEventListener("click", openAddLight);
  $("btn-add-speaker").addEventListener("click", openAddSpeaker);
  $("btn-demo").addEventListener("click", tryDemo);
  $("btn-demo-remove").addEventListener("click", removeDemo);
  $("speaker-filter").addEventListener("input", renderSpeakerCandidates);
  $("speaker-dialog").addEventListener("click", (e) => {
    if (e.target.closest('[data-speaker="close"]')) $("speaker-dialog").close();
  });
  for (const b of $("add-dialog").querySelectorAll("[data-kind]")) {
    b.addEventListener("click", () => { addFlow.kind = b.dataset.kind; addStep("details"); });
  }
  $("add-dialog").addEventListener("click", (e) => {
    const what = e.target.closest("[data-add]")?.dataset.add;
    if (what === "close") $("add-dialog").close();
    else if (what === "back") addStep("kind");
    else if (what === "again") openAddLight();
    else if (what === "go") addLightNow();
  });
  $("add-dialog").addEventListener("input", () => { $("add-error").hidden = true; });
  $("add-dialog").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input") && !$("add-go").hidden) { e.preventDefault(); addLightNow(); }
  });
  $("btn-new-preset").addEventListener("click", newPreset);
  for (const b of document.querySelectorAll("[data-playlist-new]")) b.addEventListener("click", newPlaylist);
  $("btn-all-playlists").addEventListener("click", async () => {
    await flushPlaylists().catch(() => {});
    app.playlistChosen = false;
    showView("playlist");
  });
  $("pl-name").addEventListener("change", () => {
    const pl = openPlaylist();
    if (!pl) return;
    const v = $("pl-name").value.trim();
    if (!v || playlists.some((q) => q !== pl && q.name.toLowerCase() === v.toLowerCase())) {
      status("Give each playlist its own name", "hint");
      $("pl-name").value = pl.name;
      return;
    }
    pl.name = v;
    savePlaylists();
  });
  $("pl-filter").addEventListener("input", renderPlaylistBin);
  $("pl-play").addEventListener("click", () => { const pl = openPlaylist(); if (pl) togglePlaylist(pl); });
  $("pl-delete").addEventListener("click", async () => {
    const pl = openPlaylist();
    if (!pl || !(await deletePlaylist(pl))) return;
    app.playlistChosen = false;
    showView("playlist");
  });
  $("sun-place").addEventListener("submit", saveSunPlace);
  $("sun-place-clear").addEventListener("click", async () => {
    try { scheduleState = await api("api/location", { method: "PUT", json: {} }); } catch (err) { status(err.message, true); }
    refreshPlaylistStatus();
  });
  $("btn-new-palette").addEventListener("click", () => {
    openPaletteWindow(null, { name: uniqueName("My palette"), colors: ["#ff0000", "#00ff00", "#0000ff"] });
  });
  $("plan-model").addEventListener("change", planModelChanged);


  document.addEventListener("keydown", (e) => {
    if (music.active) { music.key(e); return; }
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); if (!$("view-editor").hidden) saveClicked(); return; }
    // The effect chooser handles its own keys (Escape closes it).
    if (typing || $("view-editor").hidden || document.querySelector("dialog[open]")) return;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); restore(e.shiftKey ? 1 : -1); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); restore(1); }
    else if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); copySelection(); }
    else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); paste(); }
    else if (e.key === " ") { e.preventDefault(); app.playing ? stop() : play(); }
    else if (e.key === "b" || e.key === "B") tapBeat();
    else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    else if (e.key === "d" || e.key === "D") duplicateSelected();
    else if (e.key === "Home") app.seek(0);
    else if (e.key === "+" || e.key === "=") timeline.zoom(1.5);
    else if (e.key === "-") timeline.zoom(1 / 1.5);
    else if (e.key === "Escape") app.select(null);
  });
  window.addEventListener("beforeunload", (e) => { if (app.dirty) { e.preventDefault(); e.returnValue = ""; } });
}

// Setup → Labs → Packet lab: send a hand-made message to one light and show what comes back.
const LAB_HELP = {
  json: "A whole LAN message, sent as it is.",
  razer: "The command byte and its data in hex; the BB header, length and checksum are added. Set Length field to override it.",
  ptreal: "One app command per line, in hex; each is padded to 20 bytes and given its checksum.",
};

function renderLab() {
  const lights = $("lab-light"), keep = lights.value;
  // The lab speaks Govee's LAN protocol, so it only offers Govee lights.
  lights.replaceChildren(...app.deviceList.filter((d) => d.ip && (d.kind || "govee") === "govee").map((d) => new Option(`${d.name} (${d.ip})`, d.ip)));
  if (keep) lights.value = keep;
  for (const id of ["btn-lab-send", "btn-lab-sweep", "btn-lab-start-sweep", "btn-lab-flag-sweep", "btn-lab-mode-sweep", "btn-lab-speed"]) {
    $(id).disabled = !lights.options.length;
  }
}

function fillLab() {
  const t = LAB_TEMPLATES[$("lab-template").value];
  const hex = $("lab-colour").value;
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  $("lab-kind").value = t.kind;
  $("lab-text").value = t.text(Math.max(1, Math.min(255, Number($("lab-n").value) || 1)), rgb);
  $("lab-length").value = t.length ?? "";
  $("lab-repeat").value = t.repeat ?? 1;
  $("lab-interval").value = t.interval ?? 100;
  $("lab-on").checked = !!t.realtimeOn;
  $("lab-help").textContent = LAB_HELP[t.kind];
}

async function labSpeed() {
  const json = { ip: $("lab-light").value, bulbs: Number($("lab-n").value) || 300,
    small: $("lab-speed-size").value === "small", per_second: Number($("lab-speed-rate").value) };
  try {
    await api("api/lab/speed", { method: "POST", json });
  } catch (e) { status(`Not sent: ${e.message}`, true); return; }
  labWatch(true);
}

async function labSend(sweep = null) {
  const json = sweep ? { ip: $("lab-light").value, steps: sweep } : {
    ip: $("lab-light").value, kind: $("lab-kind").value, text: $("lab-text").value,
    length: $("lab-length").value, repeat: Number($("lab-repeat").value),
    interval_ms: Number($("lab-interval").value), realtime_on: $("lab-on").checked,
  };
  try {
    await api("api/lab/send", { method: "POST", json });
  } catch (e) { status(`Not sent: ${e.message}`, true); return; }
  const legend = $("lab-legend");
  legend.hidden = !sweep;
  if (sweep) legend.replaceChildren(...sweep.map((s) => Object.assign(document.createElement("li"), { textContent: s.label })));
  labWatch(!!sweep);
}

function labWatch(steps) {
  const poll = async () => {
    let s;
    try { s = await api("api/lab"); } catch { return; }
    $("lab-now").hidden = !(steps && s.steps > 1);
    $("lab-now").textContent = s.running ? `Now ${s.step} of ${s.steps}: ${s.label}` : "Finished";
    const log = $("lab-log");
    log.hidden = false;
    log.textContent = [`${s.running ? "Sending" : "Done"}: ${s.sent} sent to ${s.ip}`,
      ...s.log.map((e) => `${e.t.toFixed(2).padStart(7)}s ${{ sent: "→", received: "←", step: "▶" }[e.dir]} ${e.text}`)].join("\n");
    if (s.running) setTimeout(poll, 500);
  };
  poll();
}

function wireLab() {
  for (const [k, t] of Object.entries(LAB_TEMPLATES)) $("lab-template").add(new Option(t.label, k));
  for (const id of ["lab-template", "lab-n", "lab-colour"]) $(id).addEventListener("change", fillLab);
  $("lab-kind").addEventListener("change", () => { $("lab-help").textContent = LAB_HELP[$("lab-kind").value]; });
  $("lab-light").addEventListener("change", () => {
    const d = app.deviceList.find((x) => x.ip === $("lab-light").value);
    if (d) { $("lab-n").value = d.segments; fillLab(); }
  });
  $("btn-lab-send").addEventListener("click", () => labSend());
  $("btn-lab-speed").addEventListener("click", labSpeed);
  for (const [id, sweep] of [["btn-lab-sweep", windowSweep], ["btn-lab-start-sweep", startSweep],
    ["btn-lab-flag-sweep", flagSweep], ["btn-lab-mode-sweep", modeSweep]]) {
    $(id).addEventListener("click", () => {
      const d = app.deviceList.find((x) => x.ip === $("lab-light").value);
      const w = sweepWindow(app.models[skuOf(d?.sku)], Number($("lab-n").value));
      status(`Sweeping the first ${w} bulbs`);
      labSend(sweep(w));
    });
  }
  $("btn-lab-stop").addEventListener("click", () => api("api/lab/stop", { method: "POST", json: {} }).catch(() => {}));
  fillLab();
}

// Setup → Labs → Listen for Govee traffic: record what the lights say to each other, e.g. during Scene Stage.
async function listenForTraffic() {
  try {
    await api("api/diagnostics/listen", { method: "POST", json: { seconds: 60 } });
  } catch (e) { status(`Couldn't listen: ${e.message}`, true); return; }
  $("btn-listen").disabled = true;
  const poll = async () => {
    let s;
    try { s = await api("api/diagnostics/listen"); } catch { setTimeout(poll, 2000); return; }
    $("listen-status").textContent = s.running
      ? `Listening… ${s.left} seconds left, ${s.count} messages so far.`
      : s.count
        ? `Heard ${s.count} messages. Download the recording and attach it to a GitHub issue.`
        : "Heard nothing. The lights may talk to each other directly, out of Home Assistant's hearing.";
    const rows = $("listen-summary").querySelector("tbody");
    rows.replaceChildren(...s.summary.map((r) => {
      const tr = document.createElement("tr");
      for (const v of [r.from, r.to, r.cmd, r.count]) {
        const td = document.createElement("td");
        td.textContent = v;
        tr.append(td);
      }
      return tr;
    }));
    $("listen-summary").hidden = !s.summary.length;
    $("listen-download").hidden = s.running || !s.count;
    if (s.running) setTimeout(poll, 2000); else $("btn-listen").disabled = false;
  };
  poll();
}

async function init() {
  restoreHowTo();
  wire();
  $("btn-listen").addEventListener("click", listenForTraffic);
  wireLab();
  wireHouse();
  wireWizard();
  wireData();
  wirePublic();
  const layout = new Layout(() => { layoutPreview(); timeline.layout(); });
  $("btn-reset-layout").addEventListener("click", () => layout.reset());
  $("exp-labs").checked = labsOn();
  $("tab-labs").hidden = !labsOn();
  $("exp-labs").addEventListener("change", (e) => {
    prefs.set("labs", e.target.checked);
    $("tab-labs").hidden = !e.target.checked;
    if (!e.target.checked && sectionPage.setup === "labs") sectionPage.setup = "settings";
  });
  $("exp-scenes").checked = experimentalOn();
  $("exp-scenes").addEventListener("change", (e) => {
    prefs.set("experimental.scenes", e.target.checked);
    if (!e.target.checked && EFFECTS[app.paletteEffect]?.experimental) app.paletteEffect = "solid";
    renderInspector();
  });
  try {
    await loadDevices();
    keepBlocksReady();
    loadSpeakers();
    loadModels();
    loadPalettes();
    loadPresets();
    loadAiStatus();
    await loadPublic();
    house.load().then(renderHouseLights);
    const shows = await api("api/shows");
    await openShow(null, { chosen: false });
    // Reloaded or bookmarked on a page: open that page (an editor opens on its list).
    const wanted = location.hash.slice(1);
    // It opens on the Library: your shows and songs, with the editors a tab away.
    showView("library");
    if (isPage(wanted) && wanted !== shownPage) showView(wanted, { push: false });
    window.addEventListener("popstate", pageFromHistory);
    // A fresh install opens the setup guide, once.
    if (!app.deviceList.length && !shows.length && !prefs.get("wizard.done", false)) openWizard();
  } catch (e) {
    status(`Couldn't reach HA-liday Show: ${e.message}`, true);
  }
  requestAnimationFrame(frame);
}

init();
