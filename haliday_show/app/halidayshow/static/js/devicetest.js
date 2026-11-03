// Frames for testing a light's parts from the Devices tab, in show order (Reverse is applied when
// they're sent). Each part is lit in its colour on the Devices map with its first segment white,
// so you can see where it starts and which way it runs. Unused segments stay off.
import { partRgb } from "./house.js";
import { partCells } from "./parts.js";

const WHITE = [255, 255, 255];

// `only` is a part's id to light just that part; without it every part is lit.
export function partsFrame(light, only) {
  const out = new Uint8Array(light.segments * 3);
  (light.parts || []).forEach((p, k) => {
    if (only != null && p.id !== only) return;
    // Each part in its colour, its first LED (a matrix part's top left) white.
    partCells(light, p).forEach((i, n) => { if (i < light.segments) out.set(n ? partRgb(k) : WHITE, i * 3); });
  });
  return out;
}
