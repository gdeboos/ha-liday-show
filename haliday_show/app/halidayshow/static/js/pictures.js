// Pictures for matrices (Library → Pictures): small images and GIFs, shrunk when they're added so the
// largest one fits a 64 x 64 matrix. The editor keeps every picture here, decoded, so the Picture
// effect can read its dots and stay a plain function of time.

export const MAX_SIDE = 64;
export const MAX_FRAMES = 120;

// A picture shrunk to fit maxSide each way (each new dot the average of the dots it covers, weighted
// by how see-through they are), with at most maxFrames frames, each shown for at least 20 ms.
export function shrinkPicture({ w, h, frames, delays }, maxSide = MAX_SIDE, maxFrames = MAX_FRAMES) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
  const kept = frames.slice(0, maxFrames);
  const shrink = (src) => {
    if (nw === w && nh === h) return src;
    const out = new Uint8ClampedArray(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      const y0 = Math.floor((y * h) / nh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
      for (let x = 0; x < nw; x++) {
        const x0 = Math.floor((x * w) / nw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
          const o = (sy * w + sx) * 4, al = src[o + 3];
          r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al; n++;
        }
        const o = (y * nw + x) * 4;
        if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
        out[o + 3] = a / n;
      }
    }
    return out;
  };
  return { w: nw, h: nh, frames: kept.map(shrink), delays: delays.slice(0, maxFrames).map((d) => Math.min(Math.max(Math.round(d) || 100, 20), 10000)) };
}

// Frames travel to the server and back as base64.
export function toBase64(data) {
  let s = "";
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(text) {
  const s = atob(text), out = new Uint8ClampedArray(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Every picture the editor knows: id -> {name, w, h, frames: [Uint8ClampedArray RGBA], delays, total}.
const known = new Map();
export function keepPicture(id, saved) {
  const delays = saved.delays.map((d) => Math.max(Number(d) || 100, 20));
  known.set(id, { name: saved.name, w: saved.w, h: saved.h, frames: saved.frames.map(fromBase64), delays,
    total: delays.reduce((a, b) => a + b, 0) });
}
export const forgetPicture = (id) => known.delete(id);
export const getPicture = (id) => known.get(id);
export const pictureList = () => [...known].map(([id, p]) => ({ id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));

// Which frame shows `t` seconds in, the animation running at `speed` per cent and going round.
export function frameAt(pic, t, speed = 100) {
  if (pic.frames.length < 2 || !(pic.total > 0)) return 0;
  let ms = (((t * 1000 * speed) / 100) % pic.total + pic.total) % pic.total;
  for (let k = 0; k < pic.delays.length; k++) {
    if (ms < pic.delays[k]) return k;
    ms -= pic.delays[k];
  }
  return pic.frames.length - 1;
}
