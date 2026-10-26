// Runs song analysis off the main thread, so the editor stays responsive while it listens.

import { analyse, measure } from "./analysis.js";

// With sections, only measures them (for their notes); otherwise analyses the whole song.
self.onmessage = (e) => {
  try {
    const { samples, rate, sections } = e.data;
    self.postMessage({ result: sections ? measure(samples, rate, sections) : analyse(samples, rate) });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
