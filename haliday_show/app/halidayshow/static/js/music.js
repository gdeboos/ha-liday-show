// Music editor: cut, shorten and splice songs as drafts (kept as you go), then make the song file.
//
// An edit is a list of pieces of source songs played one after another, overlapping by a short
// crossfade at each join, plus a fade in and out. The source files are never changed: Save renders
// the pieces to a WAV and uploads it like any other song, ready to pick in the editor. Detect finds
// a song's beats and sections and keeps them with the file, for any show that uses it.

import { analyseInWorker, barVectorsInWorker, toMono } from "./analysis.js";
import { cutsRequest, joinLabel, parseTime, rankCuts, sectionCuts, similarity, songPlans } from "./cutfinder.js";
import { DraftKeeper } from "./drafts.js";
import { evenOut, loudness } from "./loudness.js";
import { MAX_CLIPS, MAX_LAYERS, anchorAt, clipSpeed, limit, matchGain, mixLayers, placeClips, sourceKey } from "./layers.js";
import { BANDS, EQ_MAX, EQ_MIN, MAX_CHANGES, applyEq, eqAt, faderText, flatEq, isFlat, placeChanges } from "./mixer.js";
import { stretch } from "./tempo.js";
import { describeSections, keepYours, ruleNote } from "./sectionnotes.js";
import { uploadSong } from "./upload.js";
import { itemsInFolders } from "./songfolders.js";
import { MARK_COLOUR, SECTION_ALPHA, fmtTime, markText, sectionHue, sectionTint } from "./timeline.js";
import { fetchSong, songLoadMessage } from "./songload.js";

const EPS = 1e-6;
const RULER_H = 22;
const BEAT_H = 16; // the beat lane above the waveform, as in the editor
const SEC_H = 20; // the section lane under it, where sections are picked and their edges dragged
const WAVE_B = 210; // the bottom of the waveform; layers' lanes go under it
const LANE_H = 56; // one layer's lane, tall enough to show its clips' waveforms
const LAYER_HUES = [200, 30, 140, 300]; // a colour for each layer's clips
const MIN_SECTION = 0.5;
const MAX_MARKS = 200; // as the server allows
const EDGE_PX = 6;
const BLOCK = 256; // samples per waveform peak

// edit model --------------------------------------------------------------------
// state: { pieces: [{ src, start, end }], crossfade } with times in seconds.

const len = (p) => p.end - p.start;

// The overlap at the join before piece i, never more than half of either piece.
function xfBefore(pieces, i, crossfade) {
  if (i === 0) return 0;
  return Math.max(0, Math.min(crossfade, len(pieces[i - 1]) / 2, len(pieces[i]) / 2));
}

// Where each piece starts in the result, its overlap with the one before, and the result's length.
export function arrange(pieces, crossfade = 0) {
  const out = [];
  let t = 0;
  pieces.forEach((p, i) => {
    const xf = xfBefore(pieces, i, crossfade);
    t -= xf;
    out.push({ at: t, xf });
    t += len(p);
  });
  return { places: out, total: Math.max(0, t) };
}

// Join times in the result (the middle of each crossfade).
export function joins(pieces, crossfade = 0) {
  const { places } = arrange(pieces, crossfade);
  return places.slice(1).map((pl) => pl.at + pl.xf / 2);
}

// What the join before piece i is: a cut (part of one song taken out, `from` to `to` in that song) or
// a splice (where another song, or another part of this one, starts).
export function joinInfo(pieces, i) {
  const a = pieces[i - 1], b = pieces[i];
  if (!a || !b) return null;
  return a.src === b.src && b.start > a.end + EPS ? { kind: "cut", src: a.src, from: a.end, to: b.start } : { kind: "splice", src: b.src };
}

// Puts a cut's part back (the join before piece i), as it was. Returns the pieces and where that
// part now is in the result, so it can be selected to cut again differently; null if it isn't a cut.
export function putBack(pieces, crossfade, i) {
  const info = joinInfo(pieces, i);
  if (info?.kind !== "cut") return null;
  const a = pieces[i - 1], b = pieces[i];
  const out = merge([...pieces.slice(0, i - 1), { src: a.src, start: a.start, end: b.end }, ...pieces.slice(i + 1)]);
  const start = arrange(out, crossfade).places[i - 1].at + (a.end - a.start);
  return { pieces: out, start, end: start + (b.start - a.end) };
}

// Adjacent pieces that continue the same song without a gap become one again.
export function merge(pieces) {
  const out = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.src === p.src && Math.abs(last.end - p.start) < EPS) last.end = p.end;
    else if (len(p) > EPS) out.push({ ...p });
  }
  return out;
}

// The pieces that play between a and b in the result. Each piece owns the time up to the middle
// of its crossfades; a piece wholly inside the range keeps its full length, so pieces that aren't
// touched by an edit keep their joins exactly as they were.
export function slice(pieces, crossfade, a, b) {
  const { places, total } = arrange(pieces, crossfade);
  a = Math.max(0, a);
  b = Math.min(total, b);
  const out = [];
  pieces.forEach((p, i) => {
    const { at, xf } = places[i];
    const own0 = i === 0 ? 0 : at + xf / 2;
    const own1 = i === pieces.length - 1 ? total : places[i + 1].at + places[i + 1].xf / 2;
    const s = Math.max(a, own0), e = Math.min(b, own1);
    if (e - s <= EPS) return;
    out.push({
      src: p.src,
      start: s > own0 + EPS ? p.start + (s - at) : p.start,
      end: e < own1 - EPS ? p.start + (e - at) : p.end,
    });
  });
  return out;
}

export function cut(pieces, crossfade, a, b) {
  const { total } = arrange(pieces, crossfade);
  return merge([...slice(pieces, crossfade, 0, a), ...slice(pieces, crossfade, b, total)]);
}

export function keep(pieces, crossfade, a, b) {
  return merge(slice(pieces, crossfade, a, b));
}

export function insert(pieces, crossfade, t, added) {
  const { total } = arrange(pieces, crossfade);
  return merge([...slice(pieces, crossfade, 0, t), ...added, ...slice(pieces, crossfade, t, total)]);
}

// The beats to draw when they'd be `gap` pixels apart at this zoom: every beat when there's room,
// else every bar, then every 2nd, 4th, 8th… bar, so the lines never swamp the waveform.
// Where ⏪ and ⏩ go from `t`: the bar before or after it (once the song is detected), else `step`
// seconds. Going back from just after a bar's start goes to the bar before, so pressing it while the
// song plays doesn't land where it already is.
export function skipTarget(t, bars, dir, total, step = 5) {
  const slack = 0.3;
  let next = bars?.length
    ? (dir > 0 ? bars.find((b) => b > t + 1e-3) : bars.findLast((b) => b < t - slack))
    : t + dir * step;
  if (next == null) next = dir > 0 ? total : 0;
  return Math.min(Math.max(next, 0), total);
}

export function beatsToDraw(beats, bars, gap, min = 8) {
  if (gap >= min || !bars.length) return beats;
  const perBar = beats.length / Math.max(bars.length, 1);
  let every = 1;
  while (gap * perBar * every < min && every < 1024) every *= 2;
  return bars.filter((_, i) => i % every === 0);
}

// Where in the uncut song a cut preview is, `elapsed` seconds in: it plays from `from` up to the
// selection's start, then carries on from its end.
export function previewTime(elapsed, from, start, end, total) {
  const before = start - from;
  return Math.min(elapsed < before ? from + elapsed : end + (elapsed - before), total);
}

// sections ----------------------------------------------------------------------
// [{start, end, label, energy, color?}], in order. Edits return a new list.

export function sectionAt(sections, t) {
  return sections.findIndex((s, i) => t >= s.start && (t < s.end || i === sections.length - 1));
}

// Splits section i at t into two with the same name and colour.
export function splitSection(sections, i, t) {
  const s = sections[i];
  if (!s || t - s.start < MIN_SECTION || s.end - t < MIN_SECTION) return null;
  return [...sections.slice(0, i), { ...s, end: t }, { ...s, start: t }, ...sections.slice(i + 1)];
}

// Joins section i and the next into one, keeping section i's name and colour.
export function mergeSections(sections, i) {
  if (i < 0 || i + 1 >= sections.length) return null;
  return [...sections.slice(0, i), { ...sections[i], end: sections[i + 1].end }, ...sections.slice(i + 2)];
}

// Removes section i; the one before (or after, for the first) takes over its time.
export function removeSection(sections, i) {
  if (sections.length < 2 || !sections[i]) return null;
  const out = sections.map((s) => ({ ...s }));
  if (i > 0) out[i - 1].end = out[i].end;
  else out[1].start = out[0].start;
  out.splice(i, 1);
  return out;
}

// Moves the edge between section i - 1 and section i to t, keeping both at least MIN_SECTION long.
export function moveEdge(sections, i, t) {
  const a = sections[i - 1], b = sections[i];
  if (!a || !b) return sections;
  const at = Math.min(Math.max(t, a.start + MIN_SECTION), b.end - MIN_SECTION);
  const out = sections.map((s) => ({ ...s }));
  out[i - 1].end = out[i].start = Math.round(at * 1000) / 1000;
  return out;
}

// #rrggbb for a hue at the editor's 70% saturation, 50% lightness, for the colour picker.
export function hueHex(h) {
  const f = (n) => {
    const k = (n + h / 30) % 12, a = 0.35; // saturation × min(lightness, 1 - lightness)
    return Math.round(255 * (0.5 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// marks: named moments you flag in the song, [{t, label, color}] sorted by time ----------------
// Adds a mark at t; returns the new list and where it went.
export function addMark(marks = [], t, color = MARK_COLOUR) {
  const out = [...marks, { t: Math.round(t * 1000) / 1000, label: "", color }].sort((a, b) => a.t - b.t);
  return { marks: out, index: out.findIndex((m) => m.t === Math.round(t * 1000) / 1000 && m.label === "" && m.color === color) };
}

// Moves mark i to t, keeping the list in order; returns the new list and the mark's new place.
export function moveMark(marks, i, t) {
  const moved = { ...marks[i], t: Math.max(0, Math.round(t * 1000) / 1000) };
  const out = marks.filter((_, k) => k !== i).concat(moved).sort((a, b) => a.t - b.t);
  return { marks: out, index: out.indexOf(moved) };
}

// Where time t in the edited result comes from in the base song (src), or null when it's in a part
// spliced in from another song.
export function toBase(pieces, crossfade, src, t) {
  const { places, total } = arrange(pieces, crossfade);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i], { at, xf } = places[i];
    const own0 = i === 0 ? 0 : at + xf / 2;
    const own1 = i === pieces.length - 1 ? total + EPS : places[i + 1].at + places[i + 1].xf / 2;
    if (t >= own0 - EPS && t < own1) return p.src === src ? Math.round((p.start + (t - at)) * 1000) / 1000 : null;
  }
  return null;
}

// The base song's marks after editing the ones shown in the edited result. shown: the marks as
// mapInfo placed them (each with k, its index in base, while there's an edit); edited: that list
// after a change, in result times. Marks in parts cut out are kept. One that would land in a
// spliced-in part keeps its old time, or isn't added if it's new. Returns the new base list and
// where edited[pick] went in it (-1 if nowhere).
export function marksToBase(base, shown, edited, toBaseT, pick = -1) {
  const keyOf = (m, i) => m.k ?? i;
  const visible = new Set(shown.map(keyOf));
  const out = base.filter((_, i) => !visible.has(i));
  // A song spliced into itself shows its marks more than once; the copies are one mark. It's
  // deleted if any copy is, and a changed copy (not one of the shown objects) wins.
  const before = new Set(shown), count = (list, k) => list.filter((m) => m.k === k).length;
  const done = new Map();
  let picked = null;
  edited.forEach((m, i) => {
    if (m.k !== undefined) {
      if (count(edited, m.k) < count(shown, m.k)) return;
      const copies = edited.filter((x) => x.k === m.k);
      if ((copies.find((x) => !before.has(x)) || copies[0]) !== m) {
        if (i === pick) pick = edited.indexOf(copies.find((x) => !before.has(x)) || copies[0]);
        return;
      }
    }
    let t = toBaseT(m.t);
    if (t === null) {
      if (m.k === undefined || !base[m.k]) return;
      t = base[m.k].t;
    }
    const { k: _, ...rest } = m;
    const b = { ...rest, t };
    out.push(b);
    done.set(i, b);
  });
  picked = done.get(pick) || null;
  out.sort((a, b) => a.t - b.t);
  return { marks: out, index: picked ? out.indexOf(picked) : -1 };
}

// Where the base song's beats, bars and sections land in the edited result, so they follow cuts
// and splices. Pieces of other songs spliced in bring theirs too, from `others` (each song's saved
// info by key); their marks go in otherMarks, shown but kept with their own song, so only the base
// song's marks (each with k, its index there) are edited here. A section cut in two by an edit that
// joins up again becomes one.
export function mapInfo(info, pieces, crossfade, src, others = {}) {
  const { places, total } = arrange(pieces, crossfade);
  const r3 = (t) => Math.round(t * 1000) / 1000;
  const beats = [], bars = [], parts = [], marks = [], otherMarks = [];
  pieces.forEach((p, i) => {
    const own = p.src === src;
    const from = own ? info : others[p.src];
    if (!from) return;
    const { at, xf } = places[i];
    const own0 = i === 0 ? 0 : at + xf / 2;
    const own1 = i === pieces.length - 1 ? total : places[i + 1].at + places[i + 1].xf / 2;
    const map = (t) => at + (t - p.start);
    const keep = (list, out) => {
      for (const t of list) if (t >= p.start && t <= p.end && map(t) >= own0 - EPS && map(t) < own1 - EPS) out.push(r3(map(t)));
    };
    keep(from.beats || [], beats);
    keep(from.bars || [], bars);
    (from.marks || []).forEach((m, k) => {
      if (m.t >= p.start && m.t <= p.end && map(m.t) >= own0 - EPS && map(m.t) < own1 - EPS) {
        if (own) marks.push({ ...m, t: r3(map(m.t)), k });
        else otherMarks.push({ ...m, t: r3(map(m.t)) });
      }
    });
    for (const sec of from.sections || []) {
      const a = Math.max(map(sec.start), own0), b = Math.min(map(sec.end), own1);
      if (b - a > 1e-3) parts.push({ ...sec, start: r3(a), end: r3(b), from: p.src });
    }
  });
  const sections = [];
  for (const sec of parts) {
    const last = sections[sections.length - 1];
    if (last && last.from === sec.from && last.label === sec.label && last.color === sec.color && last.notes === sec.notes
        && Math.abs(last.end - sec.start) < 2e-3) last.end = sec.end;
    else sections.push(sec);
  }
  for (const sec of sections) delete sec.from;
  marks.sort((a, b) => a.t - b.t);
  otherMarks.sort((a, b) => a.t - b.t);
  beats.sort((a, b) => a - b);
  bars.sort((a, b) => a - b);
  return { ...info, beats, bars, sections, ...(info.marks ? { marks } : {}), ...(otherMarks.length ? { otherMarks } : {}) };
}

// rendering ---------------------------------------------------------------------
// sources: { [src]: Float32Array[] } (one array per channel), all at `rate`.
export function render(pieces, sources, rate, { crossfade = 0, fadeIn = 0, fadeOut = 0 } = {}) {
  const { places, total } = arrange(pieces, crossfade);
  const channels = Math.max(1, ...pieces.map((p) => sources[p.src]?.length || 1));
  const n = Math.round(total * rate);
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  pieces.forEach((p, i) => {
    const src = sources[p.src];
    if (!src) return;
    const from = Math.round(p.start * rate);
    const at = Math.round(places[i].at * rate);
    const count = Math.min(Math.round(len(p) * rate), n - at);
    const xin = Math.round(places[i].xf * rate);
    const xout = i + 1 < pieces.length ? Math.round(places[i + 1].xf * rate) : 0;
    for (let c = 0; c < channels; c++) {
      const s = src[Math.min(c, src.length - 1)], o = out[c];
      for (let k = 0; k < count; k++) {
        // Equal-power curves keep the loudness steady through a crossfade.
        let g = 1;
        if (k < xin) g *= Math.sin(((k + 0.5) / xin) * Math.PI / 2);
        if (k >= count - xout) g *= Math.cos(((k - (count - xout) + 0.5) / xout) * Math.PI / 2);
        o[at + k] += (s[from + k] || 0) * g;
      }
    }
  });
  const fi = Math.min(Math.round(fadeIn * rate), n), fo = Math.min(Math.round(fadeOut * rate), n);
  for (const o of out) {
    for (let k = 0; k < fi; k++) o[k] *= k / fi;
    for (let k = 0; k < fo; k++) o[n - 1 - k] *= k / fo;
  }
  return out;
}

// 16-bit PCM WAV, which every Home Assistant speaker and browser plays.
export function encodeWav(channels, rate) {
  const n = channels[0]?.length || 0, ch = channels.length, bytes = n * ch * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + bytes, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++, o += 2) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return buf;
}

// The name for an edited copy: "song.mp3" -> "song (edit).wav", "song (edit).wav" -> "song (edit 2).wav".
export function editName(path, taken = []) {
  const base = (path.split("/").pop() || "song").replace(/\.[^.]+$/, "").replace(/ \(edit(?: \d+)?\)$/, "");
  const used = new Set(taken.map((p) => p.split("/").pop().toLowerCase()));
  for (let i = 1; ; i++) {
    const name = `${base} (edit${i > 1 ? ` ${i}` : ""}).wav`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

// drafts: an edit kept as which parts of which songs, so it can be opened and changed again ------
// A file name for name (a draft's), `name.wav`, or `name 2.wav` and so on when that's taken.
export function freshFileName(name, taken = []) {
  const used = new Set(taken.map((p) => p.split("/").pop().toLowerCase()));
  for (let i = 1; ; i++) {
    const file = `${name}${i > 1 ? ` ${i}` : ""}.wav`;
    if (!used.has(file.toLowerCase())) return file;
  }
}

// Whether pieces are the whole of one song, untouched (nothing edited yet).
export function untouched(pieces, key, length) {
  return pieces.length === 1 && pieces[0].src === key && pieces[0].start < 1e-3 && Math.abs(pieces[0].end - length) < 1e-3;
}

// editor ------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const keyOf = (ref) => `${ref.source}:${ref.path}`;
const nameOf = (ref) => ref.path.split("/").pop();
const query = (ref) => `source=${encodeURIComponent(ref.source)}&path=${encodeURIComponent(ref.path)}`;
const urlOf = (ref) => `api/audio/file?${query(ref)}`;
const infoUrl = (ref) => `api/audio/info?${query(ref)}`;

export class MusicEditor {
  // host provides: api(path, opts), status(msg, error), songs() -> [ref], songsChanged() -> Promise,
  // and optionally volume (volume.js) for the browser playback level.
  constructor(host) {
    this.host = host;
    this.canvas = $("music-wave");
    this.ctx = this.canvas.getContext("2d");
    this.refs = {}; // src key -> ref
    this.infos = {}; // src key -> its saved beats, sections and marks (for songs spliced in)
    this.sources = {}; // src key -> Float32Array[]
    this.pieces = [];
    this.history = [];
    this.future = [];
    this.time = 0;
    this.sel = null; // { start, end }
    this.view = { start: 0, span: 0 };
    this.playing = null;
    this.dirty = false;
    this.info = null; // the base song's saved beats and sections
    this.secSel = -1; // the section picked for editing
    this.markSel = -1; // the mark picked for editing
    this.joinSel = -1; // the join (index of the piece after it) whose ✂ was clicked
    this.layers = []; // samples or songs played over the song (layers.js), part of the draft
    this.eq = null; // the song's own bass, mid and treble (mixer.js), part of the draft
    this.eqCh = null; // whose EQ faders show in the Selection panel: "song", a layer's index or null
    this.chgSel = null; // the picked EQ change: { ch (-1 for the song, else a layer), i }
    this.clipSel = null; // the picked clip: { layer, clip }
    this.main = null; // the song alone, before the layers are mixed in (this.rendered has them)
    this.keeper = new DraftKeeper((...a) => this.host.api(...a), {
      onState: () => this.updateSaveState(),
      onError: (m, s, current) => this.host.status(current
        ? `Couldn't keep the draft: ${m}. It'll try again with your next change`
        : `Couldn't keep your last change to "${s.latest?.name || "a draft"}": ${m}. It'll try again with your next change`, true, "music-save"),
    });
    this.markBoxes = []; // where each mark's flag was drawn, for clicking: [{ i, x0, x1 }]
    this.cutOpts = null; // suggested cuts: { pieces, xf, options }, for the result they were found in
    this.cutShown = -1; // the suggestion drawn on the waveform
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "slider");
    this.canvas.setAttribute("aria-label", "Song waveform. Left and right arrows move the playhead a beat; hold Shift to select.");
    this.wire();
    this.updateControls();
    new ResizeObserver(() => this.layout()).observe(this.canvas.parentElement);
  }

  get active() { return !$("view-music").hidden; }
  get crossfade() { return Math.max(0, Number($("music-xf").value) || 0); }
  get total() { return arrange(this.pieces, this.crossfade).total; }

  // songs ---------------------------------------------------------------------
  fillSongLists() {
    const songs = this.host.songs();
    const sel = $("music-insert-src"), cur = sel.value;
    sel.replaceChildren(new Option("Another song…", ""));
    for (const r of songs) sel.append(new Option(r.path, JSON.stringify(r)));
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
  }

  // Everything played here goes through one gain node so the volume slider covers previews too.
  output() {
    if (!this.gainNode) {
      this.gainNode = this.audio.createGain();
      this.gainNode.connect(this.audio.destination);
    }
    this.gainNode.gain.value = this.host.volume?.gain ?? 1;
    return this.gainNode;
  }

  // A song's saved beats, sections and marks, fetched afresh (they may have changed since it was
  // first loaded), for when it's spliced into another song.
  loadInfo(ref) {
    const key = keyOf(ref);
    return this.host.api(infoUrl(ref)).then((info) => { this.infos[key] = info; this.updateControls?.(); this.draw?.(); return info; })
      .catch(() => this.infos[key] || null);
  }

  async source(ref) {
    const key = keyOf(ref);
    this.loadInfo(ref);
    if (this.sources[key]) return key;
    this.host.status(`Loading ${nameOf(ref)}…`);
    const buf = await fetchSong(urlOf(ref));
    this.audio ||= new AudioContext();
    const decoded = await this.audio.decodeAudioData(buf);
    this.sources[key] = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
    this.refs[key] = ref;
    this.host.status("", "info", "song");
    return key;
  }

  // asked: the caller already checked about unsaved edits.
  async open(ref, { asked = false } = {}) {
    if (!asked) {
      await this.flush();
      if (this.unsaved && !confirm("Your last change to the draft couldn't be kept (is HA-liday Show still running?). Open another song anyway?")) {
        this.fillSongLists();
        return;
      }
    }
    this.stop();
    try {
      const key = await this.source(ref);
      this.keeper.start(null);
      this.setFades(0, 0);
      this.pieces = [{ src: key, start: 0, end: this.sources[key][0].length / this.audio.sampleRate }];
      this.layers = [];
      this.eq = null;
      this.clipSel = this.chgSel = null;
      this.base = ref;
      this.host.opened?.(ref);
      this.info = null;
      this.history = [];
      this.future = [];
      this.dirty = false;
      this.time = 0;
      this.sel = null;
      $("music-name").value = editName(ref.path, this.host.songs().map((r) => r.path)).replace(/\.wav$/i, "");
      this.changed(true);
      const info = await this.host.api(infoUrl(ref)).catch(() => null);
      if (this.base === ref) { this.info = info; this.secSel = -1; this.tempoKnown(); }
    } catch (e) {
      this.host.status(songLoadMessage(e), true, "song");
    }
  }

  setFades(fadeIn, fadeOut, crossfade = null) {
    $("music-fadein").value = fadeIn;
    $("music-fadeout").value = fadeOut;
    if (crossfade !== null) $("music-xf").value = crossfade;
  }

  // Opens a draft where it was left: its pieces, crossfade and fades, on its base song.
  async openDraft(id) {
    this.stop();
    let d;
    try {
      d = await this.host.api(`api/drafts/${encodeURIComponent(id)}`);
      const songs = [d.base, ...d.pieces.map((p) => p.song)];
      for (const ref of songs.filter((r, i) => songs.findIndex((x) => keyOf(x) === keyOf(r)) === i)) {
        try {
          await this.source(ref);
        } catch (e) {
          this.host.status(`"${d.name}" uses ${nameOf(ref)}, which couldn't be loaded (${songLoadMessage(e)}). Is it still in your songs?`, true, "song");
          return false;
        }
      }
    } catch (e) {
      this.host.status(`Couldn't open the draft: ${e.message}`, true, "song");
      return false;
    }
    // A layer's sample or song that's gone (deleted, say) doesn't stop the draft opening: its clips
    // stay, greyed out and silent, until it's back or they're deleted.
    const missing = [];
    for (const ref of new Map((d.layers || []).flatMap((l) => l.clips.map((c) => [keyOf(c.song), c.song]))).values()) {
      try { await this.source(ref); } catch { missing.push(nameOf(ref).replace(/\.[^.]+$/, "")); }
    }
    if (missing.length) {
      this.host.status(`"${d.name}" has layer clips of ${missing.join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} in your samples or songs any more. They're greyed out and silent`, "hint");
    }
    const base = d.base, baseKey = keyOf(base);
    this.base = this.refs[baseKey];
    this.pieces = d.pieces.map((p) => ({ src: keyOf(p.song), start: p.start, end: p.end }));
    this.layers = d.layers || [];
    this.eq = d.eq || null;
    this.clipSel = this.chgSel = null;
    this.keeper.start({ id, made: d.made || null });
    this.setFades(d.fadeIn || 0, d.fadeOut || 0, d.crossfade ?? 0.05);
    $("music-name").value = d.name;
    this.host.opened?.(this.base);
    this.info = null;
    this.history = [];
    this.future = [];
    this.time = 0;
    this.sel = null;
    this.secSel = this.markSel = this.joinSel = -1;
    const length = this.sources[baseKey][0].length / this.audio.sampleRate;
    this.dirty = !untouched(this.pieces, baseKey, length) || !!(d.fadeIn || d.fadeOut);
    this.changed(true);
    const ref = this.base;
    const info = await this.host.api(infoUrl(ref)).catch(() => null);
    if (this.base === ref) { this.info = info; this.tempoKnown(); }
    if (!missing.length) this.host.status(`Opened the draft "${d.name}"`);
    return true;
  }

  // The draft being worked on, {id, made}, or null before the first change.
  get draft() { return this.keeper.current; }

  // A change to the draft that couldn't be kept (it's tried again with the next change).
  get unsaved() { return this.keeper.failed; }

  draftBody() {
    const name = $("music-name").value.trim().replace(/\.wav$/i, "") || nameOf(this.base).replace(/\.[^.]+$/, "");
    return {
      name, base: this.base,
      pieces: this.pieces.map((p) => ({ song: this.refs[p.src], start: p.start, end: p.end })),
      crossfade: this.crossfade,
      fadeIn: Number($("music-fadein").value) || 0,
      fadeOut: Number($("music-fadeout").value) || 0,
      length: Math.round(this.total * 100) / 100,
      ...(this.layers.length ? { layers: this.layers } : {}),
      ...(this.eq && (!isFlat(this.eq) || this.eq.changes?.length) ? { eq: this.eq } : {}),
    };
  }

  // Keeps the draft shortly after a change; the first change to a song starts one.
  draftChanged() {
    if (this.base && this.pieces.length) this.keeper.changed(this.draftBody());
  }

  // Sends a change still waiting, now; resolves when it's kept (or couldn't be).
  flush(opts) { return this.keeper.flush(opts); }

  // The open draft was deleted (from Your songs): the next change starts a new one.
  forgetDraft() { this.keeper.forget(); }

  updateSaveState() {
    const k = this.keeper, made = k.current?.made;
    $("music-save-state").textContent = !this.pieces.length ? ""
      : k.failed ? "Draft not kept yet"
        : k.pending ? "Keeping the draft…"
          : k.current ? (made ? `Draft kept · made ${nameOf(made)}` : "Draft kept") : "";
  }

  // Finds the beats, bars and sections of the base song and saves them with the file.
  async detect() {
    if (!this.base) return;
    if (this.dirty) return this.host.status("Make the song file first; it's detected when it's made", "hint");
    const ref = this.base, channels = this.sources[keyOf(ref)];
    const { samples, rate } = toMono(channels, this.audio.sampleRate);
    this.host.status(`Listening to ${nameOf(ref)}…`);
    $("music-detect").disabled = true;
    try {
      const r = await analyseInWorker(samples, rate);
      // Names and notes you wrote on the old sections carry over to the new ones.
      const old = this.base === ref ? this.info?.sections : null;
      const sections = describeSections(keepYours(r.sections, old || []), r.traits);
      const marks = this.base === ref ? this.info?.marks : null; // the server keeps them too
      const info = { tempo: r.tempo || null, beats: r.beats, bars: r.bars, sections, ...(marks ? { marks } : {}) };
      await this.host.api(infoUrl(ref), { method: "PUT", json: info });
      if (this.base === ref) { this.info = info; this.secSel = -1; this.tempoKnown(); }
      const parts = `${info.sections.length} section${info.sections.length === 1 ? "" : "s"}`;
      this.host.status((info.tempo ? `Found ${info.beats.length} beats at ${info.tempo} BPM, and ${parts}` : `No steady beat found; found ${parts}`)
        + (this.host.hasAI?.() && this.base === ref ? ". The AI is writing notes for them; carry on meanwhile" : ""));
      if (this.base === ref) this.askAI(ref, info.sections, r.traits, info.tempo, { quiet: true });
    } catch (e) {
      this.host.status(`Couldn't analyse the song: ${e.message}`, true);
    }
    this.updateControls();
    this.draw();
  }

  // Writes notes for the base song's sections from what each sounds like, keeping any notes and
  // names you wrote.
  async describe() {
    if (!this.base || this.dirty || !this.info?.sections?.length) return;
    const ref = this.base, channels = this.sources[keyOf(ref)];
    const { samples, rate } = toMono(channels, this.audio.sampleRate);
    const sections = this.info.sections;
    this.host.status(`Listening to each part of ${nameOf(ref)}…`);
    $("music-describe").disabled = true;
    try {
      const traits = await analyseInWorker(samples, rate, sections.map(({ start, end }) => ({ start, end })));
      if (this.base !== ref || this.info?.sections !== sections) {
        this.host.status("The sections changed while listening; press Describe sections again", "hint");
        return;
      }
      const out = describeSections(sections, traits);
      const written = out.filter((s, i) => s !== sections[i]).length;
      if (!written) return this.host.status("Every section already has notes you wrote, so nothing was changed", "hint");
      // With an AI, its notes replace the ones there; until then (or if it fails) they stay, and
      // only sections with no notes at all get the simple ones meanwhile.
      if (this.host.hasAI?.()) {
        const blanks = describeSections(sections, traits, { write: (t, sec, all) => (sec.notes ? sec.notes : undefined) || ruleNote(t, sec, all) });
        if (blanks.some((s, i) => s.notes !== sections[i].notes)) this.editSections(blanks);
        this.askAI(ref, this.info.sections, traits, this.info.tempo);
      } else {
        this.editSections(out);
        this.host.status(`Wrote notes for ${written} section${written === 1 ? "" : "s"}; edit any you like`);
      }
    } catch (e) {
      this.host.status(`Couldn't describe the sections: ${e.message}`, true);
    } finally {
      this.updateControls();
    }
  }

  // Has the AI rewrite the notes (and automatic names) just written, and puts them in if the
  // sections haven't been edited meanwhile. The rule-written ones stay if there's no AI.
  async askAI(ref, sections, traits, tempo, { quiet = false } = {}) {
    if (!this.host.hasAI?.() || this.base !== ref) return;
    const ask = (this.aiAsk = (this.aiAsk || 0) + 1); // only the latest request reports back
    if (!quiet) this.host.status(`Asking the AI to describe each part of ${nameOf(ref)}… (usually under a minute; carry on meanwhile)`);
    const duration = sections[sections.length - 1]?.end || 0;
    const got = await this.host.aiSectionNotes(sections, traits, { name: nameOf(ref).replace(/\.[^.]+$/, ""), duration, tempo });
    if (ask !== this.aiAsk || this.base !== ref || !got?.used) return;
    const typing = ["music-sec-notes", "music-sec-name"].includes(document.activeElement?.id);
    if (this.info?.sections === sections && !typing) {
      this.editSections(got.sections);
      this.host.status("The AI wrote the section notes; edit any you like");
    } else this.host.status("You changed the sections while the AI was writing, so its notes weren't used. Press Describe sections to ask again", "hint");
  }

  // Reloads a song's saved sections if it's the one open (after something else saved them).
  async reloadInfo(ref) {
    if (this.base !== ref || this.dirty || Date.now() - (this.editedAt || 0) < 2000) return; // an edit still saving
    const info = await this.host.api(infoUrl(ref)).catch(() => null);
    if (info && this.base === ref) { this.info = info; this.updateControls(); this.draw(); }
  }

  async upload(file) {
    this.host.status(`Uploading ${file.name}…`);
    try {
      const ref = await uploadSong(this.host.api, file);
      await this.host.songsChanged();
      this.fillSongLists();
      return ref;
    } catch (e) {
      this.host.status(`Upload failed: ${e.message}`, true);
      return null;
    }
  }

  // editing -------------------------------------------------------------------
  edit(pieces, fit = false) {
    this.stop();
    const mark = this.pickedMark();
    this.history.push(this.snapshot());
    this.future = [];
    this.pieces = pieces;
    this.dirty = true;
    this.markSel = this.shownMark(mark);
    this.joinSel = -1;
    this.changed(fit);
    this.draftChanged();
  }

  undo(dir = -1) {
    const [from, to] = dir < 0 ? [this.history, this.future] : [this.future, this.history];
    if (!from.length) return;
    this.stop();
    const mark = this.pickedMark();
    to.push(this.snapshot());
    const back = from.pop();
    if (back.pieces !== this.pieces) this.dirty = true; // a layers-only step leaves the song as it was
    this.pieces = back.pieces;
    this.layers = back.layers;
    this.eq = back.eq;
    this.clipSel = this.chgSel = null;
    this.keepOpenRows();
    this.markSel = this.shownMark(mark);
    this.joinSel = -1;
    this.changed();
    this.draftChanged();
  }

  // What Undo goes back to: the song's pieces, the layers and the song's EQ.
  snapshot() { return { pieces: this.pieces, layers: this.layers, eq: this.eq }; }

  // layers ----------------------------------------------------------------------
  // A change to the layers (one Undo step); the song itself isn't changed.
  editLayers(layers, pick = this.clipSel) {
    this.stop();
    this.history.push(this.snapshot());
    this.future = [];
    this.layers = layers;
    this.clipSel = pick;
    if (pick) this.chgSel = null;
    this.keepOpenRows();
    this.changed();
    this.draftChanged();
  }

  addLayer() {
    if (this.layers.length >= MAX_LAYERS) return;
    const n = this.layers.length + 1;
    this.editLayers([...this.layers, { name: `Layer ${n}`, gain: 0, clips: [] }], null);
    this.host.status(`Added Layer ${n}. Pick a sample or song under it to put a clip at the playhead`, "hint");
  }

  removeLayer(i) {
    const n = this.layers[i].clips.length;
    if (n && !confirm(`Remove "${this.layers[i].name}" and its ${n} clip${n === 1 ? "" : "s"}? Ctrl+Z brings it back.`)) return;
    // The open EQ and a picked change stay with their layers as the ones after it move up.
    if (this.eqCh === i) this.eqCh = null;
    else if (typeof this.eqCh === "number" && this.eqCh > i) this.eqCh--;
    this.chgSel = null;
    this.editLayers(this.layers.filter((_, k) => k !== i), null);
  }

  // Forgets the open EQ and a picked change for layers that aren't there (after Undo, say).
  keepOpenRows() {
    if (typeof this.eqCh === "number" && this.eqCh >= this.layers.length) this.eqCh = null;
    if (this.chgSel && !this.channelEq(this.chgSel.ch)?.changes?.[this.chgSel.i]) this.chgSel = null;
  }

  setLayer(i, change) {
    this.editLayers(this.layers.map((l, k) => (k === i ? { ...l, ...change } : l)));
  }

  setClip(change) {
    const sel = this.clipSel;
    if (!sel) return;
    this.editLayers(this.layers.map((l, k) => (k !== sel.layer ? l
      : { ...l, clips: l.clips.map((c, j) => (j === sel.clip ? { ...c, ...change } : c)) })));
  }

  deleteClip() {
    const sel = this.clipSel;
    if (!sel) return;
    this.editLayers(this.layers.map((l, k) => (k !== sel.layer ? l : { ...l, clips: l.clips.filter((_, j) => j !== sel.clip) })), null);
  }

  // The song's tempo (once detected), which layers can match.
  get songTempo() { return this.info?.tempo || null; }

  // Every heard clip's place in the result (layers.js placeClips), at the song's tempo.
  placed() { return placeClips(this.layers, this.pieces, this.crossfade, this.songTempo); }

  // The song's tempo has arrived or changed: layers matching it are placed again.
  tempoKnown() {
    if (this.layers.some((l) => l.matchTempo)) this.changed();
    else { this.updateControls(); this.draw(); }
  }

  // A sample's or song's own tempo: from its detected beats, else (if it's long enough to have a few)
  // by listening to it. null if there's no steady beat.
  async tempoOf(ref) {
    const key = keyOf(ref), info = await this.loadInfo(ref);
    if (info?.tempo) return Math.round(info.tempo * 10) / 10;
    const audio = this.sources[key], rate = this.audio.sampleRate;
    if (!audio || audio[0].length < rate * 3) return null;
    try {
      const mono = toMono(audio, rate), r = await analyseInWorker(mono.samples, mono.rate);
      return r.tempo ? Math.round(r.tempo * 10) / 10 : null;
    } catch { return null; }
  }

  // Match the song's tempo on a layer, finding the tempo of any clip that doesn't have one yet.
  async setMatchTempo(i, on) {
    const asked = this.layers[i];
    let layer = asked;
    if (on) {
      const missing = layer.clips.filter((c) => !c.bpm && this.sources[keyOf(c.song)]);
      if (missing.length) this.host.status("Finding the clips' tempos…");
      const found = {};
      for (const c of missing) found[keyOf(c.song)] ??= await this.tempoOf(c.song);
      // The layer may have changed, moved or gone meanwhile: it's found again by name.
      i = this.layers.indexOf(asked) >= 0 ? this.layers.indexOf(asked) : this.layers.findIndex((l) => l.name === asked.name);
      layer = this.layers[i];
      if (!layer) return;
      const clips = layer.clips.map((c) => (c.bpm || !found[keyOf(c.song)] ? c : { ...c, bpm: found[keyOf(c.song)] }));
      const unknown = [...new Set(clips.filter((c) => !c.bpm).map((c) => nameOf(c.song).replace(/\.[^.]+$/, "")))];
      this.setLayer(i, { matchTempo: true, clips });
      this.host.status(unknown.length
        ? `Couldn't find a steady beat in ${unknown.join(", ")}: click its clip and type its tempo`
        : `${layer.name} now plays at the song's ${this.songTempo} BPM`, unknown.length ? "hint" : "info");
    } else this.setLayer(i, { matchTempo: false });
  }

  // EQ -----------------------------------------------------------------------------
  // A channel's EQ: -1 is the song, else a layer.
  channelEq(ch) { return (ch < 0 ? this.eq : this.layers[ch]?.eq) || null; }

  // A change to a channel's EQ (one Undo step).
  editEq(ch, eq, pick = this.chgSel) {
    this.stop();
    this.history.push(this.snapshot());
    this.future = [];
    if (ch < 0) this.eq = eq;
    else this.layers = this.layers.map((l, k) => (k === ch ? { ...l, eq } : l));
    this.chgSel = pick;
    if (pick) this.clipSel = null;
    this.changed();
    this.draftChanged();
  }

  // Moves a fader: it changes the setting in force at the playhead (the channel's own, or the change
  // the playhead is past).
  setBand(ch, band, value) {
    const eq = this.channelEq(ch) || flatEq();
    const now = eqAt(eq, placeChanges(eq, this.pieces, this.crossfade), this.time).change;
    this.editEq(ch, now < 0 ? { ...eq, [band]: value }
      : { ...eq, changes: eq.changes.map((c, k) => (k === now ? { ...c, [band]: value } : c)) });
  }

  // Adds a change at the playhead, starting at the setting already in force there.
  addChange(ch) {
    const eq = this.channelEq(ch) || flatEq(), placed = placeChanges(eq, this.pieces, this.crossfade);
    const at = this.time < this.total - 0.01 && anchorAt(this.pieces, this.crossfade, this.time, this.refs);
    if (!at) return this.host.status("Move the playhead into the song first (not right at its end)", "hint");
    if ((eq.changes || []).length >= MAX_CHANGES) return this.host.status(`Up to ${MAX_CHANGES} changes each`, "hint");
    if (placed.some((c) => Math.abs(c.at - this.time) < 0.05)) return this.host.status("There's already a change here: move its faders", "hint");
    const { bass, mid, treble } = eqAt(eq, placed, this.time);
    const changes = [...(eq.changes || []), { anchor: at, bass, mid, treble, glide: 1 }];
    this.editEq(ch, { ...eq, changes }, { ch, i: changes.length - 1 });
    this.host.status(`Added a change at ${fmtTime(this.time)}. Move the faders to set what it glides to`, "hint");
  }

  setChange(ch, i, change) {
    const eq = this.channelEq(ch);
    if (eq?.changes?.[i]) this.editEq(ch, { ...eq, changes: eq.changes.map((c, k) => (k === i ? { ...c, ...change } : c)) });
  }

  deleteChange(ch, i) {
    const eq = this.channelEq(ch);
    if (eq?.changes?.[i]) this.editEq(ch, { ...eq, changes: eq.changes.filter((_, k) => k !== i) }, null);
  }

  // Each channel's changes that are in the song: [{ch, at, i}].
  allChanges() {
    const out = [];
    for (let ch = -1; ch < this.layers.length; ch++) {
      for (const c of placeChanges(this.channelEq(ch), this.pieces, this.crossfade)) out.push({ ch, at: c.at, i: c.i });
    }
    return out;
  }

  // Where a channel's change diamonds sit: the bottom of the waveform for the song, else its lane.
  changeY(ch) { return ch < 0 ? WAVE_B - 7 : WAVE_B + ch * LANE_H + LANE_H - 7; }

  // The change diamond under (x, y), or null.
  changeAt(x, y) {
    return this.allChanges().find((c) => Math.abs(this.x(c.at) - x) <= 6 && Math.abs(this.changeY(c.ch) - y) <= 7) || null;
  }

  // Splits a clip in two at the playhead: the picked clip, or the only one under the playhead. The two
  // halves play on as one, and can then be moved, trimmed or deleted on their own.
  splitClip() {
    const placed = this.placed(), inside = (p) => this.time > p.at + 0.05 && this.time < p.at + p.length - 0.05;
    const sel = this.clipSel, under = placed.filter(inside);
    const p = sel ? placed.find((q) => q.layer === sel.layer && q.clip === sel.clip) : under.length === 1 ? under[0] : null;
    if (!p) return this.host.status(under.length ? "Click the clip to split first" : "Put the playhead inside a clip, then split it", "hint");
    if (!inside(p)) return this.host.status("Move the playhead inside the clip, away from its ends", "hint");
    if (this.layers[p.layer].clips.length >= MAX_CLIPS) return this.host.status(`A layer can have up to ${MAX_CLIPS} clips`, "hint");
    const anchor = anchorAt(this.pieces, this.crossfade, this.time, this.refs);
    if (!anchor) return;
    const c = this.layers[p.layer].clips[p.clip], at = Math.round((c.start + (this.time - p.at) * p.speed) * 1000) / 1000;
    const first = { ...c, end: at, fadeOut: 0 }, second = { ...c, start: at, anchor, fadeIn: 0 };
    this.editLayers(this.layers.map((l, k) => (k !== p.layer ? l
      : { ...l, clips: [...l.clips.slice(0, p.clip), first, second, ...l.clips.slice(p.clip + 1)] })), { layer: p.layer, clip: p.clip + 1 });
    this.host.status("Split it in two: move, trim or delete either part");
  }

  // Puts a sample or song on a layer at the playhead, as long as it is (trim it after) but no further
  // than the song's end, at a level a little under the song's.
  async addClip(i, ref) {
    if (this.layers[i].clips.length >= MAX_CLIPS) return this.host.status(`A layer can have up to ${MAX_CLIPS} clips; use another layer`, "hint");
    const at = this.time < this.total - 0.01 && anchorAt(this.pieces, this.crossfade, this.time, this.refs);
    if (!at) return this.host.status("Move the playhead into the song first (not right at its end)", "hint");
    let key;
    const layer = this.layers[i];
    try { key = await this.source(ref); } catch (e) { return this.host.status(songLoadMessage(e), true); }
    const rate = this.audio.sampleRate, audio = this.sources[key];
    const whole = audio[0].length / rate;
    this.songLufs ??= loudness(this.main, rate);
    const gain = matchGain(this.songLufs, loudness(audio, rate));
    // Its own tempo, for matching the song's: from its detected beats, or found now on a layer that
    // matches (it can be typed in later too).
    const bpm = layer.matchTempo ? await this.tempoOf(ref) : Math.round((this.infos[key]?.tempo || 0) * 10) / 10 || null;
    i = this.layers.indexOf(layer); // the layer may have moved, or gone, while it loaded
    if (i < 0) return;
    // Anything past the song's end wouldn't be heard, and its end couldn't be reached to trim it.
    const speed = clipSpeed(this.layers[i], { bpm }, this.songTempo), room = (this.total - this.time) * speed;
    const end = Math.round(Math.min(whole, room) * 1000) / 1000;
    const clip = { song: ref, start: 0, end, anchor: at, gain, fadeIn: 0, fadeOut: 0, ...(bpm ? { bpm } : {}) };
    const layers = this.layers.map((l, k) => (k === i ? { ...l, clips: [...l.clips, clip] } : l));
    this.editLayers(layers, { layer: i, clip: layers[i].clips.length - 1 });
    this.host.status(`Added ${nameOf(ref).replace(/\.[^.]+$/, "")} at ${fmtTime(this.time)}${end < whole - 0.01 ? ", trimmed to the song's end" : ""}. Drag it to move it, or its ends to trim it`);
  }

  // The lane (layer index) at canvas y, or -1.
  laneAt(y) {
    const i = Math.floor((y - WAVE_B) / LANE_H);
    return y >= WAVE_B && i < this.layers.length ? i : -1;
  }

  // The clip under (x, y) and which part: { layer, clip, at, length, part: "start" | "end" | "body" }.
  // A clip running past the song's end has its end grip at the song's end (the rest isn't heard).
  clipAt(x, y) {
    const lane = this.laneAt(y);
    if (lane < 0) return null;
    const hit = this.placed().filter((p) => p.layer === lane).map((p) => ({ ...p, length: Math.min(p.length, this.total - p.at) }))
      .find((p) => x >= this.x(p.at) - 4 && x <= this.x(p.at + p.length) + 4);
    if (!hit) return null;
    const x0 = this.x(hit.at), x1 = this.x(hit.at + hit.length);
    return { ...hit, part: x - x0 < 6 ? "start" : x1 - x < 6 ? "end" : "body" };
  }

  renderLayers() {
    const box = $("music-layers");
    const samples = this.samplesList || [], songs = this.host.songs();
    const sig = JSON.stringify([this.layers.map((l) => [l.name, l.gain, !!l.duck, !!l.matchTempo, isFlat(l.eq), l.clips.length]), isFlat(this.eq),
      this.eqCh, !!this.songTempo, samples.length, JSON.stringify(this.sampleFolders || []), songs.length, !!this.pieces.length]);
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
      const eqButton = (ch, id, name) => {
        const b = el("button", { type: "button", className: `ghost${isFlat(this.channelEq(ch)) ? "" : " on"}`, textContent: "EQ" });
        b.title = `Bass, mid and treble for ${name}, like a DJ mixer`;
        b.setAttribute("aria-expanded", String(this.eqCh === id));
        b.setAttribute("aria-controls", "music-eq");
        b.setAttribute("aria-label", `${name} EQ`);
        b.classList.toggle("open", this.eqCh === id);
        b.addEventListener("click", () => { this.eqCh = this.eqCh === id ? null : id; this.renderLayers(); });
        return b;
      };
      // A channel's faders, in the Selection panel: they show and set what's in force at the playhead.
      const eqRow = (ch, name) => {
        const row = el("div", { className: "group layer-row eq-row" });
        row.dataset.ch = ch;
        for (const band of BANDS) {
          const label = band[0].toUpperCase() + band.slice(1);
          const f = el("input", { type: "range", min: EQ_MIN, max: EQ_MAX, step: 1, value: 0 });
          f.dataset.band = band;
          f.setAttribute("aria-label", `${name} ${band}`);
          const v = el("span", { className: "hint eq-value" });
          v.dataset.band = band;
          f.addEventListener("input", () => { v.textContent = faderText(Number(f.value)); });
          f.addEventListener("change", () => this.setBand(ch, band, Number(f.value)));
          row.append(el("label", {}, `${label} `, f, " ", v));
        }
        const add = el("button", { type: "button", textContent: "+ Change here" });
        add.title = "From the playhead on, glide to new settings: add a change here, then move the faders";
        add.addEventListener("click", () => this.addChange(ch));
        const where = el("span", { className: "hint eq-where" });
        const glide = el("input", { type: "number", min: 0, max: 30, step: 0.1, className: "eq-glide" });
        glide.setAttribute("aria-label", `${name} glide`);
        glide.addEventListener("change", () => {
          const i = Number(row.dataset.change);
          if (i >= 0) this.setChange(ch, i, { glide: Math.max(0, Math.min(30, Number(glide.value) || 0)) });
        });
        const glideLabel = el("label", { className: "eq-glide-label", title: "How long it takes to glide to this change's settings" }, "Glide ", glide, " s");
        const del = el("button", { type: "button", className: "ghost danger eq-delete", textContent: "Delete change" });
        del.addEventListener("click", () => { const i = Number(row.dataset.change); if (i >= 0) this.deleteChange(ch, i); });
        row.append(add, where, glideLabel, del);
        return row;
      };
      const songRow = el("div", { className: "group layer-row" }, el("span", { className: "layer-dot song-dot" }), el("span", { className: "layer-name", textContent: "Song" }),
        eqButton(-1, "song", "the song"));
      const rows = [songRow];
      this.layers.forEach((l, i) => {
        const name = el("input", { value: l.name, maxLength: 40, size: 14, title: "The layer's name" });
        name.setAttribute("aria-label", `Layer ${i + 1} name`);
        name.addEventListener("change", () => this.setLayer(i, { name: name.value.trim().slice(0, 40) || `Layer ${i + 1}` }));
        const vol = el("input", { type: "range", min: -24, max: 12, step: 1, value: l.gain });
        vol.setAttribute("aria-label", `${l.name} volume`);
        const db = el("span", { className: "hint", textContent: `${l.gain > 0 ? "+" : ""}${l.gain} dB` });
        vol.addEventListener("input", () => { db.textContent = `${vol.value > 0 ? "+" : ""}${vol.value} dB`; });
        vol.addEventListener("change", () => this.setLayer(i, { gain: Number(vol.value) }));
        const duck = el("input", { type: "checkbox", checked: !!l.duck });
        duck.addEventListener("change", () => this.setLayer(i, { duck: duck.checked }));
        const duckLabel = el("label", { title: "Turn the song down a little while this layer's clips play, so they're clearer: good for a voice" }, duck, " Quieten the song");
        const tempo = el("input", { type: "checkbox", checked: !!l.matchTempo, disabled: !this.songTempo && !l.matchTempo });
        tempo.addEventListener("change", () => this.setMatchTempo(i, tempo.checked));
        const tempoLabel = el("label", { title: this.songTempo
          ? `Speed this layer's clips up or slow them down to the song's ${this.songTempo} BPM, keeping their pitch`
          : "Detect the song first, so it has a tempo to match" }, tempo, " Match tempo");
        const add = el("select", { title: "Put a sample or song on this layer at the playhead" });
        add.setAttribute("aria-label", `Add to ${l.name}`);
        add.append(new Option("+ Add a clip at the playhead…", ""));
        const group = (label, refs) => {
          if (!refs.length) return;
          const g = el("optgroup", { label });
          for (const r of refs) g.append(new Option(r.path.split("/").pop().replace(/\.[^.]+$/, ""), JSON.stringify({ source: r.source, path: r.path })));
          add.append(g);
        };
        // Samples by their folders (Library → Samples), then those in none.
        const { groups, loose } = itemsInFolders(samples, this.sampleFolders || []);
        for (const g of groups) group(`Samples · ${g.folder.name}`, g.items);
        group(groups.length ? "Samples · not in a folder" : "Samples", loose);
        group("Songs", songs);
        add.addEventListener("change", () => { const v = add.value; add.value = ""; if (v) this.addClip(i, JSON.parse(v)); });
        const remove = el("button", { type: "button", className: "ghost", textContent: "Remove" });
        remove.title = "Remove this layer and its clips";
        remove.addEventListener("click", () => this.removeLayer(i));
        const dot = el("span", { className: "layer-dot" });
        dot.style.background = `hsl(${LAYER_HUES[i % 4]} 65% 50%)`;
        rows.push(el("div", { className: "group layer-row" }, dot, name, el("label", {}, "Volume ", vol, " ", db), eqButton(i, i, l.name), duckLabel, tempoLabel, add, remove));
      });
      const addLayer = el("button", { type: "button", textContent: "+ Add layer", disabled: !this.pieces.length || this.layers.length >= MAX_LAYERS });
      addLayer.title = this.layers.length >= MAX_LAYERS ? `Up to ${MAX_LAYERS} layers` : "Add a row for samples or songs to play over the song";
      addLayer.addEventListener("click", () => this.addLayer());
      box.replaceChildren(el("div", { className: "group" }, el("span", { className: "section-label", textContent: "Mixer" }), addLayer,
        el("span", { className: "hint", textContent: this.layers.length ? "" : "Layers play sleigh bells, a \"ho ho ho\" or another song over this one." })), ...rows);
      // The EQ that's open, in the Selection panel.
      const eqBox = $("music-eq"), id = this.eqCh, ch = id === "song" ? -1 : id;
      eqBox.hidden = id == null;
      if (id == null) eqBox.replaceChildren();
      else {
        const name = ch < 0 ? "Song" : this.layers[ch].name;
        const close = el("button", { type: "button", className: "ghost", textContent: "✕", title: "Done" });
        close.setAttribute("aria-label", "Close the EQ");
        close.addEventListener("click", () => { this.eqCh = null; this.renderLayers(); });
        eqBox.replaceChildren(el("span", { className: "hint", textContent: `EQ for ${ch < 0 ? "the song" : name}` }), close, eqRow(ch, name));
      }
    }
    this.refreshEq();
    // The picked clip's panel.
    const sel = this.clipSel, c = sel && this.layers[sel.layer]?.clips[sel.clip];
    $("music-clip").hidden = !c;
    if (!c) return;
    const at = this.placed().find((p) => p.layer === sel.layer && p.clip === sel.clip);
    $("music-clip-what").textContent = `${nameOf(c.song).replace(/\.[^.]+$/, "")} on ${this.layers[sel.layer].name}`
      + (at ? `, at ${fmtTime(at.at)} for ${at.length.toFixed(2)} s` : " (on a part that's cut out)")
      + (at && at.speed !== 1 ? `, ${at.speed > 1 ? "sped up" : "slowed down"} ${(Math.abs(at.speed - 1) * 100).toFixed(1)}% to match the song` : "")
      + (this.sources[keyOf(c.song)] ? "" : ". It's not in your samples or songs any more, so it's silent: delete it, or add it back to Library → Samples");
    for (const [id, v] of [["music-clip-fadein", c.fadeIn], ["music-clip-fadeout", c.fadeOut], ["music-clip-gain", c.gain], ["music-clip-bpm", c.bpm ?? ""]]) {
      if (document.activeElement !== $(id)) $(id).value = v;
    }
  }

  // The open EQ's faders, showing the setting in force at the playhead (and the change it's from).
  refreshEq() {
    for (const row of $("music-eq").querySelectorAll(".eq-row")) {
      const ch = Number(row.dataset.ch), eq = this.channelEq(ch) || flatEq();
      const placed = placeChanges(eq, this.pieces, this.crossfade), now = eqAt(eq, placed, this.time);
      for (const f of row.querySelectorAll("input[type=range]")) {
        if (document.activeElement !== f) f.value = now[f.dataset.band];
        row.querySelector(`.eq-value[data-band="${f.dataset.band}"]`).textContent = faderText(Number(f.value));
      }
      row.dataset.change = now.change;
      const c = now.change >= 0 ? placed.find((p) => p.i === now.change) : null;
      row.querySelector(".eq-where").textContent = c ? `From the change at ${fmtTime(c.at)}` : placed.length ? "From the start" : "";
      row.querySelector(".eq-glide-label").hidden = row.querySelector(".eq-delete").hidden = !c;
      const glide = row.querySelector(".eq-glide");
      if (c && document.activeElement !== glide) glide.value = c.glide;
    }
  }

  wireLayers() {
    $("music-clip-fadein").addEventListener("change", (e) => this.setClip({ fadeIn: Math.max(0, Math.min(30, Number(e.target.value) || 0)) }));
    $("music-clip-fadeout").addEventListener("change", (e) => this.setClip({ fadeOut: Math.max(0, Math.min(30, Number(e.target.value) || 0)) }));
    $("music-clip-gain").addEventListener("change", (e) => this.setClip({ gain: Math.max(-24, Math.min(12, Number(e.target.value) || 0)) }));
    $("music-clip-bpm").addEventListener("change", (e) => {
      const v = Number(e.target.value);
      this.setClip({ bpm: v >= 20 && v <= 400 ? Math.round(v * 10) / 10 : undefined });
    });
    $("music-clip-play").addEventListener("click", () => {
      const sel = this.clipSel;
      const at = sel && this.placed().find((p) => p.layer === sel.layer && p.clip === sel.clip);
      if (at) { this.time = Math.max(0, at.at - 1); this.play(this.time, Math.min(this.total, at.at + at.length + 1)); }
    });
    $("music-clip-delete").addEventListener("click", () => this.deleteClip());
    $("music-clip-split").addEventListener("click", () => this.splitClip());
    $("music-clip-close").addEventListener("click", () => { this.clipSel = null; this.updateControls(); this.draw(); });
  }

  // Samples for the layers' Add lists (Library → Samples), read when the editor shows.
  async loadSamples() {
    [this.samplesList, this.sampleFolders] = await Promise.all([
      this.host.api("api/samples").catch(() => this.samplesList || []),
      this.host.api("api/sample-folders").catch(() => this.sampleFolders || [])]);
    this.renderLayers();
  }

  cutSelection() {
    if (!this.sel) return this.host.status("Drag across the waveform to select the part to cut", "hint");
    const { start, end } = this.sel;
    this.sel = null;
    this.time = start;
    this.edit(cut(this.pieces, this.crossfade, start, end));
  }

  keepSelection() {
    if (!this.sel) return this.host.status("Drag across the waveform to select the part to keep", "hint");
    const { start, end } = this.sel;
    this.sel = null;
    this.time = 0;
    this.edit(keep(this.pieces, this.crossfade, start, end), true);
  }

  async addSong(atEnd) {
    const v = $("music-insert-src").value;
    if (!v) return this.host.status("Choose the song to add first", "hint");
    try {
      const key = await this.source(JSON.parse(v));
      const piece = { src: key, start: 0, end: this.sources[key][0].length / this.audio.sampleRate };
      const at = atEnd ? this.total : this.time;
      const xf = this.crossfade;
      this.sel = null;
      this.edit(insert(this.pieces, xf, at, [piece]), true);
      // Select what was added so it can be trimmed straight away.
      const i = this.pieces.findIndex((p) => p.src === key && p.start === 0 && p.end === piece.end);
      const { places } = arrange(this.pieces, xf);
      if (i >= 0) this.sel = { start: places[i].at, end: places[i].at + piece.end };
      this.changed();
    } catch (e) {
      this.host.status(`Couldn't add the song: ${e.message}`, true);
    }
  }

  // section editing -----------------------------------------------------------
  get sections() { return (!this.dirty && this.info?.sections) || null; }

  // The base song's beats, bars and sections where they fall in the result, following any edits.
  get shown() {
    if (!this.base) return null;
    if (!this.dirty) return this.info;
    const baseKey = keyOf(this.base), others = this.otherInfos();
    if (!this.info && !Object.keys(others).length) return null;
    return mapInfo(this.info || { beats: [], bars: [], sections: [] }, this.pieces, this.crossfade, baseKey, others);
  }

  // The saved info of each other song spliced into this one, by key.
  otherInfos() {
    const baseKey = this.base && keyOf(this.base), out = {};
    for (const p of this.pieces) if (p.src !== baseKey && this.infos[p.src]) out[p.src] = this.infos[p.src];
    return out;
  }

  // t pulled to the nearest bar or section edge within reach, else the nearest beat; Shift places freely.
  // reach: how far (px) a bar or section edge pulls; trimming a clip uses less, so it can be fine.
  snap(t, e, reach = 16) {
    const info = this.shown;
    if (!info || e?.shiftKey) return t;
    const near = (list, px) => {
      let best = null;
      for (const c of list) if (Math.abs(this.x(c) - this.x(t)) <= px && (best === null || Math.abs(c - t) < Math.abs(best - t))) best = c;
      return best;
    };
    const edges = [0, this.total, ...info.bars, ...info.sections.flatMap((x) => [x.start, x.end])];
    const marks = (info.marks || []).map((m) => m.t);
    return near(edges, reach) ?? near([...info.beats, ...marks], 6) ?? t;
  }

  // Plays a few seconds either side of where the selection would be cut, without cutting it.
  previewCut() {
    if (!this.sel) return;
    const { start, end } = this.sel, xf = this.crossfade;
    const joined = cut(this.pieces, xf, start, end);
    const around = slice(joined, xf, Math.max(0, start - 3), start + 3);
    if (!around.length) return;
    this.stop();
    const rate = this.audio.sampleRate;
    const channels = render(around, this.sources, rate, { crossfade: xf });
    const buf = this.audio.createBuffer(channels.length, channels[0].length || 1, rate);
    channels.forEach((ch, c) => buf.copyToChannel(ch, c));
    const node = this.audio.createBufferSource();
    node.buffer = buf;
    node.connect(this.output());
    this.audio.resume();
    node.start();
    const from = Math.max(0, start - 3);
    this.playing = { node, from, at: this.audio.currentTime, preview: true };
    // Afterwards the playhead waits where the cut would join, ready to hear it again.
    node.onended = () => { if (this.playing?.node === node) { this.stop(); this.time = start; this.draw(); } };
    $("music-play").textContent = "⏸ Stop";
    // The playhead runs up to the selection, then jumps over it, as the cut would.
    const tick = () => {
      if (this.playing?.node !== node) return;
      this.time = previewTime(this.audio.currentTime - this.playing.at, from, start, end, this.total);
      this.follow();
      this.draw();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // cut suggestions -----------------------------------------------------------
  // The sections to shorten, as they fall in the result now; "" is the whole song.
  fillCutScope() {
    const sel = $("music-cuts-scope"), cur = sel.value;
    const secs = this.shown?.sections || [];
    const opts = [new Option("the whole song", ""),
      ...secs.map((x, i) => new Option(`${x.label} (${fmtTime(x.start, false)}–${fmtTime(x.end, false)})`, String(i)))];
    const same = opts.length === sel.options.length && opts.every((o, i) => o.text === sel.options[i].text);
    if (!same) sel.replaceChildren(...opts);
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
  }

  get cutScope() {
    const v = $("music-cuts-scope").value, sec = v === "" ? null : this.shown?.sections?.[Number(v)];
    return sec ? { from: sec.start, to: sec.end, sec } : { from: 0, to: this.total, sec: null };
  }

  // A length to aim for: half a section, or three quarters of the song, to the nearest 5 s.
  defaultCutTarget() {
    const { from, to, sec } = this.cutScope, len = to - from;
    const t = sec ? Math.max(1, Math.round(len / 2)) : Math.max(5, Math.round((len * 0.75) / 5) * 5);
    $("music-cuts-target").value = fmtTime(t, false);
    this.updateCutNow();
  }

  updateCutNow() {
    const { from, to } = this.cutScope;
    $("music-cuts-now").textContent = this.pieces.length ? `now ${fmtTime(to - from, false)}` : "";
  }

  // Opens Suggest cuts on step 1, for a section (its index in the lane) or the whole song.
  openCuts(section = null) {
    if (!this.rendered) return;
    this.fillCutScope();
    $("music-cuts-scope").value = section === null ? "" : String(section);
    this.defaultCutTarget();
    this.cutStep(1);
    this.cutNote(this.shown?.bars?.length ? "" : "Press Detect first: suggested cuts follow the song's bars.");
    $("cuts-dialog").showModal();
    $("music-cuts-target").focus();
    $("music-cuts-target").select();
  }

  cutStep(n) {
    $("cuts-step-1").hidden = n !== 1;
    $("cuts-step-2").hidden = n !== 2;
    $("cuts-back").hidden = n !== 2;
    $("music-cuts-find").hidden = n !== 1;
  }

  cutNote(text) {
    $("cuts-note").textContent = text;
    $("cuts-note").hidden = !text;
  }

  closeCuts() {
    if (this.playing?.preview) this.stop();
    this.cutShown = -1;
    this.draw();
  }

  async findCuts() {
    const info = this.shown;
    if (!this.rendered) return;
    if (!info?.bars?.length) return this.cutNote("Press Detect first: suggested cuts follow the song's bars.");
    const { from, to, sec } = this.cutScope, total = this.total;
    const target = parseTime($("music-cuts-target").value);
    if (target === null) return this.cutNote("Type the length you'd like, such as 1:30 or 90.");
    const remove = to - from - target;
    if (remove < 0.5) return this.cutNote(`That's no shorter than it is now (${fmtTime(to - from, false)}).`);
    const pieces = this.pieces, xf = this.crossfade;
    const bars = info.bars.filter((t) => t < total - 0.05);
    this.cutNote("Listening for bars that repeat…");
    $("music-cuts-find").disabled = true;
    try {
      // Bar vectors of the result as it is now, kept until it changes.
      const barsKey = bars.join(",");
      if (this.barVecs?.pieces !== pieces || this.barVecs.xf !== xf || this.barVecs.bars !== barsKey) {
        const { samples, rate } = toMono(this.main, this.audio.sampleRate);
        this.barVecs = { pieces, xf, bars: barsKey, vecs: await barVectorsInWorker(samples, rate, bars) };
      }
      if (this.pieces !== pieces) return;
      const sim = similarity(this.barVecs.vecs);
      const options = sec
        ? sectionCuts({ bars, total, sim, from, to, remove })
        : songPlans({ bars, total, sim, sections: info.sections, remove });
      this.cutOpts = { pieces, xf, options, section: sec && { label: sec.label, len: to - from } };
      this.cutShown = -1;
      if (options.length) {
        this.cutNote("");
        $("cuts-step-2-title").textContent = `Step 2 of 2: pick a cut to shorten ${sec ? `"${sec.label}"` : "the song"} to about ${fmtTime(target, false)}`;
        this.cutStep(2);
        $("cuts-ai").hidden = true;
        if (options.length > 1 && this.host.hasAI?.()) {
          this.askAIAboutCuts(this.cutOpts, { song: { name: nameOf(this.base).replace(/\.[^.]+$/, ""), tempo: info.tempo },
            total, scope: { label: sec?.label || null, now: to - from, target }, sections: info.sections, marks: info.marks || [] });
        }
      } else this.cutNote(`No good places to cut ${sec ? `"${sec.label}"` : "the song"} by that much. Try a different length.`);
    } catch (e) {
      this.cutNote(`Couldn't find cuts: ${e.message}`);
    } finally {
      $("music-cuts-find").disabled = false;
      this.updateControls();
      this.draw();
    }
  }

  // With an AI set up: it puts the options in the order it thinks works best, each with a reason.
  // They can be heard and used meanwhile; its order arrives if they're still the ones showing.
  async askAIAboutCuts(opts, about) {
    $("cuts-ai").textContent = "✨ Asking the AI which works best musically… (you can listen meanwhile)";
    $("cuts-ai").hidden = false;
    try {
      const reply = await this.host.api("api/ai/cuts", { method: "POST", json: cutsRequest(opts.options, about) });
      if (this.cutOpts !== opts) return;
      const { options, used } = rankCuts(opts.options, reply);
      if (!used) { $("cuts-ai").textContent = "The AI's answer couldn't be used, so they're in the editor's order."; return; }
      opts.options = options;
      const pick = options.findIndex((o) => o.aiRank === 1) + 1;
      const summary = String(reply.summary || "").trim().slice(0, 200);
      $("cuts-ai").textContent = `✨ The AI's pick is option ${pick}${summary ? `: ${summary}` : "."}`;
      this.renderCuts();
    } catch (e) {
      if (this.cutOpts === opts) $("cuts-ai").textContent = `The AI couldn't compare them (${e.message}), so they're in the editor's order.`;
    }
  }

  // The suggestions as a list: what each takes out, a ▶ per cut to hear its join, and Use.
  renderCuts() {
    if (this.cutOpts && (this.cutOpts.pieces !== this.pieces || this.cutOpts.xf !== this.crossfade)) {
      this.cutOpts = null;
      this.cutShown = -1;
    }
    const opts = this.cutOpts?.options || [], total = this.total, section = this.cutOpts?.section;
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    $("music-cuts").replaceChildren(...opts.map((o, k) => {
      const n = o.cuts.length, bars = o.cuts.reduce((s, c) => s + c.bars, 0);
      const row = el("div", "cut-option" + (k === this.cutShown ? " shown" : ""));
      const after = section ? `${section.label} becomes ${fmtTime(section.len - o.removed, false)}` : `${fmtTime(total - o.removed, false)} long`;
      const what = el("span", "hint", `${n > 1 ? `${n} cuts, ` : ""}${bars} bars, ${Math.round(o.removed)} s shorter (${after}) · `
        + (n > 1 && o.join < 0.8 ? `weakest ${joinLabel(o.join)}` : joinLabel(o.join)));
      const chips = el("span", "cut-chips");
      for (const c of o.cuts) {
        const b = el("button", "", `▶ ${fmtTime(c.start, false)}–${fmtTime(c.end, false)}`);
        b.type = "button";
        b.title = `Hear the join: ${c.bars} bar${c.bars === 1 ? "" : "s"} cut, ${joinLabel(c.join)}`;
        b.addEventListener("click", () => {
          this.cutShown = k;
          this.sel = { start: c.start, end: c.end };
          this.updateControls();
          this.previewCut();
        });
        chips.append(b);
      }
      const use = el("button", "primary", "Use");
      use.type = "button";
      use.title = n > 1 ? "Make all these cuts (Ctrl+Z undoes)" : "Make this cut (Ctrl+Z undoes)";
      use.addEventListener("click", () => { $("cuts-dialog").close(); this.useCuts(o); });
      row.append(el("b", "", `Option ${k + 1}`));
      if (o.aiRank === 1) row.append(el("span", "ai-pick", "AI's pick"));
      row.append(what, chips, el("span", "spacer"), use);
      if (o.reason) row.append(el("span", "hint cut-reason", `✨ ${o.reason}`));
      return row;
    }));
  }

  // Saves the selection, as it sounds in the edit, as a sample (Library → Samples) to layer over songs.
  async saveSample() {
    if (!this.sel || !this.rendered) return;
    const { start, end } = this.sel;
    const song = nameOf(this.base || { path: "song" }).replace(/\.[^.]+$/, "");
    const typed = prompt("Name the sample", `${song} ${fmtTime(start, false).replace(":", ".")}`)?.trim();
    if (!typed) return;
    const name = `${typed.replace(/\.wav$/i, "")}.wav`;
    const have = await this.host.api("api/samples").catch(() => []);
    if (have.some((s) => s.path.split("/").pop().toLowerCase() === name.toLowerCase())
        && !confirm(`There's already a sample called ${name}. Replace it?`)) return;
    // As it sounds in the edit, layers and all.
    const rate = this.audio.sampleRate, a = Math.round(start * rate), b = Math.round(end * rate);
    const channels = this.rendered.map((ch) => ch.slice(a, b));
    this.host.status(`Saving ${name}…`);
    try {
      await uploadSong(this.host.api, new Blob([encodeWav(channels, rate)], { type: "audio/wav" }), name,
        (done) => { if (done < 1) this.host.status(`Saving ${name}… ${Math.round(done * 100)}%`); }, { sample: true });
      this.host.status(`Saved ${name} to your samples (Library → Samples)`, "saved");
    } catch (e) {
      this.host.status(`Couldn't save the sample: ${e.message}`, true);
    }
  }

  useCuts(option) {
    const xf = this.crossfade;
    // Latest first, so the earlier cuts' times still hold.
    const cuts = [...option.cuts].sort((a, b) => b.start - a.start);
    const pieces = cuts.reduce((p, c) => cut(p, xf, c.start, c.end), this.pieces);
    this.sel = null;
    this.time = cuts[cuts.length - 1].start;
    this.edit(pieces);
    this.host.status(`${cuts.length > 1 ? `Made ${cuts.length} cuts` : "Cut"}; it's now ${fmtTime(this.total, false)} long. Ctrl+Z undoes`, "saved");
  }

  // Applies a change to the base song's sections and saves it with the song shortly after.
  editSections(sections, select = this.secSel) {
    if (!sections) return;
    this.info = { ...this.info, sections };
    this.secSel = select;
    this.saveInfoSoon();
  }

  // Saves the base song's beats, sections and marks with it, shortly after the last change.
  saveInfoSoon() {
    this.editedAt = Date.now();
    clearTimeout(this.saveTimer);
    const ref = this.base, info = this.info;
    this.saveTimer = setTimeout(() => {
      this.host.api(infoUrl(ref), { method: "PUT", json: info })
        .catch((e) => this.host.status(`Couldn't save the song's sections and marks: ${e.message}`, true));
    }, 400);
    this.updateControls();
    this.draw();
  }

  // marks ---------------------------------------------------------------------
  // The marks where they fall in the result, editable even with an unsaved edit: changes go back onto
  // the base song (so they're kept with it, and carried over when the draft's song file is made).
  get marks() { return this.base ? this.shown?.marks || [] : null; }

  // The base song's marks for an edited list of the shown ones (see marksToBase).
  marksFrom(edited, pick, base = this.info?.marks || [], shown = this.shown?.marks || []) {
    const src = this.base && keyOf(this.base);
    return marksToBase(base, shown, edited, (t) => toBase(this.pieces, this.crossfade, src, t), pick);
  }

  // The base index of the picked mark (-1 if none), so it stays picked when the edit changes.
  pickedMark() {
    const m = this.marks?.[this.markSel];
    return m ? m.k ?? this.markSel : -1;
  }

  // The shown mark that is base mark k, or -1 (cut out).
  shownMark(k) {
    return k < 0 ? -1 : (this.shown?.marks || []).findIndex((m, i) => (m.k ?? i) === k);
  }

  editMarks(edited, pick = this.markSel) {
    const { marks, index } = this.marksFrom(edited, pick);
    this.info = { tempo: null, beats: [], bars: [], sections: [], ...this.info, marks };
    this.markSel = this.shownMark(index);
    if (this.markSel >= 0) this.secSel = -1;
    this.saveInfoSoon();
  }

  addMarkHere({ open = true } = {}) {
    if (!this.rendered) return;
    if (!this.marks) return;
    if ((this.info?.marks || []).length >= MAX_MARKS) return this.host.status(`A song can have up to ${MAX_MARKS} marks; delete one first`, "hint");
    if (toBase(this.pieces, this.crossfade, keyOf(this.base), this.time) === null) {
      return this.host.status("This part was spliced in from another song. Make the song file, then mark it there", "hint");
    }
    const { marks, index } = addMark(this.marks, this.time, this.markColour || MARK_COLOUR);
    // While playing (M), the mark you had picked stays picked.
    this.editMarks(marks, open ? index : marks.indexOf(this.marks[this.markSel]));
    if (open) $("music-mark-name").focus();
    else this.host.status(`Marked ${fmtTime(this.time)}`);
  }

  renderMark() {
    const m = this.marks?.[this.markSel];
    $("music-mark").hidden = !m;
    if (!m) return;
    if (document.activeElement !== $("music-mark-name")) $("music-mark-name").value = m.label || "";
    $("music-mark-colour").value = m.color || MARK_COLOUR;
    $("music-mark-time").textContent = `At ${fmtTime(m.t)}`;
  }

  wireMarks() {
    const change = (fn) => {
      const marks = this.marks;
      if (!marks?.[this.markSel]) return;
      this.editMarks(marks.map((m, i) => (i === this.markSel ? fn(m) : m)));
    };
    $("music-mark-add").addEventListener("click", () => this.addMarkHere());
    $("music-mark-name").addEventListener("input", (e) => change((m) => ({ ...m, label: e.target.value.slice(0, 40) })));
    $("music-mark-name").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
    $("music-mark-colour").addEventListener("input", (e) => {
      this.markColour = e.target.value;
      change((m) => ({ ...m, color: e.target.value }));
    });
    $("music-mark-here").addEventListener("click", () => {
      if (!this.marks?.[this.markSel]) return;
      const { marks, index } = moveMark(this.marks, this.markSel, this.time);
      this.editMarks(marks, index);
    });
    $("music-mark-delete").addEventListener("click", () => {
      this.editMarks(this.marks.filter((_, i) => i !== this.markSel), -1);
    });
    $("music-mark-close").addEventListener("click", () => { this.markSel = -1; this.updateControls(); this.draw(); });
  }

  // The mark whose flag is under (x, y), or -1.
  markAt(x, y) {
    if (y < RULER_H || y >= RULER_H + BEAT_H) return -1;
    return this.markBoxes.find((b) => x >= b.x0 && x <= b.x1)?.i ?? -1;
  }

  renderSection() {
    const secs = this.sections, s = secs?.[this.secSel];
    $("music-section").hidden = !s;
    if (!s) return;
    const names = [...new Set(secs.map((x) => x.label))];
    $("music-sec-name").value = s.label;
    $("music-sec-notes").value = s.notes || "";
    $("music-sec-colour").value = s.color || hueHex(sectionHue(names, s.label));
    $("music-sec-time").textContent = `${fmtTime(s.start)} to ${fmtTime(s.end)}`;
    $("music-sec-merge").disabled = this.secSel + 1 >= secs.length;
    $("music-sec-delete").disabled = secs.length < 2;
    $("music-sec-colour-hint").textContent = secs.filter((x) => x.label === s.label).length > 1
      ? `Colour changes every "${s.label}"` : "";
  }

  wireSections() {
    $("music-sec-name").addEventListener("change", (e) => {
      const name = e.target.value.trim().slice(0, 40);
      if (!name) { this.renderSection(); return; }
      this.editSections(this.sections.map((x, i) => (i === this.secSel ? { ...x, label: name, named: true } : x)));
    });
    $("music-sec-notes").addEventListener("change", (e) => {
      const notes = e.target.value.trim().slice(0, 300);
      this.editSections(this.sections.map((x, i) => {
        if (i !== this.secSel) return x;
        const { notes: _, autoNotes: __, ...rest } = x; // your notes now, so describing leaves them alone
        return notes ? { ...rest, notes } : rest;
      }));
    });
    $("music-sec-colour").addEventListener("input", (e) => {
      const label = this.sections[this.secSel].label, color = e.target.value;
      this.editSections(this.sections.map((x) => (x.label === label ? { ...x, color } : x)));
    });
    $("music-sec-split").addEventListener("click", () => {
      const secs = this.sections, i = sectionAt(secs, this.time);
      const out = splitSection(secs, i, this.time);
      if (!out) return this.host.status("Move the playhead inside a section, at least half a second from its edges", "hint");
      this.editSections(out, i + 1);
    });
    $("music-sec-merge").addEventListener("click", () => this.editSections(mergeSections(this.sections, this.secSel)));
    $("music-sec-delete").addEventListener("click", () => {
      const i = this.secSel;
      this.editSections(removeSection(this.sections, i), Math.max(0, i - 1));
    });
    $("music-join-hear").addEventListener("click", () => this.hearJoin(this.joinSel));
    $("music-join-adjust").addEventListener("click", () => this.putJoinBack(true));
    $("music-join-back").addEventListener("click", () => this.putJoinBack(false));
    $("music-join-close").addEventListener("click", () => { this.joinSel = -1; this.updateControls(); this.draw(); });
    $("music-sec-shorten").addEventListener("click", () => this.openCuts(this.secSel));
    $("music-sec-close").addEventListener("click", () => { this.secSel = -1; this.updateControls(); this.draw(); });
  }

  // Re-render after any change; `fit` also zooms out to the whole result.
  changed(fit = false) {
    const rate = this.audio?.sampleRate || 44100;
    const fadeIn = Number($("music-fadein").value) || 0, fadeOut = Number($("music-fadeout").value) || 0;
    // The song is only rendered again when it changed (not for a change to the layers alone).
    const same = this.mainFor && this.mainFor.pieces === this.pieces && this.mainFor.xf === this.crossfade
      && this.mainFor.fadeIn === fadeIn && this.mainFor.fadeOut === fadeOut && this.mainFor.rate === rate;
    if (!same) {
      this.main = this.pieces.length ? render(this.pieces, this.sources, rate, { crossfade: this.crossfade, fadeIn, fadeOut }) : null;
      this.mainFor = { pieces: this.pieces, xf: this.crossfade, fadeIn, fadeOut, rate };
      this.songLufs = null; // measured again when a clip is next added
    }
    // The song through its own EQ (kept until the song or its EQ changes).
    const eqSame = same && this.eqFor && this.eqFor.eq === this.eq && this.eqFor.main === this.main;
    if (!eqSame) {
      this.mainEq = this.main && !isFlat(this.eq)
        ? applyEq(this.main.map((ch) => Float32Array.from(ch)), rate, this.eq, placeChanges(this.eq, this.pieces, this.crossfade)) : this.main;
      this.eqFor = { eq: this.eq, main: this.main };
    }
    // Clips on layers matching the song's tempo play from a stretched copy of their audio (kept).
    const placed = this.main ? this.placed() : [];
    for (const p of placed) {
      const c = this.layers[p.layer].clips[p.clip], key = sourceKey(c, p.speed), src = this.sources[keyOf(c.song)];
      if (p.speed !== 1 && src && !this.sources[key]) this.sources[key] = stretch(src, rate, p.speed);
    }
    // Stretched copies no clip plays at any more (a tempo typed again, say) are let go.
    const used = new Set(placed.map((p) => sourceKey(this.layers[p.layer].clips[p.clip], p.speed)));
    for (const key of Object.keys(this.sources)) if (key.includes("@") && !used.has(key)) delete this.sources[key];
    // What plays and is made into a song file: the song with its layers mixed in, kept from clipping.
    this.rendered = placed.length || this.mainEq !== this.main
      ? limit(mixLayers(this.mainEq, this.layers, placed, this.sources, rate, { pieces: this.pieces, crossfade: this.crossfade }), rate) : this.main;
    if (!same) this.peaks = this.main ? peaks(this.main) : null;
    if (this.h !== WAVE_B + LANE_H * this.layers.length) this.layout();
    const total = this.total;
    this.time = Math.min(this.time, total);
    if (this.sel) this.sel = { start: Math.min(this.sel.start, total), end: Math.min(this.sel.end, total) };
    if (fit || !this.view.span || this.view.start + this.view.span > total + 1) this.fit();
    this.updateControls();
    this.draw();
  }

  updateControls() {
    const has = this.pieces.length > 0, sel = this.sel;
    for (const id of ["music-play", "music-home", "music-back", "music-fwd", "music-insert", "music-append", "music-save", "music-zoom-in", "music-zoom-out", "music-fit",
      "music-xf", "music-fadein", "music-fadeout", "music-name"]) $(id).disabled = !has;
    for (const id of ["music-cut", "music-keep", "music-play-sel", "music-zoom-sel", "music-preview", "music-sample", "music-sel-clear"]) $(id).disabled = !sel;
    $("music-undo").disabled = !this.history.length;
    $("music-detect").disabled = !this.base || this.dirty;
    $("music-describe").disabled = !this.base || this.dirty || !this.info?.sections?.length;
    $("music-detect").title = this.dirty
      ? "Make the song file first: it's detected when it's made, and the beats here follow your edits until then"
      : "Find the tempo, beats, bars and sections (verse, chorus…) and keep them with this song. A show that picks the song uses them.";
    const shown = this.shown, info = shown && (shown.beats.length || shown.sections.length) ? shown : null;
    $("music-analysis").textContent = !has ? ""
      : this.dirty && !info ? "Make the song file to find its beats and sections"
        : info ? `${info.tempo ? `${info.tempo} BPM, ` : ""}${info.beats.length} beats, ${info.sections.length} sections${info.sections.length ? `: ${info.sections.map((x) => x.label).join(", ")}` : ""}`
          : "Not detected yet";
    if (this.dirty && info) $("music-analysis").textContent += " (following your edits)";
    $("music-redo").disabled = !this.future.length;
    this.updateSaveState();
    if (!this.sections || this.secSel >= this.sections.length) this.secSel = -1;
    this.renderSection();
    if (this.joinSel >= this.pieces.length) this.joinSel = -1;
    this.renderJoin();
    this.renderLayers();
    if (!this.marks || this.markSel >= this.marks.length) this.markSel = -1;
    this.renderMark();
    $("music-mark-add").disabled = !has || !this.marks;
    $("music-suggest").disabled = !has;
    this.renderCuts();
    $("music-sel-start").disabled = $("music-sel-end").disabled = !sel;
    $("music-sel-start").value = sel ? sel.start.toFixed(2) : "";
    $("music-sel-end").value = sel ? sel.end.toFixed(2) : "";
    $("music-sel-len").textContent = sel ? `${(sel.end - sel.start).toFixed(2)} s selected` : "";
    const n = this.pieces.length;
    $("music-title").textContent = this.base ? nameOf(this.base).replace(/\.[^.]+$/, "") : "No song open";
    $("music-info").textContent = has
      ? `${fmtTime(this.total)} long${this.base ? `, from ${nameOf(this.base)}` : ""}${n > 1 ? `, ${n} pieces` : ""}`
      : "";
  }

  // playback ------------------------------------------------------------------
  play(from = this.time, to = this.total) {
    if (!this.rendered) return;
    this.stop();
    const rate = this.audio.sampleRate;
    const buf = this.audio.createBuffer(this.rendered.length, this.rendered[0].length || 1, rate);
    this.rendered.forEach((ch, c) => buf.copyToChannel(ch, c));
    const node = this.audio.createBufferSource();
    node.buffer = buf;
    node.connect(this.output());
    if (from >= to - 0.01) from = 0;
    node.start(0, from, to - from);
    this.audio.resume();
    this.playing = { node, from, at: this.audio.currentTime };
    node.onended = () => { if (this.playing?.node === node) this.stop(); };
    $("music-play").textContent = "⏸ Stop";
    const tick = () => {
      if (this.playing?.node !== node) return;
      this.time = Math.min(this.playing.from + this.audio.currentTime - this.playing.at, this.total);
      this.follow();
      this.draw();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Moves the playhead, carrying on playing from there if it was.
  seek(t) {
    this.time = Math.min(Math.max(t, 0), this.total);
    if (this.playing) this.play(this.time);
    else { this.follow(); this.draw(); }
  }

  skip(dir) { this.seek(skipTarget(this.time, this.shown?.bars, dir, this.total)); }

  stop() {
    if (!this.playing) return;
    const { node } = this.playing;
    this.playing = null;
    try { node.stop(); } catch { /* already ended */ }
    $("music-play").textContent = "▶ Play";
    this.draw();
  }

  // making the song file ---------------------------------------------------------
  // Writes the draft as a WAV in the songs folder, for shows and speakers. The draft stays open, so
  // it can be changed and made again: then you choose between replacing that file and a new one.
  async save() {
    if (!this.rendered) return;
    const name = $("music-name").value.trim().replace(/\.wav$/i, "");
    if (!name) return this.host.status("Give the draft a name first; the file is named after it", "hint");
    const taken = this.host.songs().map((r) => r.path);
    let file = `${name}.wav`;
    const made = this.draft?.made;
    if (made && taken.includes(made.path)) {
      const how = await this.askMake(made, freshFileName(name, taken));
      if (!how) return;
      file = how === "replace" ? nameOf(made) : freshFileName(name, taken);
    } else if (taken.some((p) => nameOf({ path: p }).toLowerCase() === file.toLowerCase())
        && !confirm(`${file} already exists. Replace it?`)) return;
    // The spliced-in songs' info as it is now, so none of their marks are missed or out of date.
    const mainKey = this.base && keyOf(this.base);
    await Promise.all([...new Set(this.pieces.map((p) => p.src))].filter((k) => k !== mainKey && this.refs[k])
      .map((k) => this.loadInfo(this.refs[k])));
    this.stop();
    this.host.status(`Making ${file}…`);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // let that show before the work
    // Even out the volume: the same loudness as other songs made here (only the level changes).
    const even = $("music-even").checked ? evenOut(this.rendered, this.audio.sampleRate) : { channels: this.rendered, gain: 0 };
    const blob = new Blob([encodeWav(even.channels, this.audio.sampleRate)], { type: "audio/wav" });
    // Beats and sections that followed the edit carry over, with their names, colours and notes, as
    // long as every song in it has been detected (a spliced-in song brings its own); otherwise the
    // result is detected afresh. Marks always come along: the base song's and any spliced-in song's.
    const baseKey = this.base && keyOf(this.base);
    const detected = (info) => Boolean(info?.beats?.length || info?.sections?.length);
    const everyDetected = this.pieces.every((p) => detected(p.src === baseKey ? this.info : this.infos[p.src]));
    const marks = [...(this.shown?.marks || []).map(({ k: _, ...m }) => m), ...(this.shown?.otherMarks || [])]
      .sort((a, b) => a.t - b.t);
    const { otherMarks: _o, ...shownInfo } = this.shown || {};
    const carry = everyDetected && this.shown ? { ...shownInfo, marks } : null;
    const rendered = this.main, rate = this.audio.sampleRate; // Detect goes by the song, not the layers
    // The draft as it was when you pressed it, and which draft: you might open another while it's made.
    const session = this.keeper.session, body = this.base && this.pieces.length ? this.draftBody() : null;
    try {
      const ref = await uploadSong(this.host.api, blob, file, (done) => {
        if (done < 1) this.host.status(`Making ${file}… ${Math.round(done * 100)}%`);
      });
      // The draft remembers the file it made, so making it again can replace it (making a song
      // file from an untouched song starts a draft too, so it can be made again).
      this.keeper.setMade(ref, session);
      if (body) this.keeper.changed(body, session);
      if (session === this.keeper.session) await this.flush();
      else await session.chain;
      await this.host.songsChanged();
      this.fillSongLists();
      const level = Math.abs(even.gain) >= 0.5 ? ` (turned ${even.gain > 0 ? "up" : "down"} ${Math.abs(even.gain).toFixed(1)} dB to even out the volume)` : "";
      this.host.status(`Made ${ref.path}${level}. Pick it under Song in a show; the draft stays open to change`, "saved", "music-save");
      if (carry) await this.host.api(infoUrl(ref), { method: "PUT", json: carry });
      else await this.detectMade(ref, rendered, rate, marks);
      this.host.songsChanged();
    } catch (e) {
      this.host.status(`Couldn't make the song file: ${e.message}`, true, "music-save");
    }
  }

  // Detect for a file just made from a draft (with something spliced in), keeping the draft's marks.
  async detectMade(ref, channels, rate, marks) {
    const mono = toMono(channels, rate);
    const r = await analyseInWorker(mono.samples, mono.rate);
    const info = { tempo: r.tempo || null, beats: r.beats, bars: r.bars,
      sections: describeSections(r.sections, r.traits), marks };
    await this.host.api(infoUrl(ref), { method: "PUT", json: info });
  }

  // Making a file a draft has made before: replace it, or make a new one? Lists the shows using it,
  // since their effects stay where they are when the music changes. Resolves "replace", "new" or null.
  async askMake(made, fresh) {
    const [shows, drafts] = await Promise.all([this.host.api("api/shows").catch(() => []), this.host.api("api/drafts").catch(() => [])]);
    const users = shows.filter((s) => s.song === made.path).map((s) => s.name);
    const mine = this.draft?.id;
    const splicers = drafts.filter((d) => d.id !== mine && (d.uses || []).includes(made.path)).map((d) => `"${d.name}"`);
    $("make-file").textContent = nameOf(made);
    $("make-new").textContent = `Make ${fresh}`;
    $("make-users").textContent = users.length
      ? `Used by ${users.join(", ")}. Replacing it changes the music in ${users.length === 1 ? "that show" : "those shows"}, but their effects stay where they are, so check they still line up.`
      : "No shows use it yet.";
    $("make-drafts").textContent = splicers.length
      ? `It's also part of the draft${splicers.length === 1 ? "" : "s"} ${splicers.join(", ")}, which will play the new version too.` : "";
    $("make-drafts").hidden = !splicers.length;
    const dlg = $("make-dialog");
    return new Promise((resolve) => {
      const done = (how) => { dlg.close(); resolve(how); };
      $("make-replace").onclick = () => done("replace");
      $("make-new").onclick = () => done("new");
      for (const b of dlg.querySelectorAll("[data-make=cancel]")) b.onclick = () => done(null);
      dlg.oncancel = () => resolve(null);
      dlg.showModal();
    });
  }

  // view ----------------------------------------------------------------------
  layout() {
    const wrap = this.canvas.parentElement, dpr = window.devicePixelRatio || 1;
    this.w = wrap.clientWidth;
    this.h = WAVE_B + LANE_H * this.layers.length;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  fit() { this.view = { start: 0, span: Math.max(this.total, 1) }; this.draw(); }

  zoom(factor, anchorT = this.time) {
    const total = Math.max(this.total, 1);
    const span = Math.min(Math.max(this.view.span * factor, 0.05), total);
    const f = (anchorT - this.view.start) / this.view.span;
    this.view = { start: Math.min(Math.max(anchorT - f * span, 0), total - span), span };
    this.draw();
  }

  zoomTo(a, b) {
    const pad = (b - a) * 0.05;
    const total = Math.max(this.total, 1);
    const span = Math.min(Math.max(b - a + 2 * pad, 0.05), total);
    this.view = { start: Math.min(Math.max(a - pad, 0), total - span), span };
    this.draw();
  }

  follow() {
    const { start, span } = this.view;
    if (this.time > start + span || this.time < start) {
      this.view.start = Math.min(Math.max(this.time - span * 0.1, 0), Math.max(this.total - span, 0));
    }
  }

  x(t) { return ((t - this.view.start) / this.view.span) * this.w; }
  t(x) { return this.view.start + (x / this.w) * this.view.span; }

  draw() {
    if (!this.w) return;
    const { ctx, w, h } = this;
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = col("--track");
    ctx.fillRect(0, RULER_H, w, h - RULER_H);
    if (!this.rendered) {
      ctx.fillStyle = col("--muted");
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Open a song from Library → Songs to start", 12, RULER_H + 30);
      return;
    }
    const rate = this.audio.sampleRate;

    const laneT = RULER_H + BEAT_H, waveT = laneT + SEC_H, waveB = WAVE_B; // beats, sections, then the waveform
    const info = this.shown;
    const names = info ? [...new Set(info.sections.map((x) => x.label))] : [];

    // sections: tinted bands behind the waveform, one tint per name
    if (info) {
      ctx.strokeStyle = col("--line");
      for (const sec of info.sections) {
        const x0 = Math.max(0, this.x(sec.start)), x1 = Math.min(w, this.x(sec.end));
        if (x1 <= x0) continue;
        ctx.fillStyle = sectionTint(names, sec.label, sec.color);
        ctx.globalAlpha = SECTION_ALPHA;
        ctx.fillRect(x0, waveT, x1 - x0, waveB - waveT);
        ctx.globalAlpha = 1;
        const xs = Math.round(this.x(sec.start)) + 0.5;
        ctx.beginPath(); ctx.moveTo(xs, waveT); ctx.lineTo(xs, waveB); ctx.stroke();
      }
    }

    // waveform: the loudest sample under each pixel, in the selection colour where selected
    const mid = waveT + (waveB - waveT) / 2, amp = (waveB - waveT) / 2 - 4;
    const sx0 = this.sel ? this.x(this.sel.start) : Infinity, sx1 = this.sel ? this.x(this.sel.end) : -Infinity;
    const wave = col("--wave"), region = col("--region");
    const spp = (this.view.span * rate) / w; // samples per pixel
    for (let px = 0; px < w; px++) {
      const s0 = Math.floor((this.view.start * rate) + px * spp), s1 = Math.max(s0 + 1, Math.floor(s0 + spp));
      let m = 0;
      if (spp >= BLOCK) {
        for (let b = Math.floor(s0 / BLOCK), e = Math.ceil(s1 / BLOCK); b < e && b < this.peaks.length; b++) m = Math.max(m, this.peaks[b]);
      } else {
        for (const ch of this.main) for (let s = s0; s < s1 && s < ch.length; s++) m = Math.max(m, Math.abs(ch[s]));
      }
      const hgt = Math.max(1, m * amp);
      ctx.fillStyle = px >= sx0 && px < sx1 ? region : wave;
      ctx.fillRect(px, mid - hgt, 1, hgt * 2);
    }


    // section lane: each section in its colour with its name, the picked one outlined
    ctx.fillStyle = col("--panel");
    ctx.fillRect(0, laneT, w, SEC_H);
    if (info) {
      ctx.font = "11px system-ui, sans-serif";
      info.sections.forEach((sec, i) => {
        const x0 = Math.max(0, this.x(sec.start)), x1 = Math.min(w, this.x(sec.end));
        if (x1 <= x0) return;
        ctx.fillStyle = sectionTint(names, sec.label, sec.color);
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x0, laneT + 1, x1 - x0, SEC_H - 2);
        ctx.globalAlpha = 1;
        if (i === this.secSel) {
          ctx.strokeStyle = col("--accent");
          ctx.lineWidth = 2;
          ctx.strokeRect(x0 + 1, laneT + 1, x1 - x0 - 2, SEC_H - 2);
          ctx.lineWidth = 1;
        }
        ctx.fillStyle = col("--line");
        ctx.fillRect(Math.round(this.x(sec.start)), laneT, 1, SEC_H);
        ctx.fillStyle = col("--text");
        if (x1 - x0 > 30) {
          ctx.save();
          ctx.beginPath(); ctx.rect(x0, laneT, x1 - x0 - 2, SEC_H); ctx.clip();
          ctx.fillText(sec.label, x0 + 5, laneT + 14);
          ctx.restore();
        }
      });
    }

    // beat lane above the waveform, each beat's line running down through it, bar starts stronger
    ctx.fillStyle = col("--panel");
    ctx.fillRect(0, RULER_H, w, BEAT_H);
    if (info) {
      const bars = new Set(info.bars.map((b) => Math.round(b * 1000)));
      const gap = info.beats.length > 1 ? (w / this.view.span) * ((info.beats.at(-1) - info.beats[0]) / (info.beats.length - 1)) : w;
      ctx.strokeStyle = ctx.fillStyle = col("--beat");
      for (const b of beatsToDraw(info.beats, info.bars, gap)) {
        const x = this.x(b);
        if (x < -4 || x > w + 4) continue;
        ctx.globalAlpha = bars.has(Math.round(b * 1000)) ? 0.7 : 0.35;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, waveT); ctx.lineTo(Math.round(x) + 0.5, waveB); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(x - 4, RULER_H + 3); ctx.lineTo(x + 4, RULER_H + 3); ctx.lineTo(x, RULER_H + BEAT_H - 3); ctx.fill();
      }
    }

    // A spliced-in song's marks: shown faintly with a dashed line, and edited on that song itself.
    for (const m of info?.otherMarks || []) {
      const x = Math.round(this.x(m.t));
      if (x < -200 || x > w + 4) continue;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = ctx.fillStyle = m.color || MARK_COLOUR;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x + 0.5, RULER_H); ctx.lineTo(x + 0.5, waveB); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "600 11px system-ui, sans-serif";
      const label = m.label || "";
      const wide = label ? Math.min(140, ctx.measureText(label).width) + 10 : 8;
      ctx.fillRect(x, RULER_H + 1, wide, BEAT_H - 2);
      if (label) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = markText(m.color || MARK_COLOUR);
        ctx.beginPath(); ctx.rect(x, RULER_H, wide, BEAT_H); ctx.clip();
        ctx.fillText(label, x + 4, RULER_H + BEAT_H - 4);
      }
      ctx.restore();
    }
    // marks: a coloured line down through the waveform and a flag with its name in the beat lane
    this.markBoxes = [];
    (info?.marks || []).forEach((m, i) => {
      const x = Math.round(this.x(m.t));
      if (x < -200 || x > w + 4) return;
      const colour = m.color || MARK_COLOUR, picked = i === this.markSel;
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x - 1, RULER_H, 2, waveB - RULER_H);
      ctx.globalAlpha = 1;
      ctx.font = "600 11px system-ui, sans-serif";
      const label = m.label || "";
      const wide = label ? Math.min(140, ctx.measureText(label).width) + 10 : 8;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H + 1); ctx.lineTo(x + wide + 4, RULER_H + 1); ctx.lineTo(x + wide, RULER_H + BEAT_H / 2);
      ctx.lineTo(x + wide + 4, RULER_H + BEAT_H - 1); ctx.lineTo(x, RULER_H + BEAT_H - 1);
      ctx.closePath();
      ctx.fill();
      if (picked) { ctx.strokeStyle = col("--text"); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
      if (label) {
        ctx.fillStyle = markText(colour);
        ctx.save();
        ctx.beginPath(); ctx.rect(x, RULER_H, wide, BEAT_H); ctx.clip();
        ctx.fillText(label, x + 4, RULER_H + BEAT_H - 4);
        ctx.restore();
      }
      this.markBoxes.push({ i, x0: x - 5, x1: x + wide + 4 });
    });

    // ruler
    ctx.fillStyle = col("--panel");
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.fillStyle = col("--muted");
    ctx.strokeStyle = col("--line");
    ctx.font = "11px system-ui, sans-serif";
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => (s / this.view.span) * w >= 70) || 300;
    for (let t = Math.ceil(this.view.start / step) * step; t <= this.view.start + this.view.span; t += step) {
      const x = Math.round(this.x(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, RULER_H - 5); ctx.lineTo(x, RULER_H); ctx.stroke();
      ctx.fillText(fmtTime(t, step < 1), x + 3, 14);
    }

    // joins between pieces: a dashed line in the text colour, and a ✂ grip in the ruler to hear it
    ctx.strokeStyle = ctx.fillStyle = col("--text");
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    for (const j of joins(this.pieces, this.crossfade)) {
      const x = Math.round(this.x(j)) + 0.5;
      if (x < -8 || x > w + 8) continue;
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, waveB); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.font = "12px system-ui, sans-serif";
    joins(this.pieces, this.crossfade).forEach((j, k) => {
      const x = this.x(j);
      if (x < -8 || x > w + 8) return;
      const picked = k + 1 === this.joinSel;
      ctx.fillStyle = col(picked ? "--accent" : "--panel");
      ctx.fillRect(x - 9, 1, 18, RULER_H - 3);
      ctx.strokeStyle = col("--text");
      ctx.strokeRect(Math.round(x - 9) + 0.5, 1.5, 18, RULER_H - 4);
      ctx.fillStyle = picked ? "#fff" : col("--text");
      ctx.fillText("✂", x - 6, RULER_H - 7);
    });

    // the suggestion being heard: red bands over what it would take out
    for (const c of this.cutOpts?.options?.[this.cutShown]?.cuts || []) {
      const x0 = this.x(c.start), x1 = this.x(c.end);
      if (x1 < 0 || x0 > w) continue;
      ctx.save();
      ctx.fillStyle = col("--danger");
      ctx.globalAlpha = 0.18;
      ctx.fillRect(x0, waveT, x1 - x0, waveB - waveT);
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x0, waveT, x1 - x0, 3);
      ctx.restore();
    }

    this.drawLayers(col);
    this.drawChanges(col);
    this.refreshEq();

    // selection on top of everything: dim what's outside it, band the ruler, solid edges with grips
    if (this.sel) {
      ctx.fillStyle = "#000";
      ctx.globalAlpha = 0.4;
      if (sx0 > 0) ctx.fillRect(0, RULER_H, Math.min(sx0, w), h - RULER_H);
      if (sx1 < w) ctx.fillRect(Math.max(sx1, 0), RULER_H, w - Math.max(sx1, 0), h - RULER_H);
      ctx.fillStyle = region;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(sx0, 0, sx1 - sx0, RULER_H);
      ctx.globalAlpha = 1;
      for (const x of [sx0, sx1]) {
        ctx.fillRect(Math.round(x) - 1, 0, 2, h);
        ctx.fillRect(Math.round(x) - 4, 0, 8, 10);
      }
    }

    // playhead
    ctx.fillStyle = col("--playhead");
    ctx.fillRect(Math.round(this.x(this.time)) - 1, 0, 2, h);
    $("music-clock").textContent = `${fmtTime(this.time)} / ${fmtTime(this.total)}`;
    this.canvas.setAttribute("aria-valuemin", "0");
    this.canvas.setAttribute("aria-valuemax", this.total.toFixed(2));
    this.canvas.setAttribute("aria-valuenow", this.time.toFixed(2));
    this.canvas.setAttribute("aria-valuetext", `${fmtTime(this.time)} of ${fmtTime(this.total)}`
      + (this.sel ? `, ${(this.sel.end - this.sel.start).toFixed(2)} seconds selected` : ""));
  }

  // Each layer's lane under the waveform, its clips as blocks with their names and fades.
  // EQ changes as small diamonds: the song's along the bottom of the waveform, a layer's in its lane.
  drawChanges(col) {
    const { ctx, w } = this;
    ctx.save();
    for (const c of this.allChanges()) {
      const x = this.x(c.at), y = this.changeY(c.ch);
      if (x < -6 || x > w + 6) continue;
      const picked = this.chgSel?.ch === c.ch && this.chgSel?.i === c.i, r = picked ? 6 : 5;
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      ctx.fillStyle = c.ch < 0 ? col("--text") : `hsl(${LAYER_HUES[c.ch % 4]} 65% 40%)`;
      ctx.fill();
      ctx.strokeStyle = picked ? col("--accent") || col("--text") : col("--panel");
      ctx.lineWidth = picked ? 2 : 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLayers(col) {
    const { ctx, w } = this;
    if (!this.layers.length) return;
    const placed = this.placed();
    ctx.save();
    ctx.font = "11px system-ui, sans-serif";
    this.layers.forEach((l, i) => {
      const y = WAVE_B + i * LANE_H;
      ctx.fillStyle = col(i % 2 ? "--track-alt" : "--track") || col("--panel");
      ctx.fillRect(0, y, w, LANE_H);
      ctx.fillStyle = col("--line");
      ctx.fillRect(0, y, w, 1);
      const hue = LAYER_HUES[i % 4];
      for (const p of placed.filter((q) => q.layer === i)) {
        const c = l.clips[p.clip], x0 = this.x(p.at), x1 = this.x(Math.min(p.at + p.length, this.total));
        if (x1 < 0 || x0 > w) continue;
        const picked = this.clipSel?.layer === i && this.clipSel?.clip === p.clip;
        const gone = !this.sources[keyOf(c.song)];
        const top = y + 3, bot = y + LANE_H - 3, cx0 = Math.max(0, x0), cx1 = Math.min(w, x1);
        ctx.fillStyle = gone ? col("--line") : `hsl(${hue} 65% 50% / 0.35)`;
        ctx.fillRect(x0, top, Math.max(2, x1 - x0), bot - top);
        // Its song's sections, tinted, where it's been detected.
        const secs = this.infos[keyOf(c.song)]?.sections || [];
        const secNames = [...new Set(secs.map((x) => x.label))];
        const toX = (t) => this.x(p.at + (t - c.start) / p.speed);
        for (const sec of secs) {
          const s0 = Math.max(cx0, toX(sec.start)), s1 = Math.min(cx1, toX(sec.end));
          if (s1 <= s0) continue;
          ctx.fillStyle = sectionTint(secNames, sec.label, sec.color);
          ctx.globalAlpha = SECTION_ALPHA;
          ctx.fillRect(s0, top, s1 - s0, bot - top);
          ctx.globalAlpha = 1;
        }
        // Its own waveform, from the audio it plays (stretched, if it's matching the tempo).
        const src = this.sources[sourceKey(c, p.speed)];
        if (src && !gone) {
          const key = sourceKey(c, p.speed);
          if (this.clipPeaks?.src !== this.sources) this.clipPeaks = { src: this.sources, by: {} };
          const pk = (this.clipPeaks.by[key] ??= peaks(src));
          const rate = this.audio.sampleRate, spp = (this.view.span * rate) / w, mid = (top + bot) / 2 + 5, amp = (bot - top) / 2 - 7;
          ctx.fillStyle = col("--wave");
          for (let px = Math.floor(cx0); px < cx1; px++) {
            const s0 = Math.floor((c.start / p.speed + (this.view.start + px * (this.view.span / w) - p.at)) * rate);
            const b0 = Math.max(0, Math.floor(s0 / BLOCK)), b1 = Math.min(pk.length, Math.max(b0 + 1, Math.ceil((s0 + spp) / BLOCK)));
            let m = 0;
            for (let b = b0; b < b1; b++) if (pk[b] > m) m = pk[b];
            const hgt = Math.max(0.5, m * amp);
            ctx.fillRect(px, mid - hgt, 1, hgt * 2);
          }
        }
        // Fades as slopes in the corners.
        ctx.fillStyle = `hsl(${hue} 65% 30% / 0.6)`;
        const xe = this.x(p.at + p.length); // its real end, past x1 if it runs over the song's end
        const fi = this.x(p.at + c.fadeIn) - x0, fo = xe - this.x(p.at + p.length - c.fadeOut);
        if (fi > 1) { ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(x0 + fi, top); ctx.lineTo(x0, bot); ctx.fill(); }
        if (fo > 1 && xe - fo < x1) { ctx.beginPath(); ctx.moveTo(xe, top); ctx.lineTo(xe - fo, top); ctx.lineTo(xe, bot); ctx.fill(); }
        ctx.strokeStyle = `hsl(${hue} 65% 40%)`;
        ctx.strokeRect(x0 + 0.5, top + 0.5, Math.max(2, x1 - x0) - 1, bot - top - 1);
        if (picked) { ctx.strokeStyle = col("--text"); ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, top + 1, Math.max(2, x1 - x0) - 2, bot - top - 2); ctx.lineWidth = 1; }
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, y, Math.max(0, x1 - x0 - 2), LANE_H); ctx.clip();
        ctx.fillStyle = col("--text");
        ctx.fillText(nameOf(c.song).replace(/\.[^.]+$/, "") + (gone ? " (missing)" : ""), Math.max(x0, 0) + 5, top + 12);
        ctx.restore();
      }
      // The layer's name at the left, over a faint backing so it reads over clips.
      const label = l.name;
      const lw = ctx.measureText(label).width + 8;
      ctx.fillStyle = col("--panel");
      ctx.globalAlpha = 0.8;
      ctx.fillRect(0, y + 1, lw, 13);
      ctx.globalAlpha = 1;
      ctx.fillStyle = col("--muted");
      ctx.fillText(label, 4, y + 11);
    });
    ctx.restore();
  }

  // input ---------------------------------------------------------------------
  inLane(y) { return y >= RULER_H + BEAT_H && y < RULER_H + BEAT_H + SEC_H; }

  // The section edge (index of the section it starts) within reach of x, or -1.
  edgeNear(x) {
    const secs = this.sections || [];
    return secs.findIndex((s, i) => i > 0 && Math.abs(x - this.x(s.start)) < EDGE_PX);
  }

  // The join whose ✂ grip in the ruler is under (x, y): the index of the piece after it, or -1.
  joinAt(x, y) {
    if (y >= RULER_H) return -1;
    const i = joins(this.pieces, this.crossfade).findIndex((j) => Math.abs(this.x(j) - x) <= 10);
    return i < 0 ? -1 : i + 1;
  }

  // Picks a join (its panel opens under the waveform) and plays a few seconds either side of it.
  hearJoin(i) {
    const j = joins(this.pieces, this.crossfade)[i - 1];
    if (j === undefined) return;
    this.joinSel = i;
    this.sel = null;
    this.time = j;
    this.updateControls();
    this.play(Math.max(0, j - 3), Math.min(this.total, j + 3));
  }

  renderJoin() {
    const info = this.joinSel > 0 ? joinInfo(this.pieces, this.joinSel) : null;
    $("music-join").hidden = !info;
    if (!info) return;
    const at = joins(this.pieces, this.crossfade)[this.joinSel - 1];
    const song = nameOf(this.refs[info.src] || { path: "" }).replace(/\.[^.]+$/, "");
    $("music-join-what").textContent = info.kind === "cut"
      ? `Cut at ${fmtTime(at)}: ${(info.to - info.from).toFixed(2)} s of ${song} taken out (its ${fmtTime(info.from)} to ${fmtTime(info.to)})`
      : `Join at ${fmtTime(at)}: ${song} starts here`;
    $("music-join-adjust").hidden = $("music-join-back").hidden = info.kind !== "cut";
  }

  // Puts the picked cut's part back; with select, it's selected so its edges can be moved and cut again.
  putJoinBack(select) {
    const got = putBack(this.pieces, this.crossfade, this.joinSel);
    if (!got) return;
    this.edit(got.pieces);
    this.sel = select ? { start: got.start, end: got.end } : null;
    this.time = got.start;
    if (select) this.zoomTo(Math.max(0, got.start - 4), Math.min(this.total, got.end + 4));
    this.updateControls();
    this.draw();
    this.host.status(select ? "The cut part is back and selected: drag its edges (or type the times), then press Cut selection"
      : "Put the cut part back. Ctrl+Z takes it out again", select ? "hint" : "saved");
  }

  down(e) {
    if (!this.rendered) return;
    const x = e.offsetX, t = Math.min(Math.max(this.t(x), 0), this.total);
    const join = this.joinAt(x, e.offsetY);
    if (join > 0) { this.drag = null; this.hearJoin(join); return; }
    this.canvas.setPointerCapture(e.pointerId);
    // An EQ change's diamond: pick it (the playhead goes to it and its faders show), or drag it.
    const chg = this.changeAt(x, e.offsetY);
    if (chg) {
      this.chgSel = { ch: chg.ch, i: chg.i };
      this.clipSel = null;
      this.eqCh = chg.ch < 0 ? "song" : chg.ch;
      this.drag = { change: chg, x, moved: false, before: this.channelEq(chg.ch) };
      this.updateControls();
      this.draw();
      return;
    }
    this.chgSel = null;
    if (this.laneAt(e.offsetY) >= 0) {
      const hit = this.clipAt(x, e.offsetY);
      if (!hit) { // an empty bit of a lane: move the playhead, as on the waveform
        this.clipSel = null;
        this.drag = { anchor: t, x, moved: false };
        return;
      }
      const clip = this.layers[hit.layer].clips[hit.clip];
      this.clipSel = { layer: hit.layer, clip: hit.clip };
      this.drag = { clip: hit, orig: clip, t0: t, x, moved: false, before: this.layers };
      this.updateControls();
      this.draw();
      return;
    }
    const mark = this.markAt(x, e.offsetY);
    if (mark >= 0) {
      this.drag = { mark, base: this.info?.marks || [], shown: this.marks, x, moved: false };
      return;
    }
    if (this.inLane(e.offsetY) && this.shown) {
      const edge = this.sections ? this.edgeNear(x) : -1;
      if (edge > 0) { this.drag = { section: edge, before: this.sections }; return; }
      // A click selects the section's stretch of song, ready to cut; Shift-click extends it.
      const secs = this.shown.sections, i = sectionAt(secs, t);
      this.drag = null;
      if (i < 0) return;
      const sec = secs[i];
      this.sel = e.shiftKey && this.sel
        ? { start: Math.min(this.sel.start, sec.start), end: Math.max(this.sel.end, sec.end) }
        : { start: sec.start, end: sec.end };
      this.secSel = this.sections ? i : -1;
      if (this.secSel >= 0) this.markSel = -1;
      this.updateControls();
      this.draw();
      return;
    }
    if (this.sel && Math.abs(x - this.x(this.sel.start)) < EDGE_PX) this.drag = { edge: "start" };
    else if (this.sel && Math.abs(x - this.x(this.sel.end)) < EDGE_PX) this.drag = { edge: "end" };
    else this.drag = { anchor: this.snap(t, e), x, moved: false };
  }

  move(e) {
    const x = e.offsetX, raw = Math.min(Math.max(this.t(x), 0), this.total), d = this.drag;
    const t = d && !d.section ? this.snap(raw, e) : raw;
    if (d?.change) {
      if (!d.moved && Math.abs(x - d.x) < 3) return;
      d.moved = true;
      const anchor = anchorAt(this.pieces, this.crossfade, Math.min(t, this.total - 0.01), this.refs);
      if (!anchor) return;
      const eq = { ...d.before, changes: d.before.changes.map((c, k) => (k === d.change.i ? { ...c, anchor } : c)) };
      if (d.change.ch < 0) this.eq = eq;
      else this.layers = this.layers.map((l, k) => (k === d.change.ch ? { ...l, eq } : l));
      this.draw();
      return;
    }
    if (d?.clip) {
      if (!d.moved && Math.abs(x - d.x) < 3) return;
      d.moved = true;
      const { clip, orig } = d, rate = this.audio.sampleRate, len = this.sources[keyOf(orig.song)]?.[0].length / rate || orig.end;
      let next = orig;
      if (clip.part === "body") {
        const at = this.snap(clip.at + (raw - d.t0), e);
        const anchor = anchorAt(this.pieces, this.crossfade, Math.max(0, at), this.refs);
        if (anchor) next = { ...orig, anchor };
      } else if (clip.part === "start") {
        // Trims are in the song's time; a clip played faster or slower moves through its audio at its speed.
        const sp = clip.speed || 1;
        const delta = Math.max(-orig.start / sp, -clip.at, Math.min((orig.end - orig.start - 0.05) / sp, this.snap(clip.at + (raw - d.t0), e, 6) - clip.at));
        const anchor = anchorAt(this.pieces, this.crossfade, Math.max(0, clip.at + delta), this.refs);
        if (anchor) next = { ...orig, start: orig.start + delta * sp, anchor };
      } else {
        const endAt = this.snap(clip.at + clip.length + (raw - d.t0), e, 6);
        next = { ...orig, end: Math.max(orig.start + 0.05, Math.min(len, orig.start + (endAt - clip.at) * (clip.speed || 1))) };
      }
      const r3 = (v) => Math.round(v * 1000) / 1000;
      next = { ...next, start: r3(next.start), end: r3(next.end) };
      this.layers = d.before.map((l, k) => (k !== clip.layer ? l : { ...l, clips: l.clips.map((c, j) => (j === clip.clip ? next : c)) }));
      this.draw();
      return;
    }
    if (!d && this.changeAt(x, e.offsetY)) {
      this.canvas.style.cursor = "grab";
      this.canvas.title = "An EQ change: click to see its faders, drag to move it";
      return;
    }
    if (!d && this.laneAt(e.offsetY) >= 0) {
      const hit = this.clipAt(x, e.offsetY);
      this.canvas.style.cursor = !hit ? "text" : hit.part === "body" ? "grab" : "ew-resize";
      this.canvas.title = hit ? "Drag to move this clip, or its ends to trim it" : "";
      return;
    }
    if (d?.mark !== undefined) {
      if (!d.moved && Math.abs(x - d.x) < 3) return;
      d.moved = true;
      const moved = moveMark(d.shown, d.mark, t);
      const { marks, index } = this.marksFrom(moved.marks, moved.index, d.base, d.shown);
      this.info = { ...this.info, marks };
      d.now = index;
      this.draw();
      return;
    }
    if (!d) {
      if (this.markAt(x, e.offsetY) >= 0) {
        this.canvas.style.cursor = "grab";
        this.canvas.title = `${this.marks?.[this.markAt(x, e.offsetY)]?.label || "Mark"}: click to edit, drag to move`;
        return;
      }
      if (this.joinAt(x, e.offsetY) > 0) { this.canvas.style.cursor = "pointer"; this.canvas.title = "Hear this join, and change or undo its cut"; return; }
      this.canvas.title = "";
      const lane = this.inLane(e.offsetY) && this.shown;
      const near = lane ? this.sections && this.edgeNear(x) > 0
        : this.sel && [this.sel.start, this.sel.end].some((s) => Math.abs(x - this.x(s)) < EDGE_PX);
      this.canvas.style.cursor = near ? "ew-resize" : lane ? "pointer" : "text";
      return;
    }
    if (d.section) {
      this.info = { ...this.info, sections: moveEdge(d.before, d.section, t) };
      this.renderSection();
      this.draw();
      return;
    }
    if (d.edge) {
      const other = d.edge === "start" ? this.sel.end : this.sel.start;
      this.sel = { start: Math.min(t, other), end: Math.max(t, other) };
      d.edge = t < other ? "start" : "end";
    } else {
      if (!d.moved && Math.abs(x - d.x) < 3) return;
      d.moved = true;
      this.clipSel = this.chgSel = null; // Delete now means the new selection, not the clip or change picked before it
      this.sel = { start: Math.min(t, d.anchor), end: Math.max(t, d.anchor) };
    }
    this.updateControls();
    this.draw();
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (d?.section) { this.editSections(this.info.sections); return; }
    if (d?.change) {
      const ch = d.change.ch;
      if (d.moved && this.channelEq(ch) !== d.before) {
        const after = this.channelEq(ch);
        if (ch < 0) this.eq = d.before; // so Undo goes back to before the drag
        else this.layers = this.layers.map((l, k) => (k === ch ? { ...l, eq: d.before } : l));
        this.editEq(ch, after);
      } else {
        this.time = d.change.at;
        this.updateControls();
        this.draw();
      }
      return;
    }
    if (d?.clip) {
      if (d.moved) {
        const after = this.layers;
        this.layers = d.before; // so Undo goes back to before the drag
        this.editLayers(after);
      } else {
        this.time = Math.min(Math.max(d.t0, d.clip.at), d.clip.at + d.clip.length); // where you clicked, ready to Split
        this.updateControls();
        this.draw();
      }
      return;
    }
    if (d?.mark !== undefined) {
      if (d.moved) {
        this.markSel = this.shownMark(d.now);
        if (this.markSel >= 0) this.secSel = -1;
        this.saveInfoSoon();
        return;
      }
      // A click picks the mark and puts the playhead on it.
      this.markSel = d.mark;
      this.secSel = -1;
      this.time = this.marks[d.mark].t;
      this.updateControls();
      this.draw();
      return;
    }
    if (!d || d.edge || d.moved) return;
    // A click only moves the playhead: the selection stays, so it can still be heard or cut.
    this.time = Math.min(Math.max(this.t(e.offsetX), 0), this.total);
    if (this.playing) this.play(this.time);
    this.updateControls();
    this.draw();
  }

  wheel(e) {
    if (!this.rendered) return;
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = ((e.shiftKey ? e.deltaY : e.deltaX) / this.w) * this.view.span;
      this.view.start = Math.min(Math.max(this.view.start + d, 0), Math.max(this.total - this.view.span, 0));
      this.draw();
    } else {
      this.zoom(e.deltaY > 0 ? 1.25 : 0.8, this.t(e.offsetX));
    }
  }

  setSelEdge(which, value) {
    if (!this.sel) return;
    const v = Math.min(Math.max(Number(value) || 0, 0), this.total);
    const s = { ...this.sel, [which]: v };
    this.sel = { start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) };
    this.updateControls();
    this.draw();
  }

  key(e) {
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); this.save(); return true; }
    if (typing || document.querySelector("dialog[open]")) return false;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); this.undo(e.shiftKey ? 1 : -1); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); this.undo(1); }
    else if (e.key === " ") { e.preventDefault(); this.playing ? this.stop() : this.play(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && this.clipSel) { e.preventDefault(); this.deleteClip(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && this.chgSel && this.channelEq(this.chgSel.ch)?.changes?.[this.chgSel.i]) { e.preventDefault(); this.deleteChange(this.chgSel.ch, this.chgSel.i); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.cutSelection(); }
    else if (!mod && (e.key === "s" || e.key === "S") && this.layers.length) { e.preventDefault(); this.splitClip(); }
    else if (!mod && (e.key === "m" || e.key === "M")) { e.preventDefault(); this.addMarkHere({ open: !this.playing }); }
    else if (e.key === "Home") this.seek(0);
    else if (e.key === "End") this.seek(this.total);
    else if (!mod && (e.key === "," || e.key === "<")) this.skip(-1);
    else if (!mod && (e.key === "." || e.key === ">")) this.skip(1);
    else if (e.key === "+" || e.key === "=") this.zoom(0.66);
    else if (e.key === "-") this.zoom(1.5);
    else if (e.key === "Escape") { this.sel = null; this.kbAnchor = null; this.markSel = this.joinSel = -1; this.clipSel = this.chgSel = null; this.updateControls(); this.draw(); }
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && document.activeElement === this.canvas && this.rendered) {
      e.preventDefault();
      this.arrow(e.key === "ArrowRight" ? 1 : -1, e.shiftKey);
    }
    else return false;
    return true;
  }

  // The next beat (or second, before Detect) from the playhead in `dir`; with Shift, the selection
  // stretches from where it started to there.
  arrow(dir, extend) {
    const beats = this.shown?.beats?.length ? this.shown.beats : null;
    const t = this.time;
    let next = beats
      ? (dir > 0 ? beats.find((b) => b > t + 1e-3) : beats.findLast((b) => b < t - 1e-3))
      : t + dir;
    next = Math.min(Math.max(next ?? (dir > 0 ? this.total : 0), 0), this.total);
    if (extend) {
      if (!this.sel || this.kbAnchor == null) this.kbAnchor = this.sel ? (Math.abs(t - this.sel.end) < 1e-3 ? this.sel.start : this.sel.end) : t;
      this.sel = next === this.kbAnchor ? null : { start: Math.min(next, this.kbAnchor), end: Math.max(next, this.kbAnchor) };
      this.clipSel = this.chgSel = null; // Delete now means this selection
    } else {
      this.kbAnchor = null;
    }
    this.time = next;
    if (this.playing && !extend) this.play(this.time);
    this.follow();
    this.updateControls();
    this.draw();
  }

  wire() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.down(e));
    c.addEventListener("pointermove", (e) => this.move(e));
    c.addEventListener("pointerup", (e) => this.up(e));
    c.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    $("music-insert-upload").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      const ref = f && await this.upload(f);
      if (ref) $("music-insert-src").value = JSON.stringify(ref);
    });
    this.host.volume?.bind($("music-volume"), (g) => { if (this.gainNode) this.gainNode.gain.value = g; });
    $("music-play").addEventListener("click", () => (this.playing ? this.stop() : this.play()));
    $("music-home").addEventListener("click", () => this.seek(0));
    $("music-back").addEventListener("click", () => this.skip(-1));
    $("music-fwd").addEventListener("click", () => this.skip(1));
    $("music-play-sel").addEventListener("click", () => this.sel && this.play(this.sel.start, this.sel.end));
    $("music-preview").addEventListener("click", () => this.previewCut());
    $("music-cut").addEventListener("click", () => this.cutSelection());
    $("music-keep").addEventListener("click", () => this.keepSelection());
    $("music-sample").addEventListener("click", () => this.saveSample());
    $("music-insert").addEventListener("click", () => this.addSong(false));
    $("music-append").addEventListener("click", () => this.addSong(true));
    $("music-undo").addEventListener("click", () => this.undo(-1));
    $("music-redo").addEventListener("click", () => this.undo(1));
    $("music-zoom-in").addEventListener("click", () => this.zoom(0.66));
    $("music-zoom-out").addEventListener("click", () => this.zoom(1.5));
    $("music-fit").addEventListener("click", () => this.fit());
    $("music-zoom-sel").addEventListener("click", () => this.sel && this.zoomTo(this.sel.start, this.sel.end));
    $("music-sel-clear").addEventListener("click", () => { this.sel = null; this.kbAnchor = null; this.updateControls(); this.draw(); });
    $("music-sel-start").addEventListener("change", (e) => this.setSelEdge("start", e.target.value));
    $("music-sel-end").addEventListener("change", (e) => this.setSelEdge("end", e.target.value));
    for (const id of ["music-xf", "music-fadein", "music-fadeout"]) {
      $(id).addEventListener("change", () => {
        this.stop();
        if (!this.pieces.length) return;
        this.dirty = true;
        this.changed();
        this.draftChanged();
      });
    }
    $("music-save").addEventListener("click", () => this.save());
    // Even out the volume is remembered in this browser (on unless you turn it off).
    try { $("music-even").checked = localStorage.getItem("halidayshow.evenVolume") !== "false"; } catch { /* private mode */ }
    $("music-even").addEventListener("change", (e) => {
      try { localStorage.setItem("halidayshow.evenVolume", String(e.target.checked)); } catch { /* private mode */ }
    });
    // Renaming a draft keeps it; before there's a draft, it's only the name it will get.
    $("music-name").addEventListener("change", () => { if (this.draft) this.draftChanged(); });
    $("music-detect").addEventListener("click", () => this.detect());
    $("music-describe").addEventListener("click", () => this.describe());
    $("music-suggest").addEventListener("click", () => this.openCuts(this.secSel >= 0 ? this.secSel : null));
    $("music-cuts-scope").addEventListener("change", () => { this.cutNote(""); this.defaultCutTarget(); });
    $("cuts-form").addEventListener("submit", (e) => { e.preventDefault(); this.findCuts(); });
    $("cuts-back").addEventListener("click", () => { this.closeCuts(); this.cutStep(1); });
    for (const b of document.querySelectorAll("[data-cuts=cancel]")) b.addEventListener("click", () => $("cuts-dialog").close());
    $("cuts-dialog").addEventListener("close", () => this.closeCuts());
    this.wireSections();
    this.wireMarks();
    this.wireLayers();
    // Some browsers (older Safari, the Home Assistant app on iPhone) also need returnValue to ask.
    // Leaving the page sends a waiting change in a way that outlives the page; it only asks first if a
    // change is already on its way (and might be cut off) or couldn't be kept.
    window.addEventListener("beforeunload", (e) => {
      const busy = this.keeper.session.sending > 0;
      this.flush({ keepalive: true });
      if (busy || this.keeper.anyFailed) { e.preventDefault(); e.returnValue = ""; }
    });
    // Phones often close a page without beforeunload; going to the background is the last chance.
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.flush({ keepalive: true }); });
    window.addEventListener("pagehide", () => this.flush({ keepalive: true }));
  }

  show() {
    this.fillSongLists();
    this.layout();
    this.loadSamples();
  }

  hide() { this.stop(); }
}

// Loudest sample in each block of BLOCK samples, across channels.
function peaks(channels) {
  const n = Math.ceil((channels[0]?.length || 0) / BLOCK);
  const out = new Float32Array(n);
  for (const ch of channels) {
    for (let b = 0; b < n; b++) {
      let m = out[b];
      for (let s = b * BLOCK, e = Math.min(s + BLOCK, ch.length); s < e; s++) {
        const v = Math.abs(ch[s]);
        if (v > m) m = v;
      }
      out[b] = m;
    }
  }
  return out;
}
