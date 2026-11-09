// Split into parts' worker: gets the AI models and their runtime from HA-liday Show (server.py downloads
// and checks them once), then splits the song with stems.js, one model after another: the vocals from
// the song, the drums from what's left, then the bass, and the rest is what remains. Asked
// {left, right, want: [parts], vocals?: [l, r] (already made)}. Messages back: {stage: "download" |
// "split", part, done} as it goes, each part as it's made ({part, channels}: vocals, music, drums,
// bass, rest), then {done: true}, or {error}. Asked {listen: samples (one channel at 16 kHz)}, it runs
// YAMNet over them instead (sounds.js): {stage: "listen", done} as it goes, then {scores: [[…]]}.

import { MODELS, localMaths, separate } from "./stems.js";
import { CLASSES } from "./sounds.js";
import { LABELS, logSoftmax } from "./align.js";

const FILES = new URL("../../api/stems/files/", import.meta.url).href;
// Bumped whenever server.py's STEM_FILES change, so no browser keeps using old copies.
const VERSION = "mdx-vocft-ort1.20.1"; // the drums, bass and YAMNet models came later, under new names, so no browser has old copies of them
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

// Helpers (stemsmath.js) sharing the spectrum maths, one per spare core (up to 4), so the graphics chip
// isn't left waiting on one core between chunks. Plain workers need nothing from the page, unlike the
// AI runtime's own threads. Where they can't start, the maths is done here as before.
export async function mathsPool(model) {
  const size = Math.max(1, Math.min(4, (self.navigator?.hardwareConcurrency || 2) - 2));
  if (typeof Worker === "undefined") return { ...localMaths(model), close() {} };
  const helpers = [];
  try {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./stemsmath.js", import.meta.url), { type: "module" });
      helpers.push({ w, busy: 0 });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("slow to start")), 10000);
        w.onmessage = ({ data }) => { if (data.ready) { clearTimeout(timer); resolve(); } };
        w.onerror = (e) => { clearTimeout(timer); e.preventDefault?.(); reject(new Error(e.message || "couldn't start")); };
      });
    }
  } catch (e) {
    console.warn("Split into parts: doing the maths on one core", e);
    for (const h of helpers) h.w.terminate();
    return { ...localMaths(model), close() {} };
  }
  // A helper that stops part way hands its jobs, and the rest of the split, to this worker's own maths.
  const local = localMaths(model);
  let next = 0, failed = false;
  const waiting = new Map();
  const redo = (job) => (job.msg.kind === "spectrum" ? local.spectrum(job.msg.l, job.msg.r) : local.sound(job.msg.spec)).then(job.resolve, job.reject);
  for (const h of helpers) {
    h.w.onmessage = ({ data: { id, result, error } }) => {
      const job = waiting.get(id);
      if (!job) return;
      waiting.delete(id); h.busy--;
      if (error) job.reject(new Error(error)); else job.resolve(result);
    };
    h.w.onerror = (e) => {
      e.preventDefault?.();
      console.warn("Split into parts: a helper stopped; carrying on with one core", e.message);
      failed = true;
      for (const job of waiting.values()) redo(job);
      waiting.clear();
    };
  }
  // Copies go to the helpers (not handed over), so a job can be done here instead if one stops.
  const send = (msg) => new Promise((resolve, reject) => {
    const job = { msg, resolve, reject };
    if (failed) return redo(job);
    const h = helpers.reduce((a, b) => (b.busy < a.busy ? b : a));
    const id = next++;
    waiting.set(id, job);
    h.busy++;
    h.w.postMessage({ ...msg, id, model });
  });
  return {
    ahead: size + 1,
    spectrum: (l, r) => send({ kind: "spectrum", l, r }),
    sound: (spec) => send({ kind: "sound", spec }),
    close() { for (const h of helpers) h.w.terminate(); },
  };
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

// Line up with the singing (align.js): the English speech model over the vocals (one channel at 16 kHz), 20
// seconds at a time with a second either side so no word is cut, quiet stretches skipped (nothing's sung
// there). {stage: "align", done} as it goes, then {logp}: frames × LABELS.length log-probabilities.
const ALIGN = "align.onnx", HOP_ALIGN = 320, PIECE_ALIGN = 20 * RATE, EDGE_ALIGN = RATE;
async function lineUp(samples) {
  const kept = await keptModel(ALIGN);
  const files = await prepared([...RUNTIME, ...(kept ? [] : [ALIGN])], (done) => self.postMessage({ stage: "download", done }));
  const ort = await runtime();
  const bytes = kept || await model(ALIGN, files[ALIGN].size);
  self.postMessage({ stage: "align", done: 0 });
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  const width = LABELS.length, frames = Math.floor(samples.length / HOP_ALIGN);
  const logp = new Float32Array(frames * width);
  for (let f = 0; f < frames; f++) { logp[f * width] = 0; for (let j = 1; j < width; j++) logp[f * width + j] = -30; }
  for (let at = 0; at < samples.length; at += PIECE_ALIGN) {
    const piece = samples.subarray(at, Math.min(samples.length, at + PIECE_ALIGN));
    let sum = 0;
    for (let i = 0; i < piece.length; i++) sum += piece[i] * piece[i];
    if (Math.sqrt(sum / Math.max(1, piece.length)) > 0.003) {
      const from = Math.max(0, at - EDGE_ALIGN), to = Math.min(samples.length, at + PIECE_ALIGN + EDGE_ALIGN);
      if (to - from >= 400) {
        const out = await session.run({ waveform: new ort.Tensor("float32", Float32Array.from(samples.subarray(from, to)), [1, to - from]) });
        const t = out.logits, n = t.dims[1], data = logSoftmax(Float32Array.from(t.getData ? await t.getData() : t.data));
        const first = from / HOP_ALIGN; // `from` is a whole number of steps
        for (let j = 0; j < n; j++) {
          const g = first + j;
          if (g < at / HOP_ALIGN || g >= (at + PIECE_ALIGN) / HOP_ALIGN || g >= frames) continue;
          logp.set(data.subarray(j * width, (j + 1) * width), g * width);
        }
      }
    }
    self.postMessage({ stage: "align", done: Math.min(1, (at + PIECE_ALIGN) / samples.length) });
  }
  await session.release?.();
  return logp;
}

// Setup → AI: which models this browser keeps ({kept: [names]} → {kept: {name: true|false}}), getting
// them ready ahead of time ({fetch: [names]} → {stage: "download", done}… then {fetched: true}), and
// letting them go ({forget: true} → {forgotten: true}).
async function manage({ kept: ask, fetch: get, forget }) {
  if (forget) { await (self.caches ? caches.delete(CACHE) : null)?.catch?.(() => {}); return { forgotten: true }; }
  if (ask) {
    const out = {};
    for (const name of ask) out[name] = Boolean(await keptModel(name).catch(() => null));
    return { kept: out, store: Boolean(self.caches) };
  }
  const todo = [];
  for (const name of get) if (!(await keptModel(name).catch(() => null))) todo.push(name);
  if (!todo.length) return { fetched: true };
  const files = await prepared(todo, (done) => self.postMessage({ stage: "download", done: done / 2 }));
  const all = todo.reduce((n, name) => n + files[name].size, 0);
  let had = 0;
  for (const name of todo) {
    await model(name, files[name].size);
    had += files[name].size;
    self.postMessage({ stage: "download", done: 0.5 + had / all / 2 });
  }
  return { fetched: true };
}

self.onmessage = async ({ data }) => {
  if (data.kept || data.fetch || data.forget) {
    try { self.postMessage(await manage(data)); } catch (e) { self.postMessage({ error: e?.message || String(e) }); }
    return;
  }
  return split(data);
};

const split = async ({ left, right, want = ["vocals"], vocals = null, listen: heard = null, align = null }) => {
  if (heard) {
    try { self.postMessage({ scores: await listen(heard) }); } catch (e) { self.postMessage({ error: e?.message || String(e) }); }
    return;
  }
  if (align) {
    try { const logp = await lineUp(align); self.postMessage({ logp }, [logp.buffer]); } catch (e) { self.postMessage({ error: e?.message || String(e) }); }
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
      // The graphics card where the browser offers it (much quicker), else the processor. If the
      // graphics card gives up part way (out of memory, often), the rest is done on the processor,
      // and the page is told so it can say why it's slower.
      let session = null, gpu = true, why = "";
      try {
        if (!self.navigator?.gpu) throw new Error("this browser doesn't offer the graphics chip");
        session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"] });
      } catch (e) { gpu = false; why = e?.message || ""; }
      const cpu = async () => { gpu = false; await session?.release?.(); session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] }); };
      if (!session) await cpu();
      let done = 0;
      let gaveUp = false; // the graphics chip started, then stopped (out of memory, usually)
      const tell = () => self.postMessage({ stage: "split", part, done, via: gpu ? "gpu" : "cpu", gaveUp, why });
      tell();
      const once = async (spec) => {
        const out = await session.run({ input: new ort.Tensor("float32", spec, [1, 4, m.dimF, m.dimT]) });
        const data = out.output.getData ? await out.output.getData() : out.output.data;
        // Handed to a helper, so it must own its memory (not be a view into the runtime's).
        return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : data.slice();
      };
      const run = async (spec) => {
        if (!gpu) return once(spec);
        try { return await once(spec); } catch (e) { why = e?.message || ""; gaveUp = true; console.warn("Split into parts: the graphics chip gave up", e); await cpu(); tell(); return once(spec); }
      };
      const maths = await mathsPool(m);
      let found;
      try {
        found = await separate(l, r, run, (d) => { done = d; tell(); }, m, maths);
      } finally {
        maths.close();
      }
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
