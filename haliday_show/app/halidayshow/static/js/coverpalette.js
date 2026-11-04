// A palette from a song's cover art, made for lights rather than screens: the cover's main colours,
// leaving out black (which is "off" on a light), greys and near-whites, then made vivid, because
// the muted, dark tones covers are full of look dull on LEDs. Pure, so it can be tested in node.

const hsv = (r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max / 255];
};

const fromHsv = (h, s, v) => {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
};

export const hex = ([r, g, b]) => `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;

const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

// Whether a pixel says something about the cover's colours (not too dark, grey or white).
export function colourful([r, g, b]) {
  const [, s, v] = hsv(r, g, b);
  return v >= 0.2 && s >= 0.22 && !(v > 0.92 && s < 0.3);
}

// How a colour looks on a light: as saturated and bright as it can sensibly be, keeping its hue.
export function forLights([r, g, b]) {
  const [h, s, v] = hsv(r, g, b);
  return fromHsv(h, Math.min(1, 0.6 + s * 0.5), Math.max(0.85, Math.min(1, v * 1.4)));
}

// The main colours among `pixels` ([[r, g, b, count?]…]) by k-means, biggest share first.
function clusters(pixels, k, rounds = 12) {
  if (!pixels.length) return [];
  const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Seeds spread out: the commonest colour, then each time the one furthest from those so far.
  const centres = [[...pixels.reduce((a, p) => ((p[3] || 1) > (a[3] || 1) ? p : a)).slice(0, 3)]];
  while (centres.length < Math.min(k, pixels.length)) {
    let best = null, far = -1;
    for (const p of pixels) {
      const d = Math.min(...centres.map((c) => dist(c, p)));
      if (d > far) { far = d; best = p; }
    }
    if (far <= 0) break;
    centres.push(best.slice(0, 3));
  }
  let weights = [];
  for (let round = 0; round < rounds; round++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of pixels) {
      let i = 0, near = Infinity;
      centres.forEach((c, j) => { const d = dist(c, p); if (d < near) { near = d; i = j; } });
      const w = p[3] || 1;
      sums[i][0] += p[0] * w; sums[i][1] += p[1] * w; sums[i][2] += p[2] * w; sums[i][3] += w;
    }
    sums.forEach((s, j) => { if (s[3]) centres[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    weights = sums.map((s) => s[3]);
  }
  return centres.map((c, j) => ({ rgb: c.map(Math.round), weight: weights[j] }))
    .filter((c) => c.weight > 0).sort((a, b) => b.weight - a.weight);
}

// A cover's palette from its RGBA pixels (as from a canvas's getImageData), or null when it has
// too little colour to go on (a black-and-white photo, say). Between 2 and `max` colours.
export function coverPalette(rgba, { max = 5, minShare = 0.04 } = {}) {
  // Counted in steps of 8 per channel, so a large cover isn't slow and near-equal pixels group.
  const counts = new Map();
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    total++;
    const px = [rgba[i], rgba[i + 1], rgba[i + 2]];
    if (!colourful(px)) continue;
    const key = ((px[0] >> 3) << 10) | ((px[1] >> 3) << 5) | (px[2] >> 3);
    const c = counts.get(key);
    if (c) { c[0] += px[0]; c[1] += px[1]; c[2] += px[2]; c[3]++; }
    else counts.set(key, [...px, 1]);
  }
  const pixels = [...counts.values()].map(([r, g, b, n]) => [r / n, g / n, b / n, n]);
  const lit = pixels.reduce((s, p) => s + p[3], 0);
  if (!total || lit < total * 0.03) return null;
  const out = [];
  for (const { rgb, weight } of clusters(pixels, max + 3)) {
    if (out.length >= max) break;
    if (out.length >= 2 && weight < lit * minShare) break;
    const tuned = forLights(rgb), h = hsv(...tuned)[0];
    // Two shades of one colour look the same on a light: keep the bigger one.
    if (out.some((o) => hueGap(o.h, h) < 22)) continue;
    out.push({ h, rgb: tuned });
  }
  return out.length >= 2 ? out.map((o) => hex(o.rgb)) : null;
}

// The name for a song's palette in your palettes: the song's name, made unique among `taken`.
export function songPaletteName(songName, taken) {
  const base = String(songName || "Song").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 70) || "Song";
  const names = new Set(taken);
  let name = base;
  for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
  return name;
}

// The song's palette with today's colours: followed by name in your palettes (so editing it there
// changes what the song offers), else the copy kept with the song. Null when it has none.
export function songPaletteNow(saved, palettes) {
  if (!saved?.colors?.length) return null;
  const mine = palettes.find((p) => p.name === saved.name);
  return mine ? { ...saved, colors: [...mine.colors] } : { ...saved, colors: [...saved.colors] };
}
