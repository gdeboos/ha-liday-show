// A small GIF reader, so animated GIFs can go on a matrix in every browser (the browser's own frame
// decoder isn't in Safari). Returns each frame as it looks on screen: RGBA, drawn over the frames
// before it as the GIF's disposal methods say, with see-through dots alpha 0.

const MAX_DOTS = 4_000_000; // 2000 x 2000: plenty for anything shrunk to 64 x 64
const MAX_GIF_FRAMES = 500; // more than are kept (pictures.js), so a long GIF still plays its start

export function decodeGif(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sig = String.fromCharCode(...b.subarray(0, 6));
  if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("That isn't a GIF file");
  let pos = 6;
  const u8 = () => { if (pos >= b.length) throw new Error("The GIF file is cut short"); return b[pos++]; };
  const u16 = () => u8() | (u8() << 8);
  const table = (n) => { const t = b.subarray(pos, pos + n * 3); if (t.length < n * 3) throw new Error("The GIF file is cut short"); pos += n * 3; return t; };
  const subBlocks = () => {
    const parts = [];
    for (let n = u8(); n; n = u8()) { parts.push(b.subarray(pos, pos + n)); pos += n; }
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };

  const w = u16(), h = u16(), packed = u8();
  if (!w || !h) throw new Error("The GIF file is damaged");
  if (w * h > MAX_DOTS) throw new Error("That GIF is too big. Make it smaller first (under 2000 × 2000)");
  u8(); u8(); // background index and aspect: not needed
  const globalTable = packed & 0x80 ? table(1 << ((packed & 7) + 1)) : null;
  const canvas = new Uint8ClampedArray(w * h * 4);
  const frames = [], delays = [];
  let gce = { disposal: 0, delay: 0, transparent: -1 };

  while (pos < b.length) {
    const kind = u8();
    if (kind === 0x3b) break; // the end
    if (kind === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        const data = subBlocks();
        gce = { disposal: (data[0] >> 2) & 7, delay: data[1] | (data[2] << 8), transparent: data[0] & 1 ? data[3] : -1 };
      } else subBlocks();
      continue;
    }
    if (kind !== 0x2c) throw new Error("The GIF file has something it doesn't expect in it");
    const left = u16(), top = u16(), iw = u16(), ih = u16(), ip = u8();
    const colours = ip & 0x80 ? table(1 << ((ip & 7) + 1)) : globalTable;
    if (!colours) throw new Error("The GIF has no colours");
    if (iw * ih > MAX_DOTS) throw new Error("That GIF is too big. Make it smaller first (under 2000 × 2000)");
    const minSize = u8();
    if (minSize < 1 || minSize > 11) throw new Error("The GIF file is damaged");
    const indices = lzw(minSize, subBlocks(), iw * ih);
    const before = gce.disposal === 3 ? canvas.slice() : null;
    const rows = ip & 0x40 ? interlaced(ih) : null;
    for (let r = 0; r < ih; r++) {
      const y = top + (rows ? rows[r] : r);
      if (y >= h) continue;
      for (let x = 0; x < iw; x++) {
        const k = indices[r * iw + x];
        if (k === gce.transparent || left + x >= w || k * 3 + 2 >= colours.length) continue;
        const o = (y * w + left + x) * 4;
        canvas[o] = colours[k * 3]; canvas[o + 1] = colours[k * 3 + 1]; canvas[o + 2] = colours[k * 3 + 2]; canvas[o + 3] = 255;
      }
    }
    frames.push(canvas.slice());
    delays.push(gce.delay <= 1 ? 100 : gce.delay * 10); // as browsers do: no delay plays at 0.1 s
    if (gce.disposal === 2) {
      for (let y = top; y < Math.min(top + ih, h); y++) canvas.fill(0, (y * w + left) * 4, (y * w + Math.min(left + iw, w)) * 4);
    } else if (before) canvas.set(before);
    gce = { disposal: 0, delay: 0, transparent: -1 };
    if (frames.length >= MAX_GIF_FRAMES) break;
  }
  if (!frames.length) throw new Error("The GIF has no pictures in it");
  return { w, h, frames, delays };
}

// The order an interlaced image's rows come in: every 8th from 0, every 8th from 4, every 4th from 2,
// then every other one from 1.
function interlaced(h) {
  const out = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) out.push(y);
  return out;
}

// GIF's LZW: codes of growing width, a clear code to start afresh and an end code.
function lzw(minSize, data, count) {
  const out = new Uint8Array(count);
  const clear = 1 << minSize, end = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; }
  let size = minSize + 1, next = end + 1, prev = -1, n = 0;
  let acc = 0, bits = 0, p = 0;
  const stack = new Uint8Array(4096);
  while (n < count) {
    while (bits < size && p < data.length) { acc |= data[p++] << bits; bits += 8; }
    if (bits < size) break;
    const code = acc & ((1 << size) - 1);
    acc >>>= size; bits -= size;
    if (code === clear) { size = minSize + 1; next = end + 1; prev = -1; continue; }
    if (code === end) break;
    let c = code, top = 0;
    if (code >= next) {
      if (prev < 0) break; // a broken file
      stack[top++] = first[prev];
      c = prev;
    }
    while (c >= 0 && top < 4096) { stack[top++] = suffix[c]; c = prefix[c]; }
    while (top && n < count) out[n++] = stack[--top];
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev;
      suffix[next] = first[code < next ? code : prev];
      first[next] = first[prev];
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    prev = code;
  }
  return out;
}
