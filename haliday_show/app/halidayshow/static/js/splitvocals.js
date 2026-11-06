// Split vocals, from a song's row in Library → Songs or the Music editor: the song decoded at the
// model's rate, split in a worker (stemsworker.js, stems.js), and kept with the song as two of its
// parts (Storage.song_parts), its vocals and its music, ready to use as layers.

import { MDX } from "./stems.js";
import { fetchSong, songLoadMessage } from "./songload.js";
import { sendParts } from "./upload.js";

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
  return sendParts(api, `api/audio/parts?${q}`, new Blob([wav16(channels, rate)], { type: "audio/wav" }), {}, progress);
}

let busy = false;
const MAX_MINUTES = 8; // longer songs need more memory than a phone or tablet has for this

// A window over the page while the split runs (it takes minutes): a spinner, what's happening, how far
// along, and Cancel. Esc cancels too. Returns {say(text, done 0-1 or null), close()}.
function progressWindow(title, onCancel) {
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
  const hint = el("p", "hint", "It runs in this browser, so keep this page open until it's done. The song isn't changed: "
    + "its vocals and music are kept with it.");
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
    lock() { locked = true; cancel.disabled = true; hint.textContent = "Saving the vocals and the music with the song. Nearly done."; },
    close() { if (dlg.open) dlg.close(); dlg.remove(); },
  };
}

// ref: the song ({source, path}). host: {api, status(text, kind), askYes(text, opts), songsChanged()}.
export async function splitVocals(ref, host) {
  if (busy) return host.status("Already splitting a song: wait for it to finish", "hint");
  busy = true; // from the first question on, so a second press can't start another meanwhile
  let worker = null, win = null, cancelled = false;
  try {
    const song = ref.path.split("/").pop().replace(/\.[^.]+$/, "");
    if (!(await host.askYes(`Split ${song} into its vocals and the music behind them? They're kept with the song as its parts, `
      + "for Singing faces, Generate and the Music editor's layers. The first time, your browser downloads "
      + "the AI that does it (about 90 MB). It takes a few minutes; keep this page open meanwhile.", { yes: "Split vocals" }))) return;
    // Cancel ends whatever is being waited for at once (loading the song, the split).
    let stop = null;
    const stopped = new Promise((_, reject) => { stop = reject; });
    stopped.catch(() => {});
    const unlessCancelled = (p) => Promise.race([p, stopped]);
    win = progressWindow(`Splitting ${song}`, () => {
      cancelled = true;
      worker?.terminate();
      stop(new Error("cancelled"));
    });
    const say = (text, done = null) => { win.say(text, done); host.status(text); };
    worker = new Worker(new URL("./stemsworker.js", import.meta.url), { type: "module" });
    say(`Loading ${song}…`);
    let decoded;
    try {
      const bytes = await unlessCancelled(fetchSong(`api/audio/file?source=${encodeURIComponent(ref.source)}&path=${encodeURIComponent(ref.path)}`));
      decoded = await unlessCancelled(new OfflineAudioContext(2, 1, MDX.rate).decodeAudioData(bytes)); // resampled to the model's rate
    } catch (e) { throw cancelled ? e : new Error(songLoadMessage(e)); }
    if (decoded.duration > MAX_MINUTES * 60) {
      throw new Error(`it's longer than ${MAX_MINUTES} minutes, more than a browser can split in one go. Cut it shorter in the Music editor first`);
    }
    const left = Float32Array.from(decoded.getChannelData(0));
    const right = decoded.numberOfChannels > 1 ? Float32Array.from(decoded.getChannelData(1)) : Float32Array.from(left);
    decoded = null; // let the decoded copy go before the split needs its memory
    if (cancelled) throw new Error("cancelled");
    const result = await unlessCancelled(new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.error) reject(new Error(data.error));
        else if (data.vocals) resolve(data);
        else say(data.stage === "download" ? `Downloading the AI for Split vocals (the first time only)… ${Math.round(data.done * 100)}%`
          : `Splitting ${song}… ${Math.round(data.done * 100)}%`, data.done);
      };
      worker.onerror = (e) => reject(new Error(e.message || "the AI couldn't start in this browser"));
      worker.postMessage({ left, right }, [left.buffer, right.buffer]);
    }));
    win.lock();
    for (const [part, channels] of [["vocals", result.vocals], ["music", result.music]]) {
      await savePart(host.api, ref, part, channels, MDX.rate, (done) => { if (done < 1) say(`Saving the ${part}… ${Math.round(done * 100)}%`, done); });
    }
    await host.songsChanged?.();
    host.status(`Split ${song}: its vocals and music are kept with it. Pick them as layers in the Music editor`, "saved");
  } catch (e) {
    if (cancelled) host.status("Split vocals cancelled. Your songs are as they were", "hint");
    else host.status(`Couldn't split ${ref.path.split("/").pop().replace(/\.[^.]+$/, "")}: ${e.message}`, true);
  } finally {
    win?.close();
    worker?.terminate();
    busy = false;
  }
}
