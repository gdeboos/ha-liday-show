// Bakes shows away from the page, so the editor stays responsive while scenes, playlist blocks and
// shows are made ready (bakeoff.js sends the work here). The same effects.js as everywhere else.
import { bake, bakeLive } from "./effects.js";
import { setPictures } from "./pictures.js";
import { setFaces } from "./faces.js";

// Gzipped here too (frames are mostly the same colours over and over), as squeezing tens of megabytes
// on the page would hold it up as much as the baking.
async function gzip(data) {
  if (typeof CompressionStream !== "function") return null;
  try {
    const out = await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

self.onmessage = async (e) => {
  const { id, kind, args, pictures, faces } = e.data;
  try {
    if (pictures) setPictures(pictures);
    if (faces) setFaces(faces);
    const raw = kind === "live" ? bakeLive(...args) : bake(...args);
    const gz = raw ? await gzip(raw) : null;
    const out = gz || raw;
    self.postMessage({ id, out, gz: !!gz }, out ? [out.buffer] : []);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
