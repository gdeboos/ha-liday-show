// Singing faces (the Singing face effect, effects.js): original characters drawn from simple shapes,
// with a mouth that opens as wide as `mouth` says (0 shut, 1 wide open). Each is drawn in a box 3 wide
// by 4 high; (u, v) runs 0 to 1 across and down it. Pure, so it can be tested in node.

export const CHARACTERS = ["snowman", "pumpkin", "gingerbread", "santa", "ghost"];
export const FACE_ASPECT = 3 / 4; // the box's width over its height

const C = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const ell = (u, v, cx, cy, rx, ry) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
const rect = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
// Inside the triangle a, b, c (each [u, v]).
function tri(u, v, [ax, ay], [bx, by], [cx, cy]) {
  const s = (px, py, qx, qy) => (u - qx) * (py - qy) - (px - qx) * (v - qy);
  const d1 = s(ax, ay, bx, by), d2 = s(bx, by, cx, cy), d3 = s(cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
// The mouth: a dark oval as tall as the mouth is open (a thin line when shut), with a tongue showing
// once it's open enough. cx, cy its middle, w its half-width, tall its half-height wide open.
function mouthAt(u, v, mouth, cx, cy, w, tall, dark, tongue = C("#c0303a")) {
  const ry = 0.012 + tall * mouth;
  if (!ell(u, v, cx, cy, w * (0.75 + 0.25 * mouth), ry)) return null;
  if (mouth > 0.3 && ell(u, v, cx, cy + ry * 0.55, w * 0.5, ry * 0.5)) return tongue;
  return dark;
}

const WHITE = C("#f4f8ff"), SHADE = C("#c8d6ea"), COAL = C("#1a1a1a"), DARK = C("#2a0a0a");

const DRAW = {
  snowman(u, v, m) {
    // A black top hat with a red band, on a round white head.
    if (rect(u, v, 0.33, 0.02, 0.67, 0.2)) return rect(u, v, 0.33, 0.15, 0.67, 0.2) ? C("#c0202a") : COAL;
    if (rect(u, v, 0.18, 0.2, 0.82, 0.25)) return COAL;
    if (!ell(u, v, 0.5, 0.57, 0.42, 0.33)) return null;
    if (ell(u, v, 0.36, 0.48, 0.05, 0.04) || ell(u, v, 0.64, 0.48, 0.05, 0.04)) return COAL;
    if (tri(u, v, [0.48, 0.55], [0.48, 0.61], [0.75, 0.6])) return C("#ff8a1e"); // the carrot
    const mouth = mouthAt(u, v, m, 0.5, 0.72, 0.17, 0.09, DARK);
    if (mouth) return mouth;
    return ell(u, v, 0.47, 0.54, 0.38, 0.3) ? WHITE : SHADE;
  },
  pumpkin(u, v, m) {
    if (rect(u, v, 0.46, 0.08, 0.54, 0.24)) return C("#4a7a2a"); // the stalk
    if (!ell(u, v, 0.5, 0.57, 0.47, 0.37)) return null;
    const glow = C("#ffd24a");
    // Triangle eyes and nose, lit from inside.
    if (tri(u, v, [0.25, 0.53], [0.41, 0.53], [0.33, 0.39]) || tri(u, v, [0.59, 0.53], [0.75, 0.53], [0.67, 0.39])) return glow;
    if (tri(u, v, [0.45, 0.62], [0.55, 0.62], [0.5, 0.54])) return glow;
    // A jagged grin: two teeth that stay as the mouth opens.
    const ry = 0.03 + 0.09 * m;
    if (ell(u, v, 0.5, 0.76, 0.28, ry) && !(rect(u, v, 0.36, 0.76 - ry, 0.42, 0.76 - ry * 0.2) || rect(u, v, 0.58, 0.76, 0.64, 0.76 + ry))) return glow;
    // Its ribs, a little darker.
    const rib = Math.abs(Math.sin((u - 0.5) * 9.5));
    return rib < 0.18 ? C("#c85a10") : C("#f07818");
  },
  gingerbread(u, v, m) {
    if (!ell(u, v, 0.5, 0.52, 0.44, 0.4)) return null;
    const icing = C("#fffaf0");
    if (ell(u, v, 0.35, 0.44, 0.06, 0.05) || ell(u, v, 0.65, 0.44, 0.06, 0.05)) return icing;
    if (ell(u, v, 0.35, 0.44, 0.075, 0.065) || ell(u, v, 0.65, 0.44, 0.075, 0.065)) return COAL;
    if (ell(u, v, 0.27, 0.6, 0.06, 0.04) || ell(u, v, 0.73, 0.6, 0.06, 0.04)) return C("#f07090"); // rosy cheeks
    const mouth = mouthAt(u, v, m, 0.5, 0.68, 0.15, 0.1, DARK);
    if (mouth) return mouth;
    // An icing line round the mouth.
    if (ell(u, v, 0.5, 0.68, 0.19, 0.05 + 0.1 * m)) return icing;
    return ell(u, v, 0.47, 0.49, 0.4, 0.36) ? C("#b8702e") : C("#94561e");
  },
  santa(u, v, m) {
    const red = C("#d0202a");
    if (ell(u, v, 0.83, 0.1, 0.08, 0.06)) return WHITE; // the bobble
    if (tri(u, v, [0.2, 0.27], [0.8, 0.27], [0.8, 0.08])) return red;
    if (rect(u, v, 0.16, 0.25, 0.84, 0.32)) return WHITE; // the hat's trim
    // The mouth in the beard, the moustache over it.
    const mouth = mouthAt(u, v, m, 0.5, 0.67, 0.12, 0.08, DARK);
    if (mouth) return mouth;
    if (ell(u, v, 0.4, 0.6, 0.12, 0.04) || ell(u, v, 0.6, 0.6, 0.12, 0.04)) return WHITE;
    if (ell(u, v, 0.5, 0.53, 0.06, 0.045)) return C("#e86060"); // the nose
    if (ell(u, v, 0.38, 0.45, 0.04, 0.035) || ell(u, v, 0.62, 0.45, 0.04, 0.035)) return COAL;
    if (ell(u, v, 0.5, 0.47, 0.3, 0.17)) return C("#f5c8a8"); // the face
    if (ell(u, v, 0.5, 0.65, 0.42, 0.33) && v > 0.42) return ell(u, v, 0.5, 0.62, 0.36, 0.28) ? WHITE : SHADE; // the beard
    return null;
  },
  ghost(u, v, m) {
    // A round top, then straight sides down to a wavy hem.
    const hem = 0.88 + 0.05 * Math.sin(u * Math.PI * 6);
    const body = ell(u, v, 0.5, 0.42, 0.38, 0.34) || (rect(u, v, 0.12, 0.42, 0.88, 1) && v <= hem);
    if (!body) return null;
    if (ell(u, v, 0.37, 0.4, 0.06, 0.09) || ell(u, v, 0.63, 0.4, 0.06, 0.09)) return COAL;
    // A round "oo" mouth.
    if (ell(u, v, 0.5, 0.6, 0.04 + 0.07 * m, 0.03 + 0.12 * m)) return COAL;
    return ell(u, v, 0.46, 0.45, 0.32, 0.3) ? WHITE : SHADE;
  },
};

// The character's colour at (u, v) in its box with the mouth `mouth` open, or null for the background.
export function faceColour(character, u, v, mouth = 0) {
  const draw = DRAW[character] || DRAW.snowman;
  return draw(u, v, Math.min(Math.max(mouth, 0), 1));
}

// How far open the mouth is for a voice level (0 to 1): shut when it's quiet, wide on loud notes.
export const mouthFor = (level) => Math.min(Math.max((level - 0.2) / 0.55, 0), 1);
