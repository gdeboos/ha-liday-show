// Baking off the page: the same bake() and bakeLive() as effects.js, run in a worker (bakeworker.js) so
// clicking about stays quick while shows, scenes and blocks are made ready. The worker gzips the frames
// too; what comes back is only ever sent to the server (upload.js knows it's gzipped already). If the
// browser can't start the worker, it bakes on the page as before.
import { bake, bakeLive } from "./effects.js";
import { allPictures, picturesVersion } from "./pictures.js";
import { allFaces, facesVersion } from "./faces.js";
import { alreadyGzipped } from "./upload.js";

let worker = null, broken = false, sentPictures = -1, sentFaces = -1, next = 0;
const waiting = new Map();

function start() {
  if (worker || broken || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./bakeworker.js", import.meta.url), { type: "module" });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e) => {
    const job = waiting.get(e.data.id);
    if (!job) return;
    waiting.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else {
      if (e.data.gz && e.data.out) alreadyGzipped.add(e.data.out);
      job.resolve(e.data.out);
    }
  };
  worker.onerror = () => {
    // A worker that won't load (an old browser): bake the waiting jobs here, and every later one.
    broken = true;
    worker = null;
    for (const job of waiting.values()) job.here();
    waiting.clear();
  };
  return worker;
}

function run(kind, args) {
  const here = () => (kind === "live" ? bakeLive(...args) : bake(...args));
  const w = start();
  if (!w) return Promise.resolve().then(here);
  return new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject, here: () => { try { resolve(here()); } catch (err) { reject(err); } } });
    // Pictures go across only when they've changed since last time (the Picture effect reads them).
    const v = picturesVersion(), fv = facesVersion();
    const pictures = v !== sentPictures ? allPictures() : undefined;
    const faces = fv !== sentFaces ? allFaces() : undefined; // your Singing faces, likewise
    try {
      w.postMessage({ id, kind, args, pictures, faces });
      sentPictures = v;
      sentFaces = fv;
    } catch {
      // Something in the show that can't be copied across: bake this one here.
      waiting.get(id)?.here();
      waiting.delete(id);
    }
  });
}

export const bakeOff = (show, devices, fps, positions = {}, groups = []) => run("bake", [show, devices, fps, positions, groups]);
export const bakeLiveOff = (show, devices) => run("live", [show, devices]);
