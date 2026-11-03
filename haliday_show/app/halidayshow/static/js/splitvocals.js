// Split vocals, from a song's row in Library → Songs or the Music editor: the song decoded at the
// model's rate, split in a worker (stemsworker.js, stems.js), and saved as two new songs beside it,
// "<song> (vocals)" and "<song> (music)", ready to use as layers.

import { MDX } from "./stems.js";
import { fetchSong, songLoadMessage } from "./songload.js";
import { uploadSong } from "./upload.js";

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

let busy = false;

// ref: the song ({source, path}). host: {api, status(text, kind), askYes(text, opts), songs() (the list,
// for names already taken), songsChanged()}.
export async function splitVocals(ref, host) {
  if (busy) return host.status("Already splitting a song: wait for it to finish", "hint");
  const song = ref.path.split("/").pop().replace(/\.[^.]+$/, "");
  const names = stemNames(ref.path);
  if (!(await host.askYes(`Split ${song} into its vocals and the music behind them? It's saved as two new songs, `
    + `"${names.vocals.replace(/\.wav$/, "")}" and "${names.music.replace(/\.wav$/, "")}". The first time, your browser downloads `
    + "the AI that does it (about 90 MB). It takes a few minutes; keep this page open meanwhile.", { yes: "Split vocals" }))) return;
  const taken = new Set((host.songs() || []).map((s) => s.path.split("/").pop().toLowerCase()));
  if ((taken.has(names.vocals.toLowerCase()) || taken.has(names.music.toLowerCase()))
      && !(await host.askYes(`${song} has been split before. Replace those songs?`, { yes: "Replace" }))) return;
  busy = true;
  const worker = new Worker(new URL("./stemsworker.js", import.meta.url), { type: "module" });
  try {
    host.status(`Loading ${song}…`);
    let decoded;
    try {
      const bytes = await fetchSong(`api/audio/file?source=${encodeURIComponent(ref.source)}&path=${encodeURIComponent(ref.path)}`);
      decoded = await new OfflineAudioContext(2, 1, MDX.rate).decodeAudioData(bytes); // resampled to the model's rate
    } catch (e) { throw new Error(songLoadMessage(e)); }
    const left = Float32Array.from(decoded.getChannelData(0));
    const right = decoded.numberOfChannels > 1 ? Float32Array.from(decoded.getChannelData(1)) : Float32Array.from(left);
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.error) reject(new Error(data.error));
        else if (data.vocals) resolve(data);
        else host.status(data.stage === "download" ? `Downloading the AI for Split vocals… ${Math.round(data.done * 100)}%`
          : `Splitting ${song}… ${Math.round(data.done * 100)}%`);
      };
      worker.onerror = (e) => reject(new Error(e.message || "the AI couldn't start in this browser"));
      worker.postMessage({ left, right }, [left.buffer, right.buffer]);
    });
    for (const [part, channels] of [["vocals", result.vocals], ["music", result.music]]) {
      const name = names[part];
      await uploadSong(host.api, new Blob([wav16(channels, MDX.rate)], { type: "audio/wav" }), name,
        (done) => { if (done < 1) host.status(`Saving ${name}… ${Math.round(done * 100)}%`); }, { coverFrom: ref });
    }
    await host.songsChanged?.();
    host.status(`Split ${song}: saved "${names.vocals.replace(/\.wav$/, "")}" and "${names.music.replace(/\.wav$/, "")}" to your songs. `
      + "Use them as layers in the Music editor", "saved");
  } catch (e) {
    host.status(`Couldn't split ${song}: ${e.message}`, true);
  } finally {
    worker.terminate();
    busy = false;
  }
}
