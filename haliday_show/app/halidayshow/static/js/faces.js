// Singing faces (the Singing face effect, effects.js): original characters drawn from simple shapes.
// What they're doing is `face`: {mouth (0 shut to 1 wide open), shape (the mouth's shape: "a" a tall
// "ah", "o" a round "oo", "e" a wide "ee", "m" closed), blink (0 open to 1 shut), look (-1 left to 1
// right)}. Each is drawn in a box 3 wide by 4 high; (u, v) runs 0 to 1 across and down it. Pure, so it
// can be tested in node.

export const CHARACTERS = ["snowman", "pumpkin", "gingerbread", "santa", "ghost"];
export const FACE_ASPECT = 3 / 4; // the box's width over its height
export const SHAPES = "aoem";

const C = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const ell = (u, v, cx, cy, rx, ry) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
const rect = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
// Inside the triangle a, b, c (each [u, v]).
function tri(u, v, [ax, ay], [bx, by], [cx, cy]) {
  const s = (px, py, qx, qy) => (u - qx) * (py - qy) - (px - qx) * (v - qy);
  const d1 = s(ax, ay, bx, by), d2 = s(bx, by, cx, cy), d3 = s(cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// The mouth's half-width and half-height for its shape and how open it is: w its half-width at rest,
// tall its half-height wide open.
function mouthSize(f, w, tall) {
  const m = f.shape === "m" ? 0 : f.mouth;
  if (f.shape === "o") return [w * (0.35 + 0.15 * m), 0.012 + tall * 0.8 * m]; // small and round
  if (f.shape === "e") return [w * (1 + 0.15 * m), 0.012 + tall * 0.45 * m]; // wide and flat, teeth showing
  return [w * (0.75 + 0.25 * m), 0.012 + tall * m]; // "ah": tall and open
}

// The mouth: a dark oval of its shape (a thin line when shut), with a tongue when it's open wide, or a
// row of top teeth on an "ee".
function mouthAt(u, v, f, cx, cy, w, tall, dark, tongue = C("#c0303a")) {
  const [rx, ry] = mouthSize(f, w, tall);
  if (!ell(u, v, cx, cy, rx, ry)) return null;
  const open = f.shape !== "m" && f.mouth > 0.25;
  if (open && f.shape === "e" && v < cy - ry * 0.35) return C("#f4f4f4");
  if (open && f.shape !== "e" && ell(u, v, cx, cy + ry * 0.55, rx * 0.6, ry * 0.5)) return tongue;
  return dark;
}

// An eye: an oval, squashed to a line as it blinks, with its pupil (if it has one) looking about.
function eyeAt(u, v, f, cx, cy, rx, ry, colour, pupil = null) {
  const h = ry * (1 - 0.85 * f.blink);
  if (!ell(u, v, cx, cy, rx, h)) return null;
  if (pupil && f.blink < 0.5 && ell(u, v, cx + f.look * rx * 0.4, cy, rx * 0.5, h * 0.6)) return pupil;
  return colour;
}

const WHITE = C("#f4f8ff"), SHADE = C("#c8d6ea"), COAL = C("#1a1a1a"), DARK = C("#2a0a0a");

const DRAW = {
  snowman(u, v, f) {
    // A black top hat with a red band, on a round white head.
    if (rect(u, v, 0.33, 0.02, 0.67, 0.2)) return rect(u, v, 0.33, 0.15, 0.67, 0.2) ? C("#c0202a") : COAL;
    if (rect(u, v, 0.18, 0.2, 0.82, 0.25)) return COAL;
    if (!ell(u, v, 0.5, 0.57, 0.42, 0.33)) return null;
    const eye = eyeAt(u, v, f, 0.36, 0.48, 0.05, 0.04, COAL) || eyeAt(u, v, f, 0.64, 0.48, 0.05, 0.04, COAL);
    if (eye) return eye;
    if (tri(u, v, [0.48, 0.55], [0.48, 0.61], [0.75, 0.6])) return C("#ff8a1e"); // the carrot
    const mouth = mouthAt(u, v, f, 0.5, 0.72, 0.17, 0.09, DARK);
    if (mouth) return mouth;
    return ell(u, v, 0.47, 0.54, 0.38, 0.3) ? WHITE : SHADE;
  },
  pumpkin(u, v, f) {
    if (rect(u, v, 0.46, 0.08, 0.54, 0.24)) return C("#4a7a2a"); // the stalk
    if (!ell(u, v, 0.5, 0.57, 0.47, 0.37)) return null;
    const glow = C("#ffd24a");
    // Triangle eyes and nose, lit from inside; the eyes close to a slit as it blinks.
    const lid = 0.39 + 0.12 * f.blink;
    if (v >= lid && (tri(u, v, [0.25, 0.53], [0.41, 0.53], [0.33, 0.39]) || tri(u, v, [0.59, 0.53], [0.75, 0.53], [0.67, 0.39]))) return glow;
    if (tri(u, v, [0.45, 0.62], [0.55, 0.62], [0.5, 0.54])) return glow;
    // A jagged grin of the mouth's shape: two teeth that stay as it opens.
    const [rx, ry] = mouthSize(f, 0.28, 0.09);
    const cy = 0.76;
    if (ell(u, v, 0.5, cy, rx, ry + 0.018) && !(rect(u, v, 0.36, cy - ry, 0.42, cy - ry * 0.2) || rect(u, v, 0.58, cy, 0.64, cy + ry))) return glow;
    // Its ribs, a little darker.
    const rib = Math.abs(Math.sin((u - 0.5) * 9.5));
    return rib < 0.18 ? C("#c85a10") : C("#f07818");
  },
  gingerbread(u, v, f) {
    if (!ell(u, v, 0.5, 0.52, 0.44, 0.4)) return null;
    const icing = C("#fffaf0");
    const eye = eyeAt(u, v, f, 0.35, 0.44, 0.075, 0.065, COAL, null)
      || eyeAt(u, v, f, 0.65, 0.44, 0.075, 0.065, COAL, null);
    if (eye) return f.blink < 0.5 && (ell(u, v, 0.35 + f.look * 0.02, 0.44, 0.06, 0.05) || ell(u, v, 0.65 + f.look * 0.02, 0.44, 0.06, 0.05)) ? icing : eye;
    if (ell(u, v, 0.27, 0.6, 0.06, 0.04) || ell(u, v, 0.73, 0.6, 0.06, 0.04)) return C("#f07090"); // rosy cheeks
    const mouth = mouthAt(u, v, f, 0.5, 0.68, 0.15, 0.1, DARK);
    if (mouth) return mouth;
    // An icing line round the mouth.
    const [rx, ry] = mouthSize(f, 0.15, 0.1);
    if (ell(u, v, 0.5, 0.68, rx + 0.04, ry + 0.035)) return icing;
    return ell(u, v, 0.47, 0.49, 0.4, 0.36) ? C("#b8702e") : C("#94561e");
  },
  santa(u, v, f) {
    const red = C("#d0202a");
    if (ell(u, v, 0.83, 0.1, 0.08, 0.06)) return WHITE; // the bobble
    if (tri(u, v, [0.2, 0.27], [0.8, 0.27], [0.8, 0.08])) return red;
    if (rect(u, v, 0.16, 0.25, 0.84, 0.32)) return WHITE; // the hat's trim
    // The mouth in the beard, the moustache over it.
    const mouth = mouthAt(u, v, f, 0.5, 0.67, 0.12, 0.08, DARK);
    if (mouth) return mouth;
    if (ell(u, v, 0.4, 0.6, 0.12, 0.04) || ell(u, v, 0.6, 0.6, 0.12, 0.04)) return WHITE;
    if (ell(u, v, 0.5, 0.53, 0.06, 0.045)) return C("#e86060"); // the nose
    const eye = eyeAt(u, v, f, 0.38, 0.45, 0.045, 0.04, COAL) || eyeAt(u, v, f, 0.62, 0.45, 0.045, 0.04, COAL);
    if (eye) return eye;
    if (ell(u, v, 0.5, 0.47, 0.3, 0.17)) return C("#f5c8a8"); // the face
    if (ell(u, v, 0.5, 0.65, 0.42, 0.33) && v > 0.42) return ell(u, v, 0.5, 0.62, 0.36, 0.28) ? WHITE : SHADE; // the beard
    return null;
  },
  ghost(u, v, f) {
    // A round top, then straight sides down to a wavy hem.
    const hem = 0.88 + 0.05 * Math.sin(u * Math.PI * 6);
    const body = ell(u, v, 0.5, 0.42, 0.38, 0.34) || (rect(u, v, 0.12, 0.42, 0.88, 1) && v <= hem);
    if (!body) return null;
    const eye = eyeAt(u, v, f, 0.37 + f.look * 0.02, 0.4, 0.06, 0.09, COAL) || eyeAt(u, v, f, 0.63 + f.look * 0.02, 0.4, 0.06, 0.09, COAL);
    if (eye) return eye;
    // Its mouth, an "oo" at heart: rounder or wider with the shape.
    const [rx, ry] = mouthSize(f, 0.07, 0.12);
    if (ell(u, v, 0.5, 0.6, rx * (f.shape === "e" ? 1.6 : 1), ry + 0.02)) return COAL;
    return ell(u, v, 0.46, 0.45, 0.32, 0.3) ? WHITE : SHADE;
  },
};

const still = { mouth: 0, shape: "a", blink: 0, look: 0 };

// The character's colour at (u, v) in its box doing `face` (or, for older callers, with the mouth this
// open), or null for the background.
export function faceColour(character, u, v, face = 0) {
  const draw = DRAW[character] || DRAW.snowman;
  const f = typeof face === "number" ? { ...still, mouth: face } : { ...still, ...face };
  f.mouth = Math.min(Math.max(f.mouth, 0), 1);
  return draw(u, v, f);
}

// How far open the mouth is for a voice level (0 to 1), shut when it's quiet. sensitivity (0-100, 50
// as it starts) moves where it starts opening: higher opens on quieter singing.
export function mouthFor(level, sensitivity = 50) {
  const s = Math.min(Math.max(Number(sensitivity) || 0, 0), 100) / 100;
  const from = 0.35 - 0.3 * s; // 0.2 at 50, 0.05 at 100, 0.35 at 0
  return Math.min(Math.max((level - from) / 0.5, 0), 1);
}

// A stable 0-1 number for whole number k (so blinks and glances land the same every time).
const hash = (k) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// Blinking (0 open to 1 shut) at `t` seconds: one quick blink somewhere in each four seconds.
export function blinkAt(t) {
  const k = Math.floor(t / 4), d = t - (k * 4 + 0.3 + 3.4 * hash(k));
  return d >= 0 && d < 0.16 ? 1 - Math.abs(d - 0.08) / 0.08 : 0;
}

// Where the eyes look (-1 left to 1 right) at `t`: ahead mostly, glancing aside now and then.
export function lookAt(t) {
  const k = Math.floor(t / 3), h = hash(k + 1000);
  if (h < 0.55) return 0;
  return h < 0.78 ? -1 : 1;
}
