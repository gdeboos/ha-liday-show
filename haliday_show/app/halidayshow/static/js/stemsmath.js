// A helper for Split into parts: works out chunks' spectra (and turns the model's answers back into
// sound) for stemsworker.js, so several of the computer's cores share the maths while the graphics
// chip runs the model. Asked {id, kind: "spectrum", model, l, r} or {id, kind: "sound", model, spec};
// answers {id, result} or {id, error}. Says {ready: true} once it has loaded.

import { chunkSound, chunkSpectrum, tools } from "./stems.js";

const kept = new Map(); // each model's transforms, made once (they're slow to set up)
const toolsFor = (model) => {
  const key = `${model.nFft}`;
  if (!kept.has(key)) kept.set(key, tools(model));
  return kept.get(key);
};

self.onmessage = ({ data: { id, kind, model, l, r, spec } }) => {
  try {
    const t = toolsFor(model);
    if (kind === "spectrum") {
      const result = chunkSpectrum(l, r, t, model);
      self.postMessage({ id, result }, [result.buffer]);
    } else {
      const result = chunkSound(spec, t, model);
      self.postMessage({ id, result }, result.map((c) => c.buffer));
    }
  } catch (e) {
    self.postMessage({ id, error: e?.message || String(e) });
  }
};
self.postMessage({ ready: true });
