// Runs song analysis off the main thread, so the editor stays responsive while it listens.

import { analyse, barVectors, measure } from "./analysis.js";

// With sections, only measures them (for their notes); with bars, compares them (cut suggestions);
// otherwise analyses the whole song.
self.onmessage = (e) => {
  try {
    const { samples, rate, sections, bars } = e.data;
    const result = bars ? barVectors(samples, rate, bars) : sections ? measure(samples, rate, sections) : analyse(samples, rate);
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
