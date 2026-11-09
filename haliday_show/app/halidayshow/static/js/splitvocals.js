// Split into parts, from a song's row in Library → Songs or the Music editor: the song decoded at the
// models' rate, split in a worker (stemsworker.js, stems.js) into its vocals, drums, bass and the rest,
// and kept with the song as its parts (Storage.song_parts), ready for Singing faces, Generate and layers.

import { MDX } from "./stems.js";
import { drumHits } from "./drumhits.js";
import { soundsFrom } from "./sounds.js";
import { fetchSong, plainError, retrying, songLoadMessage } from "./songload.js";
import { sendParts } from "./upload.js";
import { alignLyrics } from "./align.js";

export const stemNames = (path) => {
  const base = path.split("/").pop().replace(/\.[^.]+$/, "");
  return { vocals: `${base} (vocals).wav`, music: `${base} (music).wav` };
};

// 16-bit stereo WAV.
export function wav16(channels, rate) {
  const n = channels[0].length, data = n * channels.length * 2;
  const buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const text = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  text(0, "RIFF"); v.setUint32(4, 36 + data, true); text(8, "WAVE"); text(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels.length, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels.length * 2, true);
  v.setUint16(32, channels.length * 2, true); v.setUint16(34, 16, true); text(36, "data"); v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const ch of channels) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

// Keeps `channels` (at `rate`) as the song's `part`, a WAV sent in pieces. Returns where it's kept.
export function savePart(api, ref, part, channels, rate, progress = null) {
  const q = new URLSearchParams({ source: ref.source, path: ref.path, part });
  const blob = new Blob([wav16(channels, rate)], { type: "audio/wav" });
  // Each try is a fresh upload, so a piece that half-arrived before the connection dropped doesn't matter.
  return retrying(() => sendParts(api, `api/audio/parts?${q}`, blob, {}, progress));
}

let busy = false;
const MAX_MINUTES = 8; // longer songs need more memory than a phone or tablet has for this

// A window over the page while the split runs (it takes minutes): a spinner, what's happening, how far
// along, and Cancel. Esc cancels too. Returns {say(text, done 0-1 or null), close()}.
export function progressWindow(title, onCancel, note = "It runs in this browser, so keep this page open until it's done. The song isn't changed: "
    + "its parts are kept with it.") {
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text ? { textContent: text } : {});
  const dlg = el("dialog", "effect-dialog busy-dialog");
  dlg.setAttribute("aria-labelledby", "split-busy-title");
  const h = el("h3", "", title);
  h.id = "split-busy-title";
  const row = el("p", "busy-row"), text = el("span");
  text.setAttribute("aria-live", "polite");
  row.append(el("span", "spinner"), text);
  const bar = el("progress", "busy-progress");
  bar.max = 1;
  const hint = el("p", "hint", note);
  const cancel = el("button", "ghost", "Cancel");
  cancel.type = "button";
  let locked = false;
  cancel.addEventListener("click", () => { if (!locked) onCancel(); });
  const actions = el("div", "insp-actions");
  actions.append(cancel);
  dlg.append(h, row, bar, hint, actions);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); if (!locked) onCancel(); });
  document.body.append(dlg);
  dlg.showModal();
  return {
    say(t, done = null) {
      text.textContent = t;
      if (done == null) bar.removeAttribute("value"); else bar.value = done;
    },
    // Saving can't be stopped part way, so Cancel goes once it starts.
    lock() { locked = true; cancel.disabled = true; hint.textContent = "Saving the last parts with the song. Nearly done."; },
    close() { if (dlg.open) dlg.close(); dlg.remove(); },
  };
}

const PART_WORDS = { vocals: "vocals", music: "music", drums: "drums", bass: "bass", rest: "rest of the music" };
export const PARTS = ["vocals", "drums", "bass", "rest"]; // a song with all of these is prepared
export const prepared = (parts) => PARTS.every((p) => parts?.[p]);
const q = (ref) => new URLSearchParams({ source: ref.source, path: ref.path });
const songName = (ref) => ref.path.split("/").pop().replace(/\.[^.]+$/, "");

// Decodes a song (or a part) at the models' rate, as two channels.
async function decodeAt(ref, path = ref.path) {
  const bytes = await fetchSong(`api/audio/file?source=${encodeURIComponent(ref.source)}&path=${encodeURIComponent(path)}`);
  const d = await new OfflineAudioContext(2, 1, MDX.rate).decodeAudioData(bytes);
  const l = Float32Array.from(d.getChannelData(0));
  return [l, d.numberOfChannels > 1 ? Float32Array.from(d.getChannelData(1)) : Float32Array.from(l)];
}

const mono = ([l, r]) => l.map((v, i) => (v + (r || l)[i]) / 2);
const rms = (x) => { let s = 0; for (let i = 0; i < x.length; i += 7) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length / 7)); };

// A song file made from a draft whose original has all its parts: each part cut from the original's
// the way the draft cuts the song, in seconds, rather than split again by the AI. edit: {pieces (each
// {src: "source:path", start, end}), crossfade, fadeIn, fadeOut, base, baseParts}. The file's volume may
// have been evened out when it was made: its parts are matched to it.
async function cutFromOriginal(ref, api, edit, say, cancelled) {
  const check = () => { if (cancelled()) throw new Error("cancelled"); };
  const { render } = await import("./music.js"); // music.js uses this module too
  const baseKey = `${edit.base.source}:${edit.base.path}`;
  if (edit.pieces.some((p) => p.src !== baseKey)) return false; // other songs spliced in: split it instead
  const pieces = edit.pieces.map((p) => ({ ...p, src: "song" }));
  const opts = { crossfade: edit.crossfade || 0, fadeIn: edit.fadeIn || 0, fadeOut: edit.fadeOut || 0 };
  say(`Cutting ${songName(ref)}'s parts from ${songName(edit.base)}…`, null);
  const [file, base] = await Promise.all([decodeAt(ref), decodeAt(edit.base)]);
  check();
  const mix = render(pieces, { song: base }, MDX.rate, opts);
  if (Math.abs(mix[0].length - file[0].length) > MDX.rate / 2) return false; // the draft's changed since
  const k = rms(file[0]) / Math.max(1e-9, rms(mix[0]));
  if (!(k > 0.25 && k < 4)) return false; // not the same song any more, or silent: split it instead
  for (const part of [...PARTS, "music"]) {
    if (!edit.baseParts[part]) continue;
    check();
    const ch = render(pieces, { song: await decodeAt(edit.base, edit.baseParts[part]) }, MDX.rate, opts);
    check();
    if (Math.abs(k - 1) > 0.01) for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= k;
    await savePart(api, ref, part, ch, MDX.rate);
    if (part === "drums") await api(`api/audio/drums?${q(ref)}`, { method: "PUT", json: drumHits(mono(ch), MDX.rate) }).catch(() => {});
  }
  return true;
}

// Where the split is running, for the progress line: the graphics chip, or the processor (much slower).
// gaveUp: the graphics chip started but stopped part way, usually for want of memory.
export const routeWords = (via, gaveUp = false) => via === "gpu" ? " · on the graphics chip"
  : via !== "cpu" ? ""
  : gaveUp ? " · on the processor, which is slower: the graphics chip ran out of memory, so close other apps and tabs, then split again"
  : " · on the processor, which is slower";

// Line up with the singing: `lines` (lyrics.js parseLyrics) placed word by word where they're sung, by an
// English speech model listening to the song's vocals part (or the whole song, less surely, when it has no
// parts yet). say(text, done 0-1 or null) hears how it's going. Returns {lines (each with start, end and
// times), vocals: whether the vocals part was used}, or null when the words can't be fitted to the song.
// signal: an AbortSignal that stops it (it then rejects with an error marked `cancelled`).
export async function lineUpLyrics(ref, api, lines, say = () => {}, signal = null) {
  const cancelled = () => Object.assign(new Error("cancelled"), { cancelled: true });
  const check = () => { if (signal?.aborted) throw cancelled(); };
  const parts = await api(`api/audio/parts?${q(ref)}`).catch(() => ({}));
  check();
  const path = parts?.vocals || ref.path;
  say("Loading the singing…", null);
  // Cancel stops the download too (an aborted fetch isn't a dropped connection, so it isn't tried again).
  const bytes = await fetchSong(`api/audio/file?source=${encodeURIComponent(ref.source)}&path=${encodeURIComponent(path)}`,
    (u) => fetch(u, signal ? { signal } : {})).catch((e) => { check(); throw e; });
  check();
  const d = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes);
  check();
  const samples = new Float32Array(d.length);
  for (let c = 0; c < d.numberOfChannels; c++) {
    const ch = d.getChannelData(c);
    for (let i = 0; i < ch.length; i++) samples[i] += ch[i] / d.numberOfChannels;
  }
  const worker = new Worker(new URL("./stemsworker.js", import.meta.url), { type: "module" });
  try {
    check();
    const logp = await new Promise((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(cancelled()), { once: true });
      worker.onmessage = ({ data }) => {
        if (data.error) reject(new Error(data.error));
        else if (data.logp) resolve(data.logp);
        else if (data.stage === "download") say(`Downloading the AI that hears the words (the first time only)… ${Math.round(data.done * 100)}%`, data.done);
        else if (data.stage === "align") say(`Listening for the words… ${Math.round(data.done * 100)}%`, data.done);
      };
      worker.onerror = (e) => reject(new Error(e.message || "the AI couldn't start in this browser"));
      worker.postMessage({ align: samples }, [samples.buffer]);
    });
    check();
    say("Placing the words…", null);
    const placed = alignLyrics(logp, lines);
    return placed && { lines: placed, vocals: !!parts?.vocals };
  } finally {
    worker.terminate();
  }
}

// Listens to the whole song with YAMNet (in the worker) for what can be heard in it (sounds.js), and
// keeps that with the song. Takes seconds. track(worker) is given the worker, so it can be stopped.
async function listenTo(ref, api, say, track) {
  const song = songName(ref);
  say(`Listening to ${song}…`, null);
  const bytes = await fetchSong(`api/audio/file?source=${encodeURIComponent(ref.source)}&path=${encodeURIComponent(ref.path)}`);
  const d = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes);
  const samples = new Float32Array(d.length);
  for (let c = 0; c < d.numberOfChannels; c++) {
    const ch = d.getChannelData(c);
    for (let i = 0; i < ch.length; i++) samples[i] += ch[i] / d.numberOfChannels;
  }
  const worker = new Worker(new URL("./stemsworker.js", import.meta.url), { type: "module" });
  track(worker);
  try {
    const scores = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.error) reject(new Error(data.error));
        else if (data.scores) resolve(data.scores);
        else if (data.stage === "download") say(`Downloading the AI that listens to songs (the first time only)… ${Math.round(data.done * 100)}%`, data.done);
        else if (data.stage === "listen") say(`Listening to ${song}… ${Math.round(data.done * 100)}%`, data.done);
      };
      worker.onerror = (e) => reject(new Error(e.message || "the AI couldn't start in this browser"));
      worker.postMessage({ listen: samples }, [samples.buffer]);
    });
    await api(`api/audio/sounds?${q(ref)}`, { method: "PUT", json: soundsFrom(scores, d.duration) });
  } finally {
    worker.terminate();
  }
}

// Makes a song's parts (its vocals, drums, bass and the rest of the music, and the music without its
// vocals), keeping each with the song as soon as it's made, so one stopped part way keeps what it
// finished, then when each drum lands (drumhits.js), then listens to it for what can be heard in it
// (sounds.js). A song with all its parts that hasn't been listened to is only listened to. Parts it has already (vocals from before 0.2.403,
// say) aren't made again, unless `again`. An edit of a song with parts (edit: see cutFromOriginal) has
// its parts cut from the original's instead. say(text, done 0-1 or null) hears how it's going;
// started(stop) is given a function that stops it. One song at a time: anything else waits its turn.
let turn = Promise.resolve(), waiting = 0;
export function makeParts(ref, api, { again = false, edit = null, listenOnly = false, cutOnly = false, say = () => {}, started = () => {} } = {}) {
  waiting++;
  const run = () => makePartsNow(ref, api, { again, edit, listenOnly, cutOnly, say, started });
  const mine = turn.then(run, run).finally(() => { waiting--; });
  turn = mine.catch(() => {});
  return mine;
}

// cutOnly: an edit whose parts are only to be cut from its original's (never split by the AI).
async function makePartsNow(ref, api, { again, edit, listenOnly, cutOnly, say, started }) {
  busy = true;
  let worker = null, cancelled = false, stop = null;
  const stopped = new Promise((_, reject) => { stop = reject; });
  stopped.catch(() => {});
  const unlessCancelled = (p) => Promise.race([p, stopped]);
  let listener = null;
  started(() => { cancelled = true; worker?.terminate(); listener?.terminate(); stop(new Error("cancelled")); });
  const song = songName(ref);
  // Listening comes last, and a song whose parts were made isn't failed for it: it's tried again next time.
  const listen = async (must) => {
    try { await unlessCancelled(listenTo(ref, api, say, (w) => { listener = w; })); return true; } catch (e) {
      if (must || cancelled) throw e;
      console.warn(`Couldn't listen to ${song}`, e);
      return false;
    }
  };
  try {
    const have = await api(`api/audio/parts?${q(ref)}`).catch(() => ({}));
    const heard = !again && await api(`api/audio/sounds?${q(ref)}`).catch(() => null);
    if (!again && (prepared(have) || listenOnly)) { // listenOnly: its parts are left for later
      if (heard) return { made: false };
      await listen(true);
      return { made: false, listened: true };
    }
    if (!again && edit && prepared(edit.baseParts) && await unlessCancelled(cutFromOriginal(ref, api, edit, say, () => cancelled))) {
      return { made: true, cut: true, listened: await listen(false) };
    }
    if (cutOnly) return { made: false };
    const want = ["drums", "bass", "rest", ...(have.music && !again ? [] : ["music"])];
    say(`Loading ${song}…`, null);
    let left, right, vocals = null;
    try {
      [left, right] = await unlessCancelled(decodeAt(ref));
      if (have.vocals && !again) { // its vocals are made already: no need to find them again
        const v = await unlessCancelled(decodeAt(ref, have.vocals)).catch(() => null);
        if (v && Math.abs(v[0].length - left.length) < MDX.rate / 10) {
          vocals = v.map((c) => { const x = new Float32Array(left.length); x.set(c.subarray(0, x.length)); return x; });
        }
      }
    } catch (e) { throw cancelled ? e : new Error(songLoadMessage(e)); }
    if (left.length > MAX_MINUTES * 60 * MDX.rate) {
      throw new Error(`it's longer than ${MAX_MINUTES} minutes, more than a browser can split in one go. Cut it shorter in the Music editor first`);
    }
    worker = new Worker(new URL("./stemsworker.js", import.meta.url), { type: "module" });
    // Each part is kept with the song as it arrives, one after another, while the next is split.
    let saving = Promise.resolve(), drums = null, saveFailed = null;
    const keep = (part, ch) => {
      if (part === "drums") drums = mono(ch);
      saving = saving.then(() => savePart(api, ref, part, ch, MDX.rate)).catch((e) => { saveFailed ||= e; });
    };
    const steps = [...(vocals ? [] : ["vocals"]), "drums", "bass"];
    await unlessCancelled(new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.error) reject(new Error(data.error));
        else if (data.done === true) resolve();
        else if (data.part && data.channels) keep(data.part, data.channels);
        else if (data.stage === "download") say(`Downloading the AI for Split into parts (the first time only)… ${Math.round(data.done * 100)}%`, data.done);
        else {
          const k = steps.indexOf(data.part), whole = (Math.max(k, 0) + data.done) / steps.length;
          say(`Finding the ${PART_WORDS[data.part]} in ${song}… ${Math.round(data.done * 100)}% (${k + 1} of ${steps.length})${routeWords(data.via, data.gaveUp)}`, whole);
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || "the AI couldn't start in this browser"));
      const transfer = [left.buffer, right.buffer, ...(vocals ? vocals.map((c) => c.buffer) : [])];
      worker.postMessage({ left, right, want, vocals }, transfer);
    }));
    say(`Keeping ${song}'s parts with it…`, null);
    await saving;
    if (saveFailed) throw new Error(`couldn't keep its parts with it: ${plainError(saveFailed)}`);
    if (drums) {
      say(`Finding when each drum lands in ${song}…`, null);
      await new Promise((r) => setTimeout(r, 0));
      await api(`api/audio/drums?${q(ref)}`, { method: "PUT", json: drumHits(drums, MDX.rate) }).catch(() => {});
    }
    return { made: true, listened: await listen(false) };
  } catch (e) {
    if (cancelled) { const err = new Error("cancelled"); err.cancelled = true; throw err; }
    throw e;
  } finally {
    worker?.terminate();
    listener?.terminate();
    busy = false;
  }
}

// Whether a song is being split, or waiting its turn.
export const splitting = () => busy || waiting > 0;

// Split into parts… on a song (its row in Library → Songs, or the Music editor), with a window over the
// page saying how it's going. host: {api, status(text, kind), askYes(text, opts), songsChanged(),
// edit (as makeParts takes, or null), later(ref) (puts it next in a line of songs being split, if
// there's one)}.
export async function splitVocals(ref, host) {
  const busyNow = () => {
    if (!splitting()) return false;
    if (host.later) host.later(ref);
    else host.status("Already splitting a song into parts: try again when it's finished", "hint");
    return true;
  };
  if (busyNow()) return;
  const song = songName(ref);
  let win = null;
  try {
    const have = await host.api(`api/audio/parts?${q(ref)}`).catch(() => ({}));
    const again = prepared(have);
    if (!(await host.askYes(`Split ${song} into its parts: the vocals, drums, bass and the rest of the music? They're kept `
      + "with the song, for Singing faces, Generate and the Music editor's layers. "
      + (again ? "It has them already: this makes them again. " : "")
      + "The first time, your browser downloads the AI that does it (about 145 MB). It takes several minutes; "
      + "keep this page open meanwhile.", { yes: "Split into parts" }))) return;
    if (busyNow()) return; // another started while you were deciding
    let stop = () => {};
    win = progressWindow(`Splitting ${song}`, () => stop());
    const say = (text, done = null) => { win.say(text, done); host.status(text); };
    await makeParts(ref, host.api, { again, edit: host.edit || null, say, started: (s) => { stop = s; } });
    await host.songsChanged?.();
    host.status(`Split ${song} into its parts: vocals, drums, bass and the rest, kept with the song. Pick them as layers in the Music editor`, "saved");
  } catch (e) {
    if (e.cancelled) { host.status(`Split into parts stopped. Any part ${song} finished is kept with it`, "hint"); await host.songsChanged?.(); }
    else host.status(`Couldn't split ${song}: ${plainError(e)}`, true);
  } finally {
    win?.close();
  }
}
