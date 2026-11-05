// Export video (a show's ⋯ in Library → Shows, or the Show editor): where things go on the frame, the
// bar along the bottom, and the IVF wrapping for VP9 frames. The editor draws and encodes the frames
// (WebCodecs); the app adds the song and makes the MP4 (video.py). Pure, so it can be tested in node.

export const FPS = 30;
export const TITLE_S = 3.5; // the show's name shows this long at the start
export const TAIL_S = 3; // the closing card after the show
export const BRAND = "Made with HA-liday Show";
export const LINK = "github.com/gdeboos/ha-liday-show";

export const SHAPES = { landscape: { width: 1920, height: 1080 }, upright: { width: 1080, height: 1920 } };

// Where the photo, the title, the bar and the corner line go, for a photo of `aspect` (width / height).
export function videoLayout(width, height, aspect) {
  const pad = Math.round(Math.min(width, height) * 0.04);
  const barH = Math.round(Math.min(width, height) * 0.05);
  const upright = height > width;
  // Upright: the photo across the middle, the title above it and the bar under it. Landscape: the
  // photo as big as fits above the bar, the title over its top.
  const roomH = upright ? height * 0.6 : height - barH - pad * 2.5;
  let w = width - (upright ? 0 : pad * 2), h = w / aspect;
  if (h > roomH) { h = roomH; w = h * aspect; }
  w = Math.round(w); h = Math.round(h);
  const photo = { x: Math.round((width - w) / 2), y: upright ? Math.round((height - h) / 2) : pad, w, h };
  const bar = upright
    ? { x: pad, y: photo.y + h + pad * 1.5, w: width - pad * 2, h: barH }
    : { x: pad, y: height - barH - pad, w: width - pad * 2, h: barH };
  const title = upright
    ? { x: width / 2, y: Math.max(pad * 2, photo.y - pad * 2), size: Math.round(width * 0.06), align: "center" }
    : { x: photo.x + pad, y: photo.y + pad * 1.8, size: Math.round(height * 0.055), align: "left" };
  const brand = { x: width - pad, y: upright ? height - pad * 1.5 : bar.y - pad * 0.35, size: Math.round(Math.min(width, height) * 0.022) };
  return { width, height, pad, photo, bar, title, brand, upright };
}

// The bar along the bottom: the song's sections as blocks and its beats as ticks, between `start` and
// `start + duration`, each placed from 0 to 1 across the bar.
export function barParts({ sections = [], beats = [] }, start, duration) {
  const at = (t) => (t - start) / duration;
  const blocks = sections
    .filter((s) => s.end > start && s.start < start + duration)
    .map((s, k) => ({ from: Math.max(0, at(s.start)), to: Math.min(1, at(s.end)), label: s.label || "", colour: s.color || null, k }));
  const ticks = beats.filter((b) => b >= start && b <= start + duration).map(at);
  return { blocks, ticks };
}

// How strongly the title shows at time `t` seconds into the video: fully, then fading out.
export const titleAlpha = (t) => (t < TITLE_S - 1 ? 1 : Math.max(0, TITLE_S - t));

// The show's name made safe for a file name.
export const fileName = (name) => `${String(name || "show").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "show"}.mp4`;

// IVF, the plain container for VP9 frames that ffmpeg reads: a 32-byte header, then each frame with
// its size and number.
export function ivfHeader(width, height, fps, frames) {
  const b = new DataView(new ArrayBuffer(32));
  [..."DKIF"].forEach((c, i) => b.setUint8(i, c.charCodeAt(0)));
  b.setUint16(4, 0, true);
  b.setUint16(6, 32, true);
  [..."VP90"].forEach((c, i) => b.setUint8(8 + i, c.charCodeAt(0)));
  b.setUint16(12, width, true);
  b.setUint16(14, height, true);
  b.setUint32(16, fps, true);
  b.setUint32(20, 1, true);
  b.setUint32(24, frames, true);
  return new Uint8Array(b.buffer);
}

export function ivfFrame(data, index) {
  const out = new Uint8Array(12 + data.byteLength);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.byteLength, true);
  v.setUint32(4, index, true); // the frame number, low half
  v.setUint32(8, 0, true);
  out.set(data, 12);
  return out;
}
