// Split vocals' worker: fetches the AI model and its runtime from HA-liday Show (server.py passes them
// through), then splits the song with stems.js. Messages back: {stage: "download" | "split", done}
// as it goes, then {vocals, music} (two channels each) or {error}.

import { MDX, separate } from "./stems.js";

const FILES = new URL("../../api/stems/files/", import.meta.url).href;
// Bumped whenever server.py's STEM_FILES change, so no browser keeps using old copies.
const VERSION = "mdx-vocft-ort1.20.1";
const file = (name) => `${FILES}${name}?v=${VERSION}`;
const CACHE = `haliday-show-split-vocals-${VERSION}`;

// The model, from the browser's own store after the first time (where the page may keep one: on
// https or this machine).
async function model(progress) {
  const url = file("model.onnx");
  const store = self.caches ? await caches.open(CACHE).catch(() => null) : null;
  const kept = store && (await store.match(url));
  if (kept) return new Uint8Array(await kept.arrayBuffer());
  // A long download can be cut off part way (HA-liday Show breaks it off itself if the file isn't the
  // one it should be): it's tried again a couple of times before giving up.
  for (let tries = 1; ; tries++) {
    try {
      return await download(url, store, progress);
    } catch (e) {
      if (e.final) throw e;
      if (tries >= 3) throw new Error(`the AI model's download kept being cut off (${e.message}). `
        + "Check your internet connection, then try again; HA-liday Show's log says more");
      progress(0);
    }
  }
}

async function download(url, store, progress) {
  let res;
  try { res = await fetch(url); } catch (e) { throw new Error(e.message || "no answer"); }
  if (!res.ok) {
    const e = new Error((await res.text().catch(() => "")) || `couldn't download the AI model (HTTP ${res.status})`);
    e.final = true; // HA-liday Show couldn't reach the files at all: trying again won't help
    throw e;
  }
  const reader = res.body.getReader(), parts = [], size = Number(res.headers.get("Content-Length")) || 0;
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (size) progress(Math.min(1, got / size));
  }
  if (size && got < size) throw new Error("the AI model's download was cut off; try again");
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  if (store) await store.put(url, new Response(bytes.slice())).catch(() => {});
  return bytes;
}

self.onmessage = async ({ data: { left, right } }) => {
  try {
    // Asked for first on its own, so HA-liday Show's reason reaches you if it can't get it (an import
    // that fails says only that it failed); the browser then keeps it for the import.
    self.postMessage({ stage: "download", done: 0 });
    const runtime = await fetch(file("ort.webgpu.min.mjs")).catch(() => null);
    if (!runtime?.ok) {
      throw new Error((runtime && (await runtime.text().catch(() => ""))) || "couldn't load the AI's runtime. Check your internet connection, then try again");
    }
    let ort;
    try { ort = await import(file("ort.webgpu.min.mjs")); } catch (e) {
      throw new Error(`couldn't load the AI's runtime (${e.message || "network error"}). Check your internet connection, then try again`);
    }
    ort.env.wasm.wasmPaths = { mjs: file("ort-wasm-simd-threaded.jsep.mjs"), wasm: file("ort-wasm-simd-threaded.jsep.wasm") };
    ort.env.wasm.numThreads = 1; // several need the page set up in a way Home Assistant's isn't
    const bytes = await model((done) => self.postMessage({ stage: "download", done }));
    self.postMessage({ stage: "split", done: 0 });
    // The graphics card where the browser offers it (much quicker), else the processor. If the
    // graphics card gives up part way, the rest is done on the processor.
    let session = null, gpu = true;
    try {
      session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"] });
    } catch { gpu = false; }
    const cpu = async () => { gpu = false; session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] }); };
    if (!session) await cpu();
    const once = async (spec) => {
      const out = await session.run({ input: new ort.Tensor("float32", spec, [1, 4, MDX.dimF, MDX.dimT]) });
      return out.output.getData ? await out.output.getData() : out.output.data;
    };
    const run = async (spec) => {
      if (!gpu) return once(spec);
      try { return await once(spec); } catch { await cpu(); return once(spec); }
    };
    const { vocals, music } = await separate(left, right, run, (done) => self.postMessage({ stage: "split", done }));
    self.postMessage({ vocals, music }, [...vocals, ...music].map((c) => c.buffer));
  } catch (e) {
    self.postMessage({ error: e?.message || String(e) });
  }
};
