// Section notes written on your own device: a small AI model (Qwen2.5-1.5B-Instruct, 4-bit) run in the
// browser on the graphics chip (WebGPU) by transformers.js. HA-liday Show downloads and checks the files
// once (server.py STEM_FILES); the browser keeps the model after that, so it's only fetched again if
// the browser clears it. Nothing about the song leaves the device.
//
// Asked {check: true}: {kept, gpu: "ok" | "none" | "no-f16"}. Asked {download: true}: {stage: "download",
// done} as it goes, then {downloaded: true}. Asked {write: [{index, messages}], maxTokens}: {stage: "load"},
// then {stage: "write", done} after each, then {written: [{index, text}]}. Asked {forget: true}: {forgotten}.
// Any of them may answer {error} instead.

const FILES = new URL("../../api/stems/files/", import.meta.url).href;
// Bumped whenever these files change in server.py, so no browser keeps using old copies.
const VERSION = "qwen2.5-1.5b-q4f16-tjs4.3.1";
const file = (name) => `${FILES}${name}?v=${VERSION}`;
const CACHE = `haliday-show-notes-${VERSION}`;
// The model's files under the names transformers.js asks for, and ours on HA-liday Show.
const MODEL = {
  "config.json": "notes-config.json",
  "generation_config.json": "notes-generation_config.json",
  "tokenizer.json": "notes-tokenizer.json",
  "tokenizer_config.json": "notes-tokenizer_config.json",
  "onnx/model_q4f16.onnx": "notes-model.onnx",
};
const RUNTIME = ["transformers.min.js", "ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];
const ALL = [...Object.values(MODEL), ...RUNTIME];

const store = async () => (self.caches ? caches.open(CACHE).catch(() => null) : null);

// HA-liday Show gets the files ready first (each checked as it downloads): this waits for that.
const PREPARE = new URL("../../api/stems/prepare", import.meta.url).href;
async function prepared(names, progress) {
  for (let first = true; ; first = false) {
    let files;
    try {
      const res = await fetch(`${PREPARE}?names=${names.join(",")}${first ? "&retry=1" : ""}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
      files = await res.json();
    } catch (e) {
      throw new Error(`couldn't ask HA-liday Show for the notes model (${e.message || "no answer"})`);
    }
    const all = Object.values(files);
    const failed = all.find((f) => f.error);
    if (failed) throw new Error(`HA-liday Show couldn't download the notes model: ${failed.error}. Check it's online, then try again`);
    const size = all.reduce((n, f) => n + f.size, 0), got = all.reduce((n, f) => n + f.got, 0);
    progress(size ? got / size : 1);
    if (all.every((f) => f.ready)) return files;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// One file from HA-liday Show, in pieces (a long download through Home Assistant can be cut off part
// way), into the browser's store.
const PIECE = 8 * 1024 * 1024;
async function keep(cache, name, size, progress) {
  const url = file(name), bytes = new Uint8Array(size);
  for (let at = 0; at < size; at += PIECE) {
    const end = Math.min(at + PIECE, size) - 1;
    for (let tries = 1; ; tries++) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${at}-${end}` } });
        if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
        const part = new Uint8Array(await res.arrayBuffer());
        if (res.status === 200 && part.length === size) { bytes.set(part); at = size; break; }
        if (part.length !== end - at + 1) throw new Error("a piece came back the wrong size");
        bytes.set(part, at);
        break;
      } catch (e) {
        if (tries >= 4) throw new Error(`couldn't get the notes model from HA-liday Show (${e.message || "network error"}). Try again`);
        await new Promise((r) => setTimeout(r, 1000 * tries));
      }
    }
    progress(Math.min(size, end + 1));
  }
  try {
    await cache.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
  } catch (e) {
    throw /quota/i.test(`${e?.name} ${e?.message}`) ? new Error(NO_ROOM) : e;
  }
}

const NO_ROOM = "this browser hasn't room to keep the 1.2 GB model. Free some disk space on this computer, then try again";

async function kept() {
  const cache = await store();
  if (!cache) return false;
  for (const name of ALL) if (!(await cache.match(file(name)))) return false;
  return true;
}

async function gpu() {
  try {
    const adapter = await self.navigator?.gpu?.requestAdapter();
    if (!adapter) return "none";
    return adapter.features.has("shader-f16") ? "ok" : "no-f16";
  } catch { return "none"; }
}

async function download() {
  const cache = await store();
  if (!cache) throw new Error("this browser can't keep the notes model here (it needs the page on https or this computer)");
  const missing = [];
  for (const name of ALL) if (!(await cache.match(file(name)))) missing.push(name);
  if (!missing.length) return;
  // First HA-liday Show (half the bar), then this browser (the other half).
  const files = await prepared(missing, (f) => postMessage({ stage: "download", done: f / 2 }));
  const total = missing.reduce((n, name) => n + files[name].size, 0);
  // Room for it first (with some to spare), and asked to keep it rather than clear it when space runs low.
  const room = await self.navigator?.storage?.estimate?.().catch(() => null);
  if (room?.quota && room.quota - (room.usage || 0) < total * 1.1) throw new Error(NO_ROOM);
  await self.navigator?.storage?.persist?.().catch(() => {});
  let before = 0;
  for (const name of missing) {
    await keep(cache, name, files[name].size, (got) => postMessage({ stage: "download", done: 0.5 + (before + got) / total / 2 }));
    before += files[name].size;
  }
}

// The model, loaded once per worker.
let generator = null;
async function load() {
  if (generator) return generator;
  const cache = await store();
  if (!cache || !(await kept())) throw new Error("the notes model isn't downloaded in this browser yet");
  // The runtime from the store too, so a restarted HA-liday Show needn't fetch it again.
  const local = async (name, type) => URL.createObjectURL(new Blob([await (await cache.match(file(name))).arrayBuffer()], { type }));
  const { env, pipeline } = await import(await local(RUNTIME[0], "text/javascript"));
  // Every file comes from the browser's store: transformers.js is told where to "fetch" them, and nowhere else.
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = false;
  env.useWasmCache = false;
  env.remoteHost = "https://notes.invalid/";
  env.remotePathTemplate = "{model}/";
  env.fetch = async (url) => {
    const path = String(url?.url ?? url).split("https://notes.invalid/notes/")[1]?.split("?")[0];
    const ours = path && MODEL[path];
    const res = ours && (await cache.match(file(ours)));
    return res || new Response("not here", { status: 404 });
  };
  env.backends.onnx.wasm.wasmPaths = { mjs: await local(RUNTIME[1], "text/javascript"), wasm: await local(RUNTIME[2], "application/wasm") };
  env.backends.onnx.wasm.numThreads = 1; // several need the page set up in a way Home Assistant's isn't
  generator = await pipeline("text-generation", "notes", { device: "webgpu", dtype: "q4f16" });
  return generator;
}

async function write(items, maxTokens) {
  postMessage({ stage: "load" });
  const gen = await load();
  const out = [];
  for (let k = 0; k < items.length; k++) {
    const res = await gen(items[k].messages, { max_new_tokens: maxTokens || 160, do_sample: false });
    const text = res?.[0]?.generated_text;
    out.push({ index: items[k].index, text: Array.isArray(text) ? String(text.at(-1)?.content || "") : String(text || "") });
    postMessage({ stage: "write", done: (k + 1) / items.length });
  }
  return out;
}

// Every answer carries the asking message's id, so the page never takes one for another's.
self.onmessage = async ({ data }) => {
  const progress = self.postMessage.bind(self);
  const id = data.id, reply = (msg) => progress({ ...msg, id });
  self.postMessage = (msg) => progress({ ...msg, id });
  try {
    if (data.check) reply({ kept: await kept(), gpu: await gpu() });
    else if (data.download) { await download(); reply({ downloaded: true }); }
    else if (data.write) reply({ written: await write(data.write, data.maxTokens) });
    else if (data.forget) { generator = null; await caches.delete(CACHE).catch(() => {}); reply({ forgotten: true }); }
  } catch (e) {
    reply({ error: e?.message || String(e) });
  } finally {
    self.postMessage = progress;
  }
};
