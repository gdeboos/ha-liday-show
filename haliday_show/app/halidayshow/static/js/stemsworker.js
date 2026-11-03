// Split vocals' worker: fetches the AI model and its runtime from HA-liday Show (server.py passes them
// through), then splits the song with stems.js. Messages back: {stage: "download" | "split", done}
// as it goes, then {vocals, music} (two channels each) or {error}.

import { MDX, separate } from "./stems.js";

const FILES = new URL("../../api/stems/files/", import.meta.url).href;
const MODEL_BYTES = 66762490; // for the download's progress (the pass-through doesn't say)
const CACHE = "haliday-show-split-vocals-1";

// The model, from the browser's own store after the first time (where the page may keep one: on
// https or this machine).
async function model(progress) {
  const url = FILES + "model.onnx";
  const store = self.caches ? await caches.open(CACHE).catch(() => null) : null;
  const kept = store && (await store.match(url));
  if (kept) return new Uint8Array(await kept.arrayBuffer());
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `couldn't download the AI model (HTTP ${res.status})`);
  const reader = res.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    progress(Math.min(1, got / MODEL_BYTES));
  }
  if (got < MODEL_BYTES * 0.99) throw new Error("the AI model's download was cut off; try again");
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  if (store) await store.put(url, new Response(bytes.slice())).catch(() => {});
  return bytes;
}

self.onmessage = async ({ data: { left, right } }) => {
  try {
    const ort = await import(FILES + "ort.webgpu.min.mjs");
    ort.env.wasm.wasmPaths = FILES;
    ort.env.wasm.numThreads = 1; // several need the page set up in a way Home Assistant's isn't
    const bytes = await model((done) => self.postMessage({ stage: "download", done }));
    self.postMessage({ stage: "split", done: 0 });
    // The graphics card where the browser offers it (much quicker), else the processor.
    let session;
    try {
      session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"] });
    } catch {
      session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    }
    const run = async (spec) => {
      const out = await session.run({ input: new ort.Tensor("float32", spec, [1, 4, MDX.dimF, MDX.dimT]) });
      return out.output.getData ? await out.output.getData() : out.output.data;
    };
    const { vocals, music } = await separate(left, right, run, (done) => self.postMessage({ stage: "split", done }));
    self.postMessage({ vocals, music }, [...vocals, ...music].map((c) => c.buffer));
  } catch (e) {
    self.postMessage({ error: e?.message || String(e) });
  }
};
