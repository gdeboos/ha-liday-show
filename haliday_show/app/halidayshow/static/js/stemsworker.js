// Split into parts' worker: gets the AI models and their runtime from HA-liday Show (server.py downloads
// and checks them once), then splits the song with stems.js, one model after another: the vocals from
// the song, the drums from what's left, then the bass, and the rest is what remains. Asked
// {left, right, want: [parts], vocals?: [l, r] (already made)}. Messages back: {stage: "download" |
// "split", part, done} as it goes, each part as it's made ({part, channels}: vocals, music, drums,
// bass, rest), then {done: true}, or {error}. Asked {listen: samples (one channel at 16 kHz)}, it runs
// YAMNet over them instead (sounds.js): {stage: "listen", done} as it goes, then {scores: [[…]]}.

import { MODELS, separate } from "./stems.js";
import { CLASSES } from "./sounds.js";

const FILES = new URL("../../api/stems/files/", import.meta.url).href;
// Bumped whenever server.py's STEM_FILES change, so no browser keeps using old copies.
const VERSION = "mdx-vocft-ort1.20.1"; // the drums and bass models came later, under new names, so no browser has old copies of them
const file = (name) => `${FILES}${name}?v=${VERSION}`;
const CACHE = `haliday-show-split-vocals-${VERSION}`;

// HA-liday Show downloads the files first (once; server.py checks each): this waits for that, telling
// the page how far along it is. `names`: the files wanted.
const PREPARE = new URL("../../api/stems/prepare", import.meta.url).href;
async function prepared(names, progress) {
  for (let first = true; ; first = false) {
    let files;
    try {
      // The first ask tries again any that failed before (the internet was down, say).
      const res = await fetch(`${PREPARE}?names=${names.join(",")}${first ? "&retry=1" : ""}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
      files = await res.json();
    } catch (e) {
      throw new Error(`couldn't ask HA-liday Show for the AI (${e.message || "no answer"})`);
    }
    const all = Object.values(files);
    const failed = all.find((f) => f.error);
    if (failed) throw new Error(`HA-liday Show couldn't download the AI: ${failed.error}. Check it's online, then try again`);
    const size = all.reduce((n, f) => n + f.size, 0), got = all.reduce((n, f) => n + f.got, 0);
    progress(size ? got / size : 1);
    if (all.every((f) => f.ready)) return files;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// A model, from the browser's own store after the first time (where the page may keep one: on
// https or this machine), else from HA-liday Show in pieces, each tried again if it's cut off.
const PIECE = 8 * 1024 * 1024;
async function model(name, size) {
  const url = file(name);
  const store = self.caches ? await caches.open(CACHE).catch(() => null) : null;
  const bytes = new Uint8Array(size);
  for (let at = 0; at < size; at += PIECE) {
    const end = Math.min(at + PIECE, size) - 1;
    for (let tries = 1; ; tries++) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${at}-${end}` } });
        if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
        const part = new Uint8Array(await res.arrayBuffer());
        // A server that sends the whole file rather than the piece: take it as it is.
        if (res.status === 200 && part.length === size) { bytes.set(part); at = size; break; }
        if (part.length !== end - at + 1) throw new Error("a piece came back the wrong size");
        bytes.set(part, at);
        break;
      } catch (e) {
        if (tries >= 4) throw new Error(`couldn't get the AI model from HA-liday Show (${e.message || "network error"}). Try again`);
        await new Promise((r) => setTimeout(r, 1000 * tries));
      }
    }
  }
  if (store) await store.put(url, new Response(bytes.slice())).catch(() => {});
  return bytes;
}

async function keptModel(name) {
  const store = self.caches ? await caches.open(CACHE).catch(() => null) : null;
  const kept = store && (await store.match(file(name)));
  return kept ? new Uint8Array(await kept.arrayBuffer()) : null;
}

const RUNTIME = ["ort.webgpu.min.mjs", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];
async function runtime() {
  let ort;
  try { ort = await import(file("ort.webgpu.min.mjs")); } catch (e) {
    throw new Error(`couldn't load the AI's runtime (${e.message || "network error"}). Try again`);
  }
  ort.env.wasm.wasmPaths = { mjs: file("ort-wasm-simd-threaded.jsep.mjs"), wasm: file("ort-wasm-simd-threaded.jsep.wasm") };
  ort.env.wasm.numThreads = 1; // several need the page set up in a way Home Assistant's isn't
  return ort;
}

// YAMNet over the whole song, a minute at a time (each piece running on by one window, so no frame is
// cut short): its scores for the sounds sounds.js looks for, one row every 0.1 s.
const YAMNET = "yamnet.onnx", RATE = 16000, HOP = 1600, WINDOW = 15360, PIECE_S = 60;
async function listen(samples) {
  const kept = await keptModel(YAMNET);
  const files = await prepared([...RUNTIME, ...(kept ? [] : [YAMNET])], (done) => self.postMessage({ stage: "download", done }));
  const ort = await runtime();
  const bytes = kept || await model(YAMNET, files[YAMNET].size);
  self.postMessage({ stage: "listen", done: 0 });
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  const per = RATE * PIECE_S, rows = [];
  for (let at = 0; at < samples.length; at += per) {
    const last = at + per >= samples.length;
    let piece = samples.subarray(at, Math.min(samples.length, at + per + WINDOW - HOP));
    if (piece.length < WINDOW) { const padded = new Float32Array(WINDOW); padded.set(piece); piece = padded; }
    const out = await session.run({ input_1: new ort.Tensor("float32", Float32Array.from(piece), [piece.length]) });
    const t = out.activation, n = t.dims[0], width = t.dims[1], data = t.getData ? await t.getData() : t.data;
    const take = last ? n : Math.min(n, per / HOP);
    for (let f = 0; f < take; f++) rows.push(CLASSES.map((c) => Math.round(data[f * width + c] * 1e4) / 1e4));
    self.postMessage({ stage: "listen", done: Math.min(1, (at + per) / samples.length) });
  }
  await session.release?.();
  return rows;
}

self.onmessage = async ({ data: { left, right, want = ["vocals"], vocals = null, listen: heard = null } }) => {
  if (heard) {
    try { self.postMessage({ scores: await listen(heard) }); } catch (e) { self.postMessage({ error: e?.message || String(e) }); }
    return;
  }
  try {
    // The models these parts need (the vocals' too, unless they're made already).
    const steps = ["vocals", "drums", "bass"].filter((p) => p === "vocals" ? !vocals : want.includes(p));
    const kept = {};
    for (const p of steps) kept[p] = await keptModel(MODELS[p].file);
    // HA-liday Show gets the files ready first (each model too, unless this browser kept it).
    const names = [...RUNTIME, ...steps.filter((p) => !kept[p]).map((p) => MODELS[p].file)];
    const files = await prepared(names, (done) => self.postMessage({ stage: "download", done }));
    const ort = await runtime();

    // One model over `l, r` (what's left of the song so far): what it finds, and the rest, in place.
    const split = async (part, l, r) => {
      const m = MODELS[part];
      const bytes = kept[part] || await model(m.file, files[m.file].size);
      self.postMessage({ stage: "split", part, done: 0 });
      // The graphics card where the browser offers it (much quicker), else the processor. If the
      // graphics card gives up part way, the rest is done on the processor.
      let session = null, gpu = true;
      try {
        session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"] });
      } catch { gpu = false; }
      const cpu = async () => { gpu = false; await session?.release?.(); session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] }); };
      if (!session) await cpu();
      const once = async (spec) => {
        const out = await session.run({ input: new ort.Tensor("float32", spec, [1, 4, m.dimF, m.dimT]) });
        return out.output.getData ? await out.output.getData() : out.output.data;
      };
      const run = async (spec) => {
        if (!gpu) return once(spec);
        try { return await once(spec); } catch { await cpu(); return once(spec); }
      };
      const found = await separate(l, r, run, (done) => self.postMessage({ stage: "split", part, done }), m);
      await session.release?.();
      return found.vocals;
    };
    // Each part goes back as soon as it's made, so the page can keep it while the next is split.
    const send = (part, channels) => self.postMessage({ part, channels }, channels.map((c) => c.buffer));
    const minus = (l, r, [pl, pr]) => { for (let i = 0; i < l.length; i++) { l[i] -= pl[i]; r[i] -= pr[i]; } };
    const voc = vocals || await split("vocals", left, right);
    minus(left, right, voc); // the song without its singer
    if (!vocals) send("vocals", voc);
    if (!vocals || want.includes("music")) send("music", [left.slice(), right.slice()]);
    if (want.includes("drums")) { const d = await split("drums", left, right); minus(left, right, d); send("drums", d); }
    if (want.includes("bass")) { const b = await split("bass", left, right); minus(left, right, b); send("bass", b); }
    if (want.includes("rest")) send("rest", [left, right]);
    self.postMessage({ done: true });
  } catch (e) {
    self.postMessage({ error: e?.message || String(e) });
  }
};
