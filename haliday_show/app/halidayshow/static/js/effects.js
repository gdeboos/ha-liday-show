// Lighting effects, written once and used for both the live preview and the bake.
//
// Every effect is a pure function of (clip, seconds into the clip, segment count),
// so a preview frame and a baked frame at the same time are identical.

export const FPS = 40;

// The House lane's track id. Its clips run across every light by where its segments sit on the
// house photo, on top of each light's own effects.
export const HOUSE = "@house";
// A group lane's track id is this and the group's id. Its clips run across the group's lights and
// parts as if they were one long strip, in the Devices tab's order, or (House effects) by where they
// sit on the house photo, measured across just those lights. They sit over the lights' own effects.
export const GROUP = "@group:";
export const isGroupTrack = (id) => typeof id === "string" && id.startsWith(GROUP);

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function mix(a, b, u) {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return [r * 255, g * 255, b * 255];
}

// Small integer hash -> [0, 1), stable across runs so twinkle bakes the same way twice.
function hash01(a, b) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const color = (key, label, def) => ({ key, label, type: "color", default: def });
const num = (key, label, def, min, max, step) => ({ key, label, type: "number", default: def, min, max, step });
const choice = (key, label, def, options) => ({ key, label, type: "select", default: def, options });
const direction = choice("direction", "Direction", "forward", ["forward", "reverse"]);
const mod = (a, n) => ((a % n) + n) % n;
// 0 -> 1 -> 0 over each 2 units, so movement can bounce instead of jumping back.
const bounce = (x) => { const m = mod(x, 2); return m <= 1 ? m : 2 - m; };
const smooth = (u) => u * u * (3 - 2 * u);

// Random events (bursts, drops) at about `rate` a second, each lasting `life` seconds: calls
// fn(k, age) for every event k alive at t. Start times come from the stable hash, so a preview and a
// bake place them identically. `seed` keeps separate streams (one per icicle, say) apart.
function events(t, rate, life, seed, fn) {
  if (!(rate > 0)) return;
  for (let k = Math.floor((t - life) * rate) - 1; k <= Math.floor(t * rate); k++) {
    const age = t - (k + hash01(k + 7, seed) * 0.9) / rate;
    if (age >= 0 && age < life) fn(k, age);
  }
}
const add = (a, c, u) => { a[0] += c[0] * u; a[1] += c[1] * u; a[2] += c[2] * u; };

// Two or three solid colours side by side: split the light into equal bands, or alternate
// them every few segments along it.
function multiColour(label, colours) {
  return {
    label,
    params: [...colours, choice("layout", "Layout", "split", ["split", "alternate"]),
      num("size", "Segments per colour (alternate)", 1, 1, 50, 1),
      num("speed", "Move (segments per second)", 0, -50, 50, 0.5)],
    render: (p, t, dur, n, i) => {
      const k = colours.length;
      const pos = i - Math.floor(t * (p.speed || 0)); // moving bands make a marquee
      const idx = p.layout === "alternate" ? mod(Math.floor(pos / Math.max(1, p.size)), k)
        : Math.min(k - 1, Math.floor((mod(pos, n) * k) / n));
      return hexToRgb(p[colours[idx].key]);
    },
  };
}

// render(p, t, dur, n, i) returns the colour of segment i (0..n-1) at t seconds into the clip.
export const EFFECTS = {
  solid: {
    label: "Solid",
    params: [color("color", "Colour", "#ff0000")],
    render: (p) => hexToRgb(p.color),
  },
  duo: multiColour("Two colours", [color("color", "Colour 1", "#ff0000"), color("color2", "Colour 2", "#00ff00")]),
  trio: multiColour("Three colours", [color("color", "Colour 1", "#ff0000"), color("color2", "Colour 2", "#ffffff"),
    color("color3", "Colour 3", "#00ff00")]),
  pulse: {
    label: "Pulse",
    params: [color("color", "Colour", "#ff0000"), color("background", "Background", "#000000"),
      num("rate", "Pulses per second", 1, 0.05, 10, 0.05), choice("shape", "Shape", "smooth", ["smooth", "heartbeat"])],
    render: (p, t) => {
      if (p.shape !== "heartbeat") return mix(hexToRgb(p.background), hexToRgb(p.color), (1 - Math.cos(2 * Math.PI * t * p.rate)) / 2);
      // Lub-dub: a strong beat, then a softer one a fifth of the way through, each with a quick fall.
      const ph = mod(t * p.rate, 1);
      const beat = (at) => (ph >= at ? Math.exp(-(ph - at) / 0.05) : 0);
      return mix(hexToRgb(p.background), hexToRgb(p.color), Math.min(1, beat(0) + 0.7 * beat(0.2)));
    },
  },
  gradient: {
    label: "Gradient",
    params: [color("color", "Colour 1", "#ff0000"), color("color2", "Colour 2", "#0000ff"),
      color("color3", "Colour 3", "#00ff00"), choice("count", "Colours", "3", ["2", "3"]),
      num("speed", "Move (per second)", 0, -5, 5, 0.05)],
    render: (p, t, dur, n, i) => {
      const stops = [p.color, p.color2, p.color3].slice(0, Number(p.count)).map(hexToRgb);
      const u = bounce((n > 1 ? i / (n - 1) : 0) + t * p.speed) * (stops.length - 1);
      const k = Math.min(Math.floor(u), stops.length - 2);
      return mix(stops[k], stops[k + 1], u - k);
    },
  },
  cycle: {
    label: "Colour cycle",
    params: [color("color", "Colour 1", "#ff0000"), color("color2", "Colour 2", "#00ff00"),
      color("color3", "Colour 3", "#0000ff"), color("color4", "Colour 4", "#ffffff"),
      choice("count", "Colours", "4", ["2", "3", "4"]), num("rate", "Changes per second", 1, 0.05, 20, 0.05),
      choice("blend", "Change", "fade", ["fade", "step"])],
    render: (p, t) => {
      const cs = [p.color, p.color2, p.color3, p.color4].slice(0, Number(p.count)).map(hexToRgb);
      const s = t * p.rate, k = Math.floor(s) % cs.length;
      return p.blend === "step" ? cs[k] : mix(cs[k], cs[(k + 1) % cs.length], smooth(s - Math.floor(s)));
    },
  },
  fade: {
    label: "Fade",
    params: [color("from", "From", "#000000"), color("to", "To", "#ff0000")],
    render: (p, t, dur) => mix(hexToRgb(p.from), hexToRgb(p.to), dur > 0 ? Math.min(t / dur, 1) : 1),
  },
  chase: {
    label: "Chase",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000000"),
      num("width", "Width (segments)", 2, 1, 50, 1), num("speed", "Laps per second", 1, 0.05, 10, 0.05), direction],
    render: (p, t, dur, n, i) => {
      const head = (t * p.speed * n) % n;
      const pos = p.direction === "reverse" ? n - 1 - i : i;
      const behind = (head - pos + n) % n;
      return behind < p.width ? hexToRgb(p.color) : hexToRgb(p.background);
    },
  },
  rainbow: {
    label: "Rainbow",
    params: [num("speed", "Cycles per second", 0.5, 0, 10, 0.05), num("spread", "Rainbows across", 1, 0, 10, 0.1),
      direction],
    render: (p, t, dur, n, i) => {
      const pos = p.direction === "reverse" ? n - 1 - i : i;
      const h = (((pos / n) * p.spread - t * p.speed) % 1 + 1) % 1;
      return hsv(h, 1, 1);
    },
  },
  comet: {
    label: "Comet",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000000"),
      num("length", "Tail (segments)", 5, 1, 100, 1), num("speed", "Laps per second", 1, 0.05, 10, 0.05), direction,
      choice("trail", "Tail", "smooth", ["smooth", "sparkly"])],
    render: (p, t, dur, n, i) => {
      const head = mod(t * p.speed * n, n);
      const pos = p.direction === "reverse" ? n - 1 - i : i;
      const behind = mod(head - pos, n);
      if (behind >= p.length) return hexToRgb(p.background);
      let u = 1 - behind / p.length;
      // A sparkly tail (WLED's Meteor) breaks up as it fades: each segment of it flickers on its own.
      if (p.trail === "sparkly" && behind >= 1) u *= 0.25 + 0.75 * hash01(i + 1, Math.floor(t * 15));
      return mix(hexToRgb(p.background), hexToRgb(p.color), u);
    },
  },
  scanner: {
    label: "Scanner",
    params: [color("color", "Colour", "#ff0000"), color("background", "Background", "#000000"),
      num("width", "Width (segments)", 2, 1, 50, 0.5), num("speed", "Sweeps per second", 0.5, 0.05, 10, 0.05),
      choice("eyes", "Eyes", "one", ["one", "two"])],
    render: (p, t, dur, n, i) => {
      const head = bounce(t * p.speed) * (n - 1);
      // Two eyes mirror each other, crossing in the middle.
      const d = Math.min(Math.abs(i - head), p.eyes === "two" ? Math.abs(i - (n - 1 - head)) : Infinity);
      return mix(hexToRgb(p.background), hexToRgb(p.color), Math.max(0, 1 - d / p.width));
    },
  },
  flicker: {
    label: "Flicker",
    params: [color("color", "Colour", "#ff5000"), color("color2", "Hot colour", "#ffb000"),
      num("rate", "Flickers per second", 8, 0.5, 30, 0.5)],
    render: (p, t, dur, n, i) => {
      const s = t * p.rate, k = Math.floor(s);
      const v = hash01(i + 1, k) + (hash01(i + 1, k + 1) - hash01(i + 1, k)) * smooth(s - k);
      const c = mix(hexToRgb(p.color), hexToRgb(p.color2), v);
      const level = 0.35 + 0.65 * v;
      return [c[0] * level, c[1] * level, c[2] * level];
    },
  },
  lightning: {
    label: "Lightning",
    params: [color("color", "Flash", "#ffffff"), color("background", "Background", "#000010"),
      num("rate", "Strikes per second", 0.7, 0.05, 5, 0.05)],
    render: (p, t) => {
      // Ten chances a second to strike; each strike fades over its tenth of a second.
      const slot = Math.floor(t * 10);
      const strike = hash01(slot + 1, 7919) < p.rate / 10;
      const env = strike ? (1 - (t * 10 - slot)) ** 2 : 0;
      return mix(hexToRgb(p.background), hexToRgb(p.color), env);
    },
  },
  strobe: {
    label: "Strobe",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000000"),
      num("rate", "Flashes per second", 8, 0.5, 20, 0.5), num("duty", "On time %", 30, 5, 95, 5)],
    render: (p, t) => ((t * p.rate) % 1 < p.duty / 100 ? hexToRgb(p.color) : hexToRgb(p.background)),
  },
  twinkle: {
    label: "Twinkle",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000020"),
      num("density", "Density %", 30, 1, 100, 1), num("rate", "Twinkles per second", 4, 0.5, 20, 0.5)],
    render: (p, t, dur, n, i) => {
      const step = t * p.rate, k = Math.floor(step);
      if (hash01(i + 1, k) >= p.density / 100) return hexToRgb(p.background);
      const env = Math.sin((step - k) * Math.PI); // fade each twinkle in and out
      return mix(hexToRgb(p.background), hexToRgb(p.color), env);
    },
  },
  wipe: {
    label: "Wipe",
    params: [color("color", "Colour", "#00ff00"), color("background", "Background", "#000000"), direction],
    render: (p, t, dur, n, i) => {
      const filled = dur > 0 ? Math.min(t / dur, 1) * n : n;
      const pos = p.direction === "reverse" ? n - 1 - i : i;
      if (pos + 1 <= filled) return hexToRgb(p.color);
      if (pos >= filled) return hexToRgb(p.background);
      return mix(hexToRgb(p.background), hexToRgb(p.color), filled - pos);
    },
  },
};

// House effects colour a segment by where it sits on the house photo: u runs 0 to 1 from the
// leftmost traced light to the rightmost, v from the highest to the lowest. renderAt returns a
// colour, with an optional 4th value for how much of it to lay over the light's own effects
// (0 to 1), or null to leave them be. On a plain strip (the clip's thumbnail, the effect picker)
// render() shows the effect as if the strip ran left to right across the house.
const DIRECTIONS = ["left to right", "right to left", "top to bottom", "bottom to top", "out from centre",
  "in to centre"];
const houseDirection = choice("direction", "Direction", "left to right", DIRECTIONS);
const outside = choice("outside", "Elsewhere", "background colour", ["background colour", "lights' own effects"]);

function along(dir, u, v) {
  switch (dir) {
    case "right to left": return 1 - u;
    case "top to bottom": return v;
    case "bottom to top": return 1 - v;
    case "out from centre": return Math.min(Math.hypot(u - 0.5, v - 0.5) / Math.SQRT1_2, 1);
    case "in to centre": return 1 - Math.min(Math.hypot(u - 0.5, v - 0.5) / Math.SQRT1_2, 1);
    default: return u;
  }
}

// Colour `c` at strength a (0..1), over the background colour or over the light's own effects.
function layer(p, c, a) {
  if (p.outside === "lights' own effects") return a > 0 ? [...c, a] : null;
  return mix(hexToRgb(p.background), c, a);
}

function houseEffect(fx) {
  return {
    ...fx,
    house: true,
    render: (p, t, dur, n, i) => {
      const u = n > 1 ? i / (n - 1) : 0.5;
      const c = fx.renderAt(p, t, dur, u, u);
      return !c ? [0, 0, 0] : c.length > 3 ? c.slice(0, 3).map((v) => v * c[3]) : c;
    },
  };
}

Object.assign(EFFECTS, {
  sweep: houseEffect({
    label: "Sweep",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000000"), houseDirection,
      num("width", "Band width (share of the house)", 0.25, 0.02, 1, 0.01),
      num("sweeps", "Sweeps in the clip", 1, 1, 50, 1), outside],
    renderAt: (p, t, dur, u, v) => {
      const w = Math.max(Number(p.width) || 0.25, 0.01);
      const f = mod((t / dur) * Math.max(1, Math.round(p.sweeps || 1)), 1);
      const centre = -w + f * (1 + 2 * w);
      const a = smooth(Math.max(0, 1 - Math.abs(along(p.direction, u, v) - centre) / w));
      return layer(p, hexToRgb(p.color), a);
    },
  }),
  housewipe: houseEffect({
    label: "House wipe",
    params: [color("color", "Colour", "#ff0000"), color("background", "Background", "#000000"), houseDirection,
      num("soft", "Soft edge (share of the house)", 0.05, 0, 0.5, 0.01), outside],
    renderAt: (p, t, dur, u, v) => {
      const soft = Math.max(Number(p.soft) || 0, 0.001);
      const front = (t / dur) * (1 + soft);
      const a = Math.min(Math.max((front - along(p.direction, u, v)) / soft, 0), 1);
      return layer(p, hexToRgb(p.color), a);
    },
  }),
  wave: houseEffect({
    label: "Rainbow wave",
    params: [houseDirection, num("size", "Rainbows across the house", 1, 0.1, 10, 0.1),
      num("speed", "Speed (rainbows per second)", 0.5, -10, 10, 0.1)],
    renderAt: (p, t, dur, u, v) => hsv(mod(along(p.direction, u, v) * p.size - t * p.speed, 1), 1, 1),
  }),
});


// Festive effects, after WLED's: each is still a pure function of time, with randomness from hash01.
Object.assign(EFFECTS, {
  eyes: {
    label: "Halloween eyes", group: "festive",
    params: [color("color", "Eyes", "#ff3000"), color("background", "Background", "#000000"),
      num("pairs", "Pairs of eyes", 3, 1, 12, 1), num("size", "Eye size (segments)", 1, 1, 10, 1),
      num("gap", "Gap between eyes (segments)", 2, 0, 20, 1), num("stay", "Seconds each pair stays", 4, 1, 30, 0.5)],
    render: (p, t, dur, n, i) => {
      const size = Math.max(1, Math.round(p.size)), gap = Math.max(0, Math.round(p.gap)), span = size * 2 + gap;
      let a = 0;
      for (let j = 0; j < Math.round(p.pairs); j++) {
        const period = p.stay * (1 + hash01(j + 1, 3)), s = t / period + hash01(j + 1, 5), c = Math.floor(s), f = s - c;
        if (f > 0.8) continue; // gone for a while before the next pair appears
        const x = Math.floor(hash01(j * 977 + c, 9) * Math.max(1, n - span + 1));
        const d = i - x;
        if (d < 0 || d >= span || (d >= size && d < size + gap)) continue;
        // Open, blink once, close.
        const env = f < 0.1 ? f / 0.1 : f > 0.7 ? (0.8 - f) / 0.1 : f > 0.42 && f < 0.46 ? 0.05 : 1;
        a = Math.max(a, env);
      }
      return mix(hexToRgb(p.background), hexToRgb(p.color), a);
    },
  },
  fireworks: {
    label: "Fireworks", group: "festive",
    params: [color("color", "Colour 1", "#ff2000"), color("color2", "Colour 2", "#20ff40"), color("color3", "Colour 3", "#4060ff"),
      color("background", "Background", "#000000"), num("rate", "Bursts per second", 1.5, 0.1, 10, 0.1),
      num("size", "Burst size (segments)", 12, 1, 150, 1)],
    render: (p, t, dur, n, i) => {
      const out = hexToRgb(p.background), cols = [p.color, p.color2, p.color3].map(hexToRgb);
      events(t, p.rate, 1.5, 1, (k, age) => {
        const centre = hash01(k + 1, 11) * (n - 1), size = p.size * (0.6 + 0.4 * hash01(k + 1, 17));
        const r = size * (1 - Math.exp(-age * 5)), d = Math.abs(i - centre);
        if (d > r + 0.5) return;
        if (age < 0.08 && d < 1.5) { add(out, [255, 255, 255], 1); return; } // the bang
        const fade = (1 - age / 1.5) ** 2, edge = d > r - 1.5 ? 1 : 0.5;
        add(out, cols[Math.floor(hash01(k + 1, 13) * 3)], fade * edge * (0.55 + 0.45 * hash01(i + 1, Math.floor(t * 25) + k)));
      });
      return out;
    },
  },
  drip: {
    label: "Drip", group: "festive",
    params: [color("color", "Drop", "#a0d8ff"), color("background", "Background", "#000000"),
      num("rate", "Drops per second (each icicle)", 0.4, 0.05, 5, 0.05),
      num("length", "Icicle length (segments, 0 = the whole light)", 0, 0, 300, 1), direction],
    render: (p, t, dur, n, i) => {
      const len = p.length >= 1 ? Math.min(Math.round(p.length), n) : n;
      const pos = p.direction === "reverse" ? n - 1 - i : i;
      const icicle = Math.floor(pos / len), q = pos % len, size = Math.min(len, n - icicle * len);
      // A drop swells at the top, falls faster and faster, and splashes at the bottom.
      const grow = 0.8, fall = Math.sqrt((2 * Math.max(size - 1, 1)) / 120), life = grow + fall + 0.3;
      let a = 0;
      events(t, p.rate, life, icicle + 1, (k, age) => {
        if (age < grow) { if (q === 0) a = Math.max(a, age / grow); else if (q === 1) a = Math.max(a, (age / grow) * 0.25); return; }
        const tf = age - grow;
        if (tf < fall) {
          const y = 60 * tf * tf, behind = y - q;
          if (behind > -1 && behind < 4) a = Math.max(a, behind < 0 ? 1 + behind : Math.exp(-behind));
          return;
        }
        const sp = 1 - (tf - fall) / 0.3; // the splash
        if (q >= size - 2) a = Math.max(a, sp * (q === size - 1 ? 1 : 0.5));
      });
      return mix(hexToRgb(p.background), hexToRgb(p.color), Math.min(a, 1));
    },
  },
  candles: {
    label: "Candles", group: "festive",
    params: [color("color", "Flame", "#ff7010"), color("color2", "Bright flame", "#ffb040"),
      num("rate", "Flicker speed", 3, 0.5, 15, 0.5), num("size", "Segments per candle", 1, 1, 50, 1)],
    render: (p, t, dur, n, i) => {
      // Every candle flickers on its own: mostly steady, with now and then a draught that dips it.
      const g = Math.floor(i / Math.max(1, Math.round(p.size))) + 1;
      const s = t * p.rate, k = Math.floor(s);
      const v = hash01(g, k) + (hash01(g, k + 1) - hash01(g, k)) * smooth(s - k);
      const d = t * 0.5, m = Math.floor(d), w = smooth(d - m);
      const gust = (hash01(g + 500, m) < 0.15 ? 1 - w : 0) + (hash01(g + 500, m + 1) < 0.15 ? w : 0);
      const level = (0.72 + 0.28 * v) * (1 - 0.45 * gust * Math.sin(Math.PI * w));
      const c = mix(hexToRgb(p.color), hexToRgb(p.color2), v);
      return [c[0] * level, c[1] * level, c[2] * level];
    },
  },
  snow: {
    label: "Snow", group: "festive",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000000"),
      num("density", "Flakes %", 10, 1, 100, 1), num("speed", "Speed (segments per second)", 6, 0.5, 120, 0.5),
      num("length", "Trail (segments)", 1, 1, 20, 1), direction],
    render: (p, t, dur, n, i) => {
      const pos = p.direction === "reverse" ? n - 1 - i : i, len = Math.max(1, Math.round(p.length));
      let a = 0;
      // Two layers at different speeds, the slower one dimmer, so it looks deeper.
      for (const [speed, level, seed] of [[p.speed, 1, 31], [p.speed * 0.6, 0.45, 37]]) {
        const moved = t * speed;
        for (let c = Math.floor(pos - moved) - 1; c <= Math.floor(pos - moved) + len + 1; c++) {
          if (hash01(c, seed) >= p.density / 100) continue;
          const behind = c + moved - pos; // how far this segment is behind the flake's head
          const u = behind < 0 ? 1 + behind : behind < len ? 1 - behind / len : 0;
          if (u > 0) a = Math.max(a, u * level);
        }
      }
      return mix(hexToRgb(p.background), hexToRgb(p.color), Math.min(a, 1));
    },
  },
});


// Headings in the effect window, in order. House lane effects all go under "Across the house".
export const EFFECT_GROUPS = [["basics", "Basics"], ["movement", "Movement"], ["festive", "Sparkle and festive"],
  ["calm", "Calm"], ["house", "Across the house"]];
const GROUP_OF = { solid: "basics", duo: "basics", trio: "basics", pulse: "basics", gradient: "basics", cycle: "basics",
  fade: "basics", strobe: "basics", chase: "movement", rainbow: "movement", comet: "movement", scanner: "movement",
  wipe: "movement", flicker: "festive", lightning: "festive", twinkle: "festive" };
for (const [key, fx] of Object.entries(EFFECTS)) fx.group = fx.house ? "house" : fx.group || GROUP_OF[key] || "basics";

// Every effect gets a Brightness slider, applied after it renders. Rainbow had its own with the
// same key, so its older clips keep their level.
const BRIGHTNESS = { key: "brightness", label: "Brightness %", type: "range", default: 100, min: 0, max: 100, step: 1 };
for (const fx of Object.values(EFFECTS)) fx.params.push(BRIGHTNESS);

// Presets: named starting points for an effect's settings, since one effect covers many looks
// (three colours can sit still, alternate, or run as a marquee). A preset sets only the settings it
// names and keeps the clip's colours unless it names them. A value can be a function of the clip's
// current settings.
const nonBlack = (p, keys) => keys.map((k) => p[k]).find((c) => c && c.toLowerCase() !== "#000000") || "#ffffff";
const MULTI_PRESETS = [
  { label: "Still blocks", params: { layout: "split", speed: 0 } },
  { label: "Turning blocks", params: { layout: "split", speed: 3 } },
  { label: "Alternating", params: { layout: "alternate", size: 1, speed: 0 } },
  { label: "Wide stripes", params: { layout: "alternate", size: 3, speed: 0 } },
  { label: "Slow marquee", params: { layout: "alternate", size: 1, speed: 2 } },
  { label: "Fast marquee", params: { layout: "alternate", size: 1, speed: 8 } },
  { label: "Wide marquee", params: { layout: "alternate", size: 3, speed: 4 } },
];
export const PRESETS = {
  duo: MULTI_PRESETS,
  trio: MULTI_PRESETS,
  pulse: [
    { label: "Slow breathe", params: { rate: 0.3 } },
    { label: "Steady beat", params: { rate: 1.2, shape: "smooth" } },
    { label: "Heartbeat", params: { rate: 1.1, shape: "heartbeat" } },
    { label: "Fast pulse", params: { rate: 3 } },
  ],
  gradient: [
    { label: "Still", params: { speed: 0 } },
    { label: "Drift", params: { speed: 0.1 } },
    { label: "Flowing", params: { speed: 0.5 } },
    { label: "Two colours", params: { count: "2", speed: 0 } },
  ],
  cycle: [
    { label: "Slow fade", params: { rate: 0.3, blend: "fade" } },
    { label: "On the beat", params: { rate: 2, blend: "step" } },
    { label: "Rapid flash", params: { rate: 8, blend: "step" } },
  ],
  fade: [
    { label: "Fade in", params: { from: "#000000", to: (p) => nonBlack(p, ["to", "from"]) } },
    { label: "Fade out", params: { from: (p) => nonBlack(p, ["from", "to"]), to: "#000000" } },
  ],
  chase: [
    { label: "Single dot", params: { width: 1, speed: 0.3 } },
    { label: "Running block", params: { width: 4, speed: 1 } },
    { label: "Fast chase", params: { width: 2, speed: 3 } },
  ],
  rainbow: [
    { label: "Slow drift", params: { speed: 0.15, spread: 1 } },
    { label: "Spin", params: { speed: 2, spread: 1 } },
    { label: "Tight bands", params: { speed: 0.5, spread: 3 } },
    { label: "Whole light", params: { speed: 0.3, spread: 0 } },
  ],
  comet: [
    { label: "Shooting star", params: { length: 6, speed: 1.5 } },
    { label: "Long and slow", params: { length: 12, speed: 0.4 } },
    { label: "Short and fast", params: { length: 3, speed: 2.5 } },
    { label: "Meteor", params: { length: 15, speed: 0.6, trail: "sparkly" } },
  ],
  scanner: [
    { label: "Slow", params: { width: 2, speed: 0.3 } },
    { label: "Knight Rider", params: { width: 3, speed: 0.8 } },
    { label: "Fast and narrow", params: { width: 1, speed: 2 } },
    { label: "Twin scanner", params: { width: 3, speed: 0.5, eyes: "two" } },
  ],
  flicker: [
    { label: "Embers", params: { rate: 2 } },
    { label: "Candle", params: { rate: 5 } },
    { label: "Fire", params: { rate: 12 } },
  ],
  lightning: [
    { label: "Distant storm", params: { rate: 0.2 } },
    { label: "Storm", params: { rate: 0.7 } },
    { label: "Overhead", params: { rate: 2 } },
  ],
  strobe: [
    { label: "Slow flash", params: { rate: 2, duty: 30 } },
    { label: "Party", params: { rate: 8, duty: 30 } },
    { label: "Rapid", params: { rate: 16, duty: 20 } },
  ],
  twinkle: [
    { label: "Gentle", params: { density: 15, rate: 2 } },
    { label: "Starry", params: { density: 30, rate: 4 } },
    { label: "Sparkle storm", params: { density: 60, rate: 10 } },
    // Lit all over, with segments blinking out: the clip's colour becomes the background.
    { label: "Dark sparkle", params: { background: (p) => nonBlack(p, ["color", "background"]), color: "#000000", density: 20, rate: 4 } },
  ],
  wipe: [
    { label: "Forward", params: { direction: "forward" } },
    { label: "Reverse", params: { direction: "reverse" } },
  ],
  sweep: [
    { label: "Single sweep", params: { sweeps: 1, width: 0.25 } },
    { label: "Searchlight", params: { sweeps: 2, width: 0.1 } },
    { label: "Rolling bands", params: { sweeps: 6, width: 0.3 } },
    { label: "Rising", params: { direction: "bottom to top", sweeps: 1, width: 0.3 } },
    { label: "Burst", params: { direction: "out from centre", sweeps: 2, width: 0.2 } },
  ],
  housewipe: [
    { label: "Left to right", params: { direction: "left to right" } },
    { label: "Fill up", params: { direction: "bottom to top" } },
    { label: "From the middle", params: { direction: "out from centre" } },
  ],
  wave: [
    { label: "Slow wave", params: { size: 1, speed: 0.2 } },
    { label: "Fast wave", params: { size: 1, speed: 1.5 } },
    { label: "Many rainbows", params: { size: 3, speed: 0.5 } },
    { label: "Rising", params: { direction: "bottom to top", size: 1, speed: 0.5 } },
  ],
  eyes: [
    { label: "One pair", params: { pairs: 1, stay: 6 } },
    { label: "Crowd", params: { pairs: 8, stay: 3 } },
    { label: "Green goblins", params: { color: "#40ff00", pairs: 4 } },
  ],
  fireworks: [
    { label: "Finale", params: { rate: 6, size: 15 } },
    { label: "Slow and big", params: { rate: 0.5, size: 30 } },
    { label: "Gold", params: { color: "#ffb000", color2: "#ffd060", color3: "#ffffff" } },
  ],
  drip: [
    { label: "Icicles", params: { length: 10, rate: 0.3 } },
    { label: "Steady drip", params: { length: 0, rate: 1 } },
  ],
  candles: [
    { label: "Calm", params: { rate: 1.5 } },
    { label: "Draughty", params: { rate: 6 } },
  ],
  snow: [
    { label: "Light snow", params: { density: 5, speed: 4 } },
    { label: "Blizzard", params: { density: 30, speed: 25, length: 2 } },
    { label: "Rain", params: { color: "#4080ff", density: 15, speed: 40, length: 4 } },
  ],
};

// The settings `preset` gives a clip whose settings are `p`.
export function presetParams(preset, p) {
  return Object.fromEntries(Object.entries(preset.params).map(([k, v]) => [k, typeof v === "function" ? v(p) : v]));
}

// Whether a clip's settings already match a preset.
export function matchesPreset(preset, p) {
  // A clip saved before a setting existed has that setting's default.
  if (EFFECTS[p.effect]) p = { ...defaultParams(p.effect), ...p };
  return Object.entries(presetParams(preset, p)).every(([k, v]) => String(p[k]) === String(v));
}

export function defaultParams(effect) {
  return Object.fromEntries(EFFECTS[effect].params.map((p) => [p.key, p.default]));
}

export function newClip(effect, start, end) {
  return { effect, start, end, ...defaultParams(effect) };
}

// Lays the House lane's clips over a light's frame. pos holds each segment's [u, v] on the house,
// or null for one that isn't on the photo (those keep their own colours).
export function applyHouse(clips, time, pos, out) {
  for (const clip of clips) {
    if (time < clip.start || time >= clip.end) continue;
    const fx = EFFECTS[clip.effect];
    if (!fx?.house) continue;
    const p = { ...defaultParams(clip.effect), ...clip };
    const t = time - clip.start, dur = clip.end - clip.start;
    const level = Math.min(Math.max(Number(p.brightness ?? 100), 0), 100) / 100;
    for (let i = 0; i < pos.length; i++) {
      if (!pos[i]) continue;
      const c = fx.renderAt(p, t, dur, pos[i][0], pos[i][1]);
      if (!c) continue;
      const a = c.length > 3 ? c[3] : 1;
      for (let k = 0; k < 3; k++) out[i * 3 + k] = clamp(out[i * 3 + k] * (1 - a) + c[k] * level * a);
    }
  }
  return out;
}

// How each group lane plays: for every light it touches, which of the light's segments are which
// stretch of the group's strip. `groups` is [{id, members: [light or part id]}]; `lights` the
// physical lights in the Devices tab's order. A member that's a split light covers all its parts.
export function planGroups(groups, lights, trackOf, positions = {}) {
  const plans = [];
  for (const g of groups || []) {
    const clips = trackOf(GROUP + g.id)?.clips || [];
    if (!clips.length) continue;
    const want = new Set(g.members || []);
    const ranges = [];
    for (const light of lights) {
      const parts = light.parts?.length ? light.parts : null;
      const pieces = !parts ? (want.has(light.id) ? [{ from: 1, to: light.segments, pos: light.id }] : [])
        : parts.filter((p) => want.has(light.id) || want.has(`${light.id}#${p.id}`))
          .map((p) => ({ from: p.from, to: p.to, pos: `${light.id}#${p.id}` }));
      for (const p of pieces) ranges.push({ light: light.id, start: p.from - 1, n: p.to - p.from + 1, pos: p.pos });
    }
    if (!ranges.length) continue;
    let offset = 0, box = null;
    for (const r of ranges) {
      r.offset = offset;
      offset += r.n;
      for (const q of positions[r.pos] || []) {
        if (!q) continue;
        box ||= [q[0], q[1], q[0], q[1]];
        box = [Math.min(box[0], q[0]), Math.min(box[1], q[1]), Math.max(box[2], q[0]), Math.max(box[3], q[1])];
      }
    }
    plans.push({ id: g.id, clips, ranges, total: offset, box, at: null, strip: null });
  }
  return plans;
}

// Lays the group lanes' clips over a light's frame (all its segments, `out`).
export function applyGroups(plans, light, time, positions, out) {
  for (const plan of plans) {
    const mine = plan.ranges.filter((r) => r.light === light);
    if (!mine.length) continue;
    const live = plan.clips.filter((c) => time >= c.start && time < c.end);
    if (!live.length) continue;
    // The strip is the same for every light in the group, so it's worked out once a frame.
    if (plan.at !== time) {
      const plain = live.filter((c) => !EFFECTS[c.effect]?.house);
      plan.strip = plain.length ? renderTrack(plain, time, plan.total) : null;
      plan.at = time;
    }
    const house = live.filter((c) => EFFECTS[c.effect]?.house);
    for (const r of mine) {
      const slice = out.subarray(r.start * 3, (r.start + r.n) * 3);
      if (plan.strip) slice.set(plan.strip.subarray(r.offset * 3, (r.offset + r.n) * 3));
      const pos = positions[r.pos];
      if (house.length && pos && plan.box) {
        const [u0, v0, u1, v1] = plan.box;
        const across = (q) => q && [u1 > u0 ? (q[0] - u0) / (u1 - u0) : 0.5, v1 > v0 ? (q[1] - v0) / (v1 - v0) : 0.5];
        applyHouse(house, time, pos.slice(0, r.n).map(across), slice);
      }
    }
  }
  return out;
}

// Clips later in the list sit on top. Uncovered segments are black.
export function renderTrack(clips, time, n, out = new Uint8Array(n * 3)) {
  out.fill(0);
  for (const clip of clips) {
    if (time < clip.start || time >= clip.end) continue;
    const fx = EFFECTS[clip.effect];
    if (!fx) continue;
    const p = { ...defaultParams(clip.effect), ...clip };
    const t = time - clip.start, dur = clip.end - clip.start;
    const level = Math.min(Math.max(Number(p.brightness ?? 100), 0), 100) / 100;
    for (let i = 0; i < n; i++) {
      const c = fx.render(p, t, dur, n, i);
      out[i * 3] = clamp(c[0] * level);
      out[i * 3 + 1] = clamp(c[1] * level);
      out[i * 3 + 2] = clamp(c[2] * level);
    }
  }
  return out;
}

const clamp = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

export function showDuration(show) {
  let end = show.duration || 0;
  for (const tr of show.tracks || []) for (const c of tr.clips) end = Math.max(end, c.end);
  return end;
}

// A whole physical light's colours at `time`. `trackOf(id)` finds a track by device id. A light
// split into parts plays its own track across the parts joined end to end (as if the unused
// segments weren't there), unless `whole` is false, and each part's track wins on that part while
// one of its clips is running. Segments outside every part stay off. Group lanes (`groups`, from
// planGroups) go over that, and the House lane over everything.
export function composeLight(light, trackOf, time, positions = {}, houseClips = [], out = new Uint8Array(light.segments * 3), groups = []) {
  out.fill(0);
  if (!light.parts?.length) {
    const tr = trackOf(light.id);
    if (tr) renderTrack(tr.clips, time, light.segments, out);
    if (groups.length) applyGroups(groups, light.id, time, positions, out);
    if (houseClips.length && positions[light.id]) applyHouse(houseClips, time, positions[light.id], out);
    return out;
  }
  const joined = light.parts.reduce((n, p) => n + p.to - p.from + 1, 0);
  const whole = light.whole === false ? null : trackOf(light.id);
  const all = whole?.clips.length ? renderTrack(whole.clips, time, joined) : null;
  let k = 0;
  for (const p of light.parts) {
    const n = p.to - p.from + 1, id = `${light.id}#${p.id}`;
    const slice = out.subarray((p.from - 1) * 3, p.to * 3);
    const tr = trackOf(id);
    if (tr?.clips.some((c) => time >= c.start && time < c.end)) renderTrack(tr.clips, time, n, slice);
    else if (all) slice.set(all.subarray(k * 3, (k + n) * 3));
    k += n;
  }
  if (groups.length) applyGroups(groups, light.id, time, positions, out);
  if (houseClips.length) {
    for (const p of light.parts) {
      const id = `${light.id}#${p.id}`;
      if (positions[id]) applyHouse(houseClips, time, positions[id], out.subarray((p.from - 1) * 3, p.to * 3));
    }
  }
  return out;
}

// The show's own dimming for one physical light, 0–1: Show settings' whole-show level times that
// light's level in this show. Both are optional percentages; a missing or odd one counts as 100.
export function showLevel(show, lightId) {
  const pct = (v) => {
    const n = Number(v ?? 100);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) / 100 : 1;
  };
  return pct(show?.brightness) * pct(show?.lightBrightness?.[lightId]);
}

// Scales a frame in place by `level` (0–1) and returns it.
export function dim(rgb, level) {
  if (level >= 1) return rgb;
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(rgb[i] * level);
  return rgb;
}

// Bake every frame into the layout the Python player reads (see baked.py): one track per physical
// light, in the order lights first appear in the show. devices maps a track's device id to its
// light {segments, parts?}, or to a part of one ("lightId#partId", with parent, from and to,
// 1-based and inclusive); `light` on an entry points at the physical light when the entry stands
// for all of a split light's parts. Tracks without a known device are skipped. positions maps
// device id -> each segment's [u, v] on the house (or null), for the House lane's clips. groups are
// the light groups ({id, members}) for the group lanes; their strips run in the show's track order,
// which is the Devices tab's.
export function bake(show, devices, fps = FPS, positions = {}, groups = []) {
  const tracks = show.tracks || [];
  const houseClips = tracks.find((tr) => tr.device === HOUSE)?.clips || [];
  const byId = new Map(tracks.map((tr) => [tr.device, tr]));
  const trackOf = (id) => byId.get(id);
  const lights = [], seen = new Set();
  for (const tr of tracks) {
    const dev = devices[tr.device];
    const id = dev?.parent || tr.device, entry = devices[id];
    if (!entry || seen.has(id)) continue;
    seen.add(id);
    lights.push({ ...(entry.light || entry), id });
  }
  const header = {
    fps,
    frames: Math.ceil(showDuration(show) * fps),
    tracks: lights.map((l) => ({ device: l.id, segments: l.segments })),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const stride = header.tracks.reduce((s, t) => s + t.segments * 3, 0);
  const out = new Uint8Array(9 + headerBytes.length + header.frames * stride);
  out.set([0x47, 0x56, 0x53, 0x46, 1], 0); // "GVSF", version 1
  new DataView(out.buffer).setUint32(5, headerBytes.length);
  out.set(headerBytes, 9);
  let off = 9 + headerBytes.length;
  const levels = lights.map((l) => showLevel(show, l.id));
  const plans = planGroups(groups, lights, trackOf, positions);
  for (let f = 0; f < header.frames; f++) {
    const time = f / fps;
    for (const [k, l] of lights.entries()) {
      dim(composeLight(l, trackOf, time, positions, houseClips, out.subarray(off, off + l.segments * 3), plans), levels[k]);
      off += l.segments * 3;
    }
  }
  return out;
}
