// Singing faces (the Singing face effect, effects.js): original characters drawn from simple shapes.
// What they're doing is `face`: {mouth (0 shut to 1 wide open), shape (the mouth's shape: "a" a tall
// "ah", "o" a round "oo", "e" a wide "ee", "m" closed), blink (0 open to 1 shut), look (-1 left to 1
// right)}. Each is drawn in a box 3 wide by 4 high; (u, v) runs 0 to 1 across and down it. Pure, so it
// can be tested in node.

// The first five are drawn by hand (DRAW below); the rest are recipes (BUILT_IN), drawn by drawRecipe,
// the same way the faces you make are.
export const CHARACTERS = ["snowman", "pumpkin", "gingerbread", "santa", "ghost", "reindeer", "elf",
  "christmas tree", "penguin", "robin", "teddy bear", "skull", "witch", "black cat"];
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

// ---- Faces from a recipe ----
// A recipe says what a face is made of, each part chosen from a short list:
// {head: {shape, colour, patch, patchColour}, eyes: {style, colour}, nose: {style, colour},
//  mouth: {style, colour}, cheeks: colour or "", top: {style, colour, colour2}, extras: {name: colour}}.
export const RECIPE_PARTS = {
  head: ["round", "oval", "wide", "tree", "ghost", "skull"],
  patch: ["none", "face", "muzzle", "chest"],
  eyes: ["dots", "ovals", "big", "triangles", "sockets", "cat"],
  nose: ["none", "button", "carrot", "triangle", "beak", "long"],
  mouth: ["open", "grin", "teeth", "small"],
  top: ["none", "top hat", "santa hat", "witch hat", "elf hat", "bobble hat", "antlers", "cat ears", "bear ears", "star"],
  extras: ["beard", "moustache", "whiskers", "pointy ears", "baubles", "scarf", "bow tie"],
};

// Where the features sit on each head shape: eyes' height and spacing, nose and mouth heights, the
// mouth's half-width, and the head's top and bottom.
const LAYOUT = {
  round: { eye: 0.5, dx: 0.14, nose: 0.6, mouth: 0.74, w: 0.16, top: 0.27, bottom: 0.93 },
  oval: { eye: 0.5, dx: 0.13, nose: 0.6, mouth: 0.76, w: 0.14, top: 0.2, bottom: 0.96 },
  wide: { eye: 0.55, dx: 0.16, nose: 0.63, mouth: 0.76, w: 0.18, top: 0.32, bottom: 0.92 },
  tree: { eye: 0.6, dx: 0.1, nose: 0.68, mouth: 0.8, w: 0.13, top: 0.14, bottom: 0.95 },
  ghost: { eye: 0.4, dx: 0.13, nose: 0.5, mouth: 0.6, w: 0.09, top: 0.08, bottom: 0.93 },
  skull: { eye: 0.5, dx: 0.14, nose: 0.62, mouth: 0.8, w: 0.13, top: 0.19, bottom: 0.94 },
};

function inHead(shape, u, v) {
  switch (shape) {
    case "oval": return ell(u, v, 0.5, 0.58, 0.36, 0.38);
    case "wide": return ell(u, v, 0.5, 0.62, 0.46, 0.3);
    case "tree": return tri(u, v, [0.5, 0.14], [0.06, 0.95], [0.94, 0.95]);
    case "ghost": return ell(u, v, 0.5, 0.42, 0.38, 0.34) || (rect(u, v, 0.12, 0.42, 0.88, 1) && v <= 0.88 + 0.05 * Math.sin(u * Math.PI * 6));
    case "skull": return ell(u, v, 0.5, 0.52, 0.4, 0.33) || ell(u, v, 0.5, 0.8, 0.24, 0.14);
    default: return ell(u, v, 0.5, 0.6, 0.42, 0.33);
  }
}

// Near the segment a-b, `r` thick (in box units, wider across than down as the box is).
function near(u, v, [ax, ay], [bx, by], r) {
  const px = (u - ax) * 3, py = (v - ay) * 4, qx = (bx - ax) * 3, qy = (by - ay) * 4;
  const k = Math.min(Math.max((px * qx + py * qy) / (qx * qx + qy * qy || 1), 0), 1);
  return Math.hypot(px - k * qx, py - k * qy) <= r * 3;
}

// A five-pointed star of radius r (across) round (cx, cy).
function star(u, v, cx, cy, r) {
  const x = (u - cx) * 3, y = (v - cy) * 4, R = r * 3, a = Math.atan2(x, -y), d = Math.hypot(x, y);
  if (d > R) return false;
  const sector = (2 * Math.PI) / 5, phi = Math.abs(((a % sector) + sector * 1.5) % sector - sector / 2);
  const ri = R * 0.42, vx = ri * Math.cos(sector / 2), vy = ri * Math.sin(sector / 2);
  const px = d * Math.cos(phi), py = d * Math.sin(phi);
  return (vx - R) * py - vy * (px - R) >= 0;
}

const mix = (c, k) => c.map((x) => Math.round(x * k));
const hex = (h, fallback) => (typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h) ? C(h) : fallback);

// The hats and tops that sit in front of the head.
function topAt(u, v, top, L) {
  const c = hex(top.colour, C("#d0202a")), c2 = hex(top.colour2, WHITE), ht = L.top;
  switch (top.style) {
    case "top hat":
      if (rect(u, v, 0.33, ht - 0.25, 0.67, ht - 0.03)) return rect(u, v, 0.33, ht - 0.09, 0.67, ht - 0.03) ? c2 : c;
      return rect(u, v, 0.18, ht - 0.04, 0.82, ht + 0.01) ? c : null;
    case "santa hat":
      if (ell(u, v, 0.83, ht - 0.17, 0.08, 0.06)) return c2;
      if (rect(u, v, 0.16, ht, 0.84, ht + 0.07)) return c2;
      return tri(u, v, [0.2, ht + 0.02], [0.8, ht + 0.02], [0.8, ht - 0.17]) ? c : null;
    case "witch hat": {
      if (ell(u, v, 0.5, ht + 0.01, 0.48, 0.035)) return c;
      if (!tri(u, v, [0.27, ht + 0.01], [0.73, ht + 0.01], [0.62, Math.max(ht - 0.3, 0)])) return null;
      return v >= ht - 0.06 ? c2 : c;
    }
    case "elf hat":
      if (ell(u, v, 0.94, ht - 0.21, 0.05, 0.04)) return c2;
      if (rect(u, v, 0.15, ht, 0.85, ht + 0.06)) return c2;
      return tri(u, v, [0.18, ht + 0.03], [0.82, ht + 0.03], [0.94, ht - 0.21]) ? c : null;
    case "bobble hat":
      if (ell(u, v, 0.5, ht - 0.13, 0.08, 0.06)) return c2;
      if (rect(u, v, 0.1, ht + 0.01, 0.9, ht + 0.07)) return Math.floor(u * 24) % 2 ? c2 : mix(c2, 0.82);
      return ell(u, v, 0.5, ht + 0.03, 0.4, 0.15) && v <= ht + 0.03 ? c : null;
    case "star":
      return star(u, v, 0.5, Math.max(ht - 0.04, 0.11), 0.11) ? c : null;
    default: return null;
  }
}

// What sits behind the head: antlers and ears.
function behindAt(u, v, top, extras, recipeHead, L) {
  const c = hex(top.colour, C("#d8b888")), c2 = hex(top.colour2, C("#f07090")), ht = L.top;
  if (top.style === "antlers") {
    for (const s of [1, -1]) {
      const x = (k) => 0.5 + s * (k - 0.5);
      if (near(u, v, [x(0.36), ht + 0.06], [x(0.2), ht - 0.2], 0.025) || near(u, v, [x(0.27), ht - 0.07], [x(0.1), ht - 0.12], 0.02)
        || near(u, v, [x(0.23), ht - 0.14], [x(0.32), ht - 0.24], 0.02)) return c;
    }
  }
  if (top.style === "cat ears") {
    for (const s of [1, -1]) {
      const x = (k) => 0.5 + s * (k - 0.5);
      if (tri(u, v, [x(0.2), ht + 0.06], [x(0.4), ht + 0.03], [x(0.17), ht - 0.13])) return c2;
      if (tri(u, v, [x(0.1), ht + 0.12], [x(0.46), ht + 0.04], [x(0.13), ht - 0.18])) return c;
    }
  }
  if (top.style === "bear ears") {
    for (const s of [1, -1]) {
      const cx = 0.5 + s * 0.29;
      if (ell(u, v, cx, ht + 0.04, 0.06, 0.045)) return c2;
      if (ell(u, v, cx, ht + 0.03, 0.1, 0.075)) return c;
    }
  }
  if (extras["pointy ears"]) {
    const e = hex(extras["pointy ears"], hex(recipeHead.colour, C("#f5c8a8")));
    if (tri(u, v, [0.14, L.eye - 0.06], [0.14, L.eye + 0.08], [0.0, L.eye - 0.16])
      || tri(u, v, [0.86, L.eye - 0.06], [0.86, L.eye + 0.08], [1.0, L.eye - 0.16])) return e;
  }
  return null;
}

function eyesAt(u, v, f, eyes, L) {
  const c = hex(eyes.colour, COAL);
  for (const s of [-1, 1]) {
    const cx = 0.5 + s * L.dx, cy = L.eye;
    let got = null;
    switch (eyes.style) {
      case "dots": got = eyeAt(u, v, f, cx, cy, 0.045, 0.04, c); break;
      case "ovals": got = eyeAt(u, v, f, cx, cy, 0.065, 0.075, WHITE, c); break;
      case "big": got = eyeAt(u, v, f, cx, cy, 0.095, 0.105, WHITE, c); break;
      case "triangles": {
        const lid = cy - 0.07 + 0.12 * f.blink;
        if (v >= lid && tri(u, v, [cx - 0.08, cy + 0.04], [cx + 0.08, cy + 0.04], [cx, cy - 0.1])) got = c;
        break;
      }
      case "sockets":
        if (ell(u, v, cx, cy, 0.1, 0.09 * (1 - 0.7 * f.blink))) {
          got = f.blink < 0.5 && ell(u, v, cx + f.look * 0.03, cy, 0.025, 0.02) ? c : C("#141414");
        }
        break;
      case "cat":
        if (ell(u, v, cx, cy, 0.075, 0.07 * (1 - 0.85 * f.blink))) {
          got = f.blink < 0.5 && ell(u, v, cx + f.look * 0.03, cy, 0.016, 0.06) ? COAL : c;
        }
        break;
      default: break;
    }
    if (got) return got;
  }
  return null;
}

function noseAt(u, v, nose, L) {
  const ny = L.nose;
  switch (nose.style) {
    case "button": return ell(u, v, 0.5, ny, 0.045, 0.035) ? hex(nose.colour, C("#3a1a10")) : null;
    case "carrot": return tri(u, v, [0.48, ny - 0.03], [0.48, ny + 0.03], [0.75, ny + 0.02]) ? hex(nose.colour, C("#ff8a1e")) : null;
    case "triangle": return tri(u, v, [0.45, ny + 0.03], [0.55, ny + 0.03], [0.5, ny - 0.05]) ? hex(nose.colour, COAL) : null;
    case "beak": return tri(u, v, [0.42, ny - 0.04], [0.58, ny - 0.04], [0.5, ny + 0.06]) ? hex(nose.colour, C("#ff9a1e")) : null;
    case "long": return tri(u, v, [0.46, ny - 0.07], [0.54, ny - 0.07], [0.64, ny + 0.05]) ? hex(nose.colour, C("#5a9a3a")) : null;
    default: return null;
  }
}

function recipeMouthAt(u, v, f, mouth, L, skin) {
  const dark = hex(mouth.colour, DARK), cy = L.mouth, w = L.w;
  switch (mouth.style) {
    case "grin": {
      const [rx, ry] = mouthSize(f, w * 1.6, 0.09);
      if (ell(u, v, 0.5, cy, rx, ry + 0.018) && !(rect(u, v, 0.5 - rx * 0.5, cy - ry, 0.5 - rx * 0.28, cy - ry * 0.2)
        || rect(u, v, 0.5 + rx * 0.28, cy, 0.5 + rx * 0.5, cy + ry))) return hex(mouth.colour, C("#ffd24a"));
      return null;
    }
    case "teeth": {
      const [rx, ry] = mouthSize(f, w, 0.07);
      if (!rect(u, v, 0.5 - rx, cy - ry - 0.03, 0.5 + rx, cy + ry + 0.03)) return null;
      if (Math.abs(v - cy) <= ry) return C("#141414");
      return Math.floor((u - 0.5 + rx) * 28) % 2 ? mix(skin, 0.6) : skin;
    }
    case "small": {
      const [rx, ry] = mouthSize(f, w * 0.6, 0.11);
      return ell(u, v, 0.5, cy, rx * (f.shape === "e" ? 1.6 : 1), ry + 0.015) ? dark : null;
    }
    default: return mouthAt(u, v, f, 0.5, cy, w, 0.09, dark);
  }
}

// A face from its recipe at (u, v), or null for the background.
export function drawRecipe(r, u, v, f) {
  const head = r.head || {}, L = LAYOUT[head.shape] || LAYOUT.round, extras = r.extras || {};
  const skin = hex(head.colour, WHITE), top = r.top || {};
  const hat = topAt(u, v, top, L);
  if (hat) return hat;
  const inside = inHead(head.shape, u, v);
  if (!inside) {
    if (head.shape === "tree" && rect(u, v, 0.42, 0.95, 0.58, 1)) return C("#6a3a1a"); // the trunk
    if (extras.scarf && rect(u, v, 0.2, L.bottom - 0.04, 0.8, Math.min(L.bottom + 0.05, 1))) {
      const s = hex(extras.scarf, C("#d0202a"));
      return Math.floor(u * 12) % 2 ? s : mix(s, 0.75);
    }
    if (extras["bow tie"] && (tri(u, v, [0.5, L.bottom], [0.36, L.bottom - 0.04], [0.36, L.bottom + 0.05])
      || tri(u, v, [0.5, L.bottom], [0.64, L.bottom - 0.04], [0.64, L.bottom + 0.05]))) return hex(extras["bow tie"], C("#d0202a"));
    return behindAt(u, v, top, extras, head, L);
  }
  const m = recipeMouthAt(u, v, f, r.mouth || {}, L, skin);
  if (m) return m;
  const n = noseAt(u, v, r.nose || {}, L);
  if (n) return n;
  const e = eyesAt(u, v, f, r.eyes || {}, L);
  if (e) return e;
  if (extras.moustache && (ell(u, v, 0.4, L.mouth - 0.07, 0.11, 0.035) || ell(u, v, 0.6, L.mouth - 0.07, 0.11, 0.035))) return hex(extras.moustache, WHITE);
  if (r.cheeks && (ell(u, v, 0.5 - L.dx - 0.08, L.mouth - 0.08, 0.06, 0.04) || ell(u, v, 0.5 + L.dx + 0.08, L.mouth - 0.08, 0.06, 0.04))) return hex(r.cheeks, C("#f07090"));
  if (extras.whiskers) {
    for (const s of [-1, 1]) for (const dy of [-0.04, 0, 0.04]) {
      if (near(u, v, [0.5 + s * 0.13, L.nose + 0.02], [0.5 + s * 0.44, L.nose + 0.02 + dy * 1.4], 0.008)) return hex(extras.whiskers, C("#dddddd"));
    }
  }
  if (extras.beard && v > L.nose + 0.02 && ell(u, v, 0.5, L.mouth - 0.02, 0.44, 0.3)) {
    const b = hex(extras.beard, WHITE);
    return ell(u, v, 0.5, L.mouth - 0.04, 0.38, 0.25) ? b : mix(b, 0.82);
  }
  if (extras.baubles) {
    const b = hex(extras.baubles, C("#d0202a")), gold = C("#ffd24a");
    for (const [x, y, k] of [[0.24, 0.88, 0], [0.76, 0.88, 1], [0.5, 0.42, 1], [0.7, 0.77, 0], [0.3, 0.77, 1]]) {
      if (ell(u, v, x, y, 0.045, 0.034)) return k ? gold : b;
    }
  }
  const patch = head.patch || "none";
  if (patch !== "none") {
    const pc = hex(head.patchColour, WHITE);
    if (patch === "face" && ell(u, v, 0.5, L.eye + 0.1, 0.3, 0.26)) return pc;
    if (patch === "muzzle" && ell(u, v, 0.5, L.nose + 0.07, 0.2, 0.15)) return pc;
    if (patch === "chest" && ell(u, v, 0.5, L.bottom + 0.02, 0.34, 0.24)) return pc;
  }
  // Lit from the top left: the far edge a little darker.
  return inHead(head.shape, u + 0.035, v + 0.03) ? skin : mix(skin, 0.8);
}

// The built-in recipes (original characters made from the parts above).
export const BUILT_IN = {
  reindeer: { head: { shape: "oval", colour: "#8a5a2c", patch: "muzzle", patchColour: "#d8b080" }, eyes: { style: "ovals", colour: "#1a1a1a" },
    nose: { style: "button", colour: "#3a1a10" }, mouth: { style: "open" }, top: { style: "antlers", colour: "#e0c08a" } },
  elf: { head: { shape: "round", colour: "#f5c8a8" }, eyes: { style: "ovals", colour: "#2a6a2a" }, nose: { style: "button", colour: "#e8a080" },
    mouth: { style: "open" }, cheeks: "#f07090", top: { style: "elf hat", colour: "#1f8a3a", colour2: "#d0202a" }, extras: { "pointy ears": "#f5c8a8" } },
  "christmas tree": { head: { shape: "tree", colour: "#1f8a3a" }, eyes: { style: "ovals", colour: "#1a1a1a" }, nose: { style: "none" },
    mouth: { style: "open" }, top: { style: "star", colour: "#ffd24a" }, extras: { baubles: "#d0202a" } },
  penguin: { head: { shape: "oval", colour: "#34406a", patch: "face", patchColour: "#f4f8ff" }, eyes: { style: "ovals", colour: "#1a1a1a" },
    nose: { style: "beak", colour: "#ff9a1e" }, mouth: { style: "small" }, top: { style: "bobble hat", colour: "#d0202a", colour2: "#f4f8ff" },
    extras: { scarf: "#d0202a" } },
  robin: { head: { shape: "round", colour: "#8a5a2c", patch: "chest", patchColour: "#e8501e" }, eyes: { style: "ovals", colour: "#1a1a1a" },
    nose: { style: "beak", colour: "#3a2a1a" }, mouth: { style: "small" }, top: { style: "none" } },
  "teddy bear": { head: { shape: "round", colour: "#a06a3a", patch: "muzzle", patchColour: "#e0b888" }, eyes: { style: "dots", colour: "#1a1a1a" },
    nose: { style: "button", colour: "#2a1a10" }, mouth: { style: "open" }, top: { style: "bear ears", colour: "#a06a3a", colour2: "#e0b888" },
    extras: { "bow tie": "#d0202a" } },
  skull: { head: { shape: "skull", colour: "#efe8d8" }, eyes: { style: "sockets", colour: "#ff3020" }, nose: { style: "triangle", colour: "#141414" },
    mouth: { style: "teeth" } },
  witch: { head: { shape: "oval", colour: "#7ac05a" }, eyes: { style: "ovals", colour: "#1a1a1a" }, nose: { style: "long", colour: "#3f7a26" },
    mouth: { style: "open" }, top: { style: "witch hat", colour: "#3a2a5a", colour2: "#9a50d0" } },
  "black cat": { head: { shape: "round", colour: "#2c2c34" }, eyes: { style: "cat", colour: "#ffd24a" }, nose: { style: "button", colour: "#f07090" },
    mouth: { style: "small" }, top: { style: "cat ears", colour: "#2c2c34", colour2: "#f07090" }, extras: { whiskers: "#dddddd" } },
};

// Recipes as close as the parts allow to the five hand-drawn faces, so Duplicate works on those too.
export const LOOKALIKE = {
  snowman: { head: { shape: "round", colour: "#f4f8ff" }, eyes: { style: "dots", colour: "#1a1a1a" }, nose: { style: "carrot", colour: "#ff8a1e" },
    mouth: { style: "open" }, top: { style: "top hat", colour: "#1a1a1a", colour2: "#c0202a" } },
  pumpkin: { head: { shape: "wide", colour: "#f07818" }, eyes: { style: "triangles", colour: "#ffd24a" }, nose: { style: "triangle", colour: "#ffd24a" },
    mouth: { style: "grin", colour: "#ffd24a" } },
  gingerbread: { head: { shape: "round", colour: "#b8702e" }, eyes: { style: "dots", colour: "#1a1a1a" }, nose: { style: "none" },
    mouth: { style: "open" }, cheeks: "#f07090" },
  santa: { head: { shape: "round", colour: "#f5c8a8" }, eyes: { style: "dots", colour: "#1a1a1a" }, nose: { style: "button", colour: "#e86060" },
    mouth: { style: "open" }, top: { style: "santa hat", colour: "#d0202a", colour2: "#f4f8ff" }, extras: { beard: "#f4f8ff", moustache: "#f4f8ff" } },
  ghost: { head: { shape: "ghost", colour: "#f4f8ff" }, eyes: { style: "dots", colour: "#1a1a1a" }, nose: { style: "none" },
    mouth: { style: "small", colour: "#1a1a1a" } },
};

// A recipe made safe and complete: every part from its list, every colour a #rrggbb (anything else
// takes the default). Old or hand-edited recipes still draw. The server checks the same (server.py
// _clean_face).
export const NEW_FACE = { head: { shape: "round", colour: "#ffd24a", patch: "none", patchColour: "#ffffff" },
  eyes: { style: "ovals", colour: "#1a1a1a" }, nose: { style: "button", colour: "#e86060" }, mouth: { style: "open", colour: "#2a0a0a" },
  cheeks: "", top: { style: "none", colour: "#d0202a", colour2: "#ffffff" }, extras: {} };
const isHex = (h) => typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h);
export function cleanRecipe(r) {
  r = r && typeof r === "object" ? r : {};
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const col = (v, d) => (isHex(v) ? v.toLowerCase() : d);
  const part = (k) => (r[k] && typeof r[k] === "object" ? r[k] : {});
  const N = NEW_FACE, head = part("head"), eyes = part("eyes"), nose = part("nose"), mouth = part("mouth"), top = part("top");
  const extras = {};
  for (const e of RECIPE_PARTS.extras) if (r.extras && typeof r.extras === "object" && isHex(r.extras[e])) extras[e] = r.extras[e].toLowerCase();
  return {
    head: { shape: pick(head.shape, RECIPE_PARTS.head, "round"), colour: col(head.colour, N.head.colour),
      patch: pick(head.patch, RECIPE_PARTS.patch, "none"), patchColour: col(head.patchColour, N.head.patchColour) },
    eyes: { style: pick(eyes.style, RECIPE_PARTS.eyes, "ovals"), colour: col(eyes.colour, N.eyes.colour) },
    nose: { style: pick(nose.style, RECIPE_PARTS.nose, "none"), colour: col(nose.colour, N.nose.colour) },
    mouth: { style: pick(mouth.style, RECIPE_PARTS.mouth, "open"), colour: col(mouth.colour, N.mouth.colour) },
    cheeks: isHex(r.cheeks) ? r.cheeks.toLowerCase() : "",
    top: { style: pick(top.style, RECIPE_PARTS.top, "none"), colour: col(top.colour, N.top.colour), colour2: col(top.colour2, N.top.colour2) },
    extras,
  };
}

// The recipe to start from when duplicating a face: a built-in's own (or its lookalike), or one of yours.
export const recipeOf = (character) => cleanRecipe(BUILT_IN[character] || LOOKALIKE[character] || getFace(character)?.recipe || NEW_FACE);

// Your faces (Library → Faces): id -> {name, recipe}. The editor keeps them all here, as the Singing
// face effect can't wait for them; the bake worker and phones are sent copies.
const yours = new Map();
let facesChanged = 0;
export const facesVersion = () => facesChanged;
export const allFaces = () => [...yours];
export function setFaces(list) {
  yours.clear();
  for (const [id, f] of list) yours.set(id, f);
  facesChanged++;
}
export function keepFace(id, saved) {
  facesChanged++;
  yours.set(id, { name: String(saved?.name || "Face"), recipe: cleanRecipe(saved?.recipe) });
}
export const forgetFace = (id) => { facesChanged++; return yours.delete(id); };
export const getFace = (id) => yours.get(id);
export const faceList = () => [...yours].map(([id, f]) => ({ id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name));
export const isBuiltIn = (character) => CHARACTERS.includes(character);
// The built-in's name as people read it ("christmas tree" -> "Christmas tree").
export const builtInName = (c) => c.charAt(0).toUpperCase() + c.slice(1);

// Your faces a show's Singing faces use, with their recipes, for knowing when it needs baking again.
export function facesUsed(show) {
  const out = {};
  for (const t of show?.tracks || []) for (const c of t?.clips || []) {
    if (c?.effect === "singingface" && !isBuiltIn(c.character) && yours.has(c.character)) out[c.character] = yours.get(c.character).recipe;
  }
  return out;
}

const still = { mouth: 0, shape: "a", blink: 0, look: 0 };

// The character's colour at (u, v) in its box doing `face` (or, for older callers, with the mouth this
// open), or null for the background.
export function faceColour(character, u, v, face = 0) {
  const f = typeof face === "number" ? { ...still, mouth: face } : { ...still, ...face };
  f.mouth = Math.min(Math.max(f.mouth, 0), 1);
  if (BUILT_IN[character]) return drawRecipe(BUILT_IN[character], u, v, f);
  if (DRAW[character]) return DRAW[character](u, v, f);
  // One of yours; one that's been deleted (or not loaded) is a snowman, as an unknown character always was.
  const own = yours.get(character);
  return own ? drawRecipe(own.recipe, u, v, f) : DRAW.snowman(u, v, f);
}

// A recipe's colour at (u, v) doing `face`, for the face maker's preview before it's saved.
export const recipeColour = (recipe, u, v, face = {}) =>
  drawRecipe(recipe, u, v, { ...still, ...face, mouth: Math.min(Math.max(face.mouth ?? 0, 0), 1) });

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
