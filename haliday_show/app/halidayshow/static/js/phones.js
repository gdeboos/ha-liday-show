// Phones join the show (the public page's Join button): visitors' screens glow with the show. Each
// show's bake carries a colour for phones ten times a second (effects.js bakeFrames): the show's own
// Phones lane where it has one, else the house's main colour. The House panel's phone tile shows the
// same. Pure, so it can be tested in node.

export const PHONES = "@phones"; // the Phones lane's device id
export const PHONE_FPS = 10;
// A Phones lane plays on the phone's screen as a small upright matrix, drawn by the phone itself.
export const PHONE_GRID = { w: 27, h: 48 };
const LIT = 8; // a channel this bright or more counts as lit

// The house's main colour from its lights' frames (each r g b r g b …): the lit bulbs' colours
// averaged, brighter bulbs counting for more, then as bright as the brightest bulb. So a dark house
// with one bright prop shows that prop's colour, and a fade on every light fades the phones too.
export function mainColour(frames) {
  let r = 0, g = 0, b = 0, weight = 0, peak = 0;
  for (const f of frames) {
    for (let i = 0; i + 2 < f.length; i += 3) {
      const m = Math.max(f[i], f[i + 1], f[i + 2]);
      if (m < LIT) continue;
      r += f[i] * m; g += f[i + 1] * m; b += f[i + 2] * m; weight += m;
      if (m > peak) peak = m;
    }
  }
  if (!weight) return [0, 0, 0];
  const avg = [r / weight, g / weight, b / weight], top = Math.max(...avg);
  return avg.map((c) => Math.round((c * peak) / top));
}

export const hex = ([r, g, b]) => [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");

// How many phone colours a bake of `frames` frames at `fps` carries, and which light frame each is taken at.
export const phoneCount = (frames, fps) => Math.ceil((frames * PHONE_FPS) / fps);
export const phoneFrame = (k, fps) => Math.floor((k * fps) / PHONE_FPS);

// The Phones lane's light: a matrix the size of PHONE_GRID, which isn't a real light.
export const PHONE_LANE = { id: PHONES, name: "Phones", segments: PHONE_GRID.w * PHONE_GRID.h, phones: true,
  matrix: { w: PHONE_GRID.w, h: PHONE_GRID.h } };

// The colour at `t` seconds from a bake's string of colours ("rrggbb" each), or black outside it.
export function colourAt(colours, t) {
  const k = Math.floor(t * PHONE_FPS);
  if (!(k >= 0) || (k + 1) * 6 > colours.length) return [0, 0, 0];
  const at = k * 6;
  return [0, 2, 4].map((i) => parseInt(colours.slice(at + i, at + i + 2), 16) || 0);
}

// Whether a show has its own Phones lane (phones then follow only it, dark in its gaps).
export const hasPhonesLane = (show) => (show?.tracks || []).some((t) => t.device === PHONES);

// Whether visitors' phones join this show: the public page's switch is on, and the show hasn't opted out.
export const phonesJoin = (show, on) => !!on && show?.phones !== false;
