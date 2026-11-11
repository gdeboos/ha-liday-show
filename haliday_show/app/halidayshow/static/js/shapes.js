// Shaped props (a star, a wreath, a spinner, a vendor's coroplast snowflake): a light whose LEDs sit in
// a shape rather than along a line or across a full grid. A shape is a "sparse matrix": a small grid
// where some cells hold an LED, each cell saying which LED along the wire it is:
//   shape: {w, h, cells: [LED index per cell, or -1], source, params}
// The light's LED count is the highest index plus one. Frames stay in wiring order (LED 1 first), so
// nothing needs reordering when a show is baked; effects place each LED by where it sits in the shape.

export const MAX_SHAPE_LEDS = 4096;
export const MAX_SHAPE_SIDE = 200;
export const MAX_SHAPE_CELLS = 40000;
export const SHAPE_SOURCES = ["xmodel", "star", "circle", "spinner", "cane", "frame"];

// The built-in shapes: what each is called and the numbers that make it, with their limits.
export const BUILT_IN_SHAPES = {
  star: { label: "Star", params: [
    { key: "points", label: "Points", min: 3, max: 12, default: 5 },
    { key: "perPoint", label: "LEDs per point", min: 2, max: 400, default: 20 }] },
  circle: { label: "Circle or wreath", params: [
    { key: "rings", label: "Rings", min: 1, max: 12, default: 1 },
    { key: "perRing", label: "LEDs per ring", min: 3, max: 1000, default: 50 }] },
  spinner: { label: "Spinner", params: [
    { key: "arms", label: "Arms", min: 2, max: 32, default: 8 },
    { key: "perArm", label: "LEDs per arm", min: 2, max: 400, default: 16 }] },
  cane: { label: "Candy cane", params: [
    { key: "leds", label: "LEDs", min: 4, max: 1000, default: 50 }] },
  frame: { label: "Window frame", params: [
    { key: "across", label: "LEDs across", min: 1, max: 500, default: 30 },
    { key: "down", label: "LEDs down each side", min: 1, max: 500, default: 40 }] },
};

const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : d;
};

// A built-in shape's numbers, each within its limits (missing ones take the default).
export function shapeParams(source, params = {}) {
  const def = BUILT_IN_SHAPES[source];
  if (!def) return {};
  return Object.fromEntries(def.params.map((q) => [q.key, clampInt(params[q.key], q.min, q.max, q.default)]));
}

// Each LED's spot, [x, y] with y down, in any units, LED 1 first.
function spots(source, p) {
  const out = [], TAU = 2 * Math.PI;
  // An angle from the top, clockwise, as a point at radius r.
  const at = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];
  if (source === "star") {
    // Round the outline from the top point, clockwise: out to each tip and back in between.
    const corners = [];
    for (let k = 0; k < p.points * 2; k++) corners.push(at((k * Math.PI) / p.points, k % 2 ? 0.42 : 1));
    corners.push(corners[0]);
    const lens = corners.slice(1).map((c, k) => Math.hypot(c[0] - corners[k][0], c[1] - corners[k][1]));
    const total = lens.reduce((a, b) => a + b, 0), n = p.points * p.perPoint;
    for (let i = 0; i < n; i++) {
      let d = (i / n) * total, k = 0;
      while (k < lens.length - 1 && d > lens[k]) d -= lens[k++];
      const f = d / lens[k], a = corners[k], b = corners[k + 1];
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  } else if (source === "circle") {
    // Outer ring first, each from the top, clockwise.
    for (let r = 0; r < p.rings; r++) {
      const rad = p.rings > 1 ? 1 - (0.6 * r) / (p.rings - 1) : 1;
      for (let i = 0; i < p.perRing; i++) out.push(at((TAU * i) / p.perRing, rad));
    }
  } else if (source === "spinner") {
    // Each arm from near the middle outwards, the first pointing up, then clockwise.
    for (let a = 0; a < p.arms; a++) {
      for (let i = 0; i < p.perArm; i++) out.push(at((TAU * a) / p.arms, 0.12 + (0.88 * i) / Math.max(p.perArm - 1, 1)));
    }
  } else if (source === "cane") {
    // Up the stick from the bottom, then round the hook to the right.
    const stick = 1.5, r = 0.35, hook = Math.PI * r, total = stick + hook;
    for (let i = 0; i < p.leds; i++) {
      const d = (i / (p.leds - 1)) * total;
      if (d <= stick) out.push([0, stick - d]);
      else { const a = Math.PI - (d - stick) / r; out.push([r + Math.cos(a) * r, -Math.sin(a) * r]); }
    }
  } else if (source === "frame") {
    // From the top left: along the top, down the right, back along the bottom and up the left.
    const W = p.across + 1, H = p.down + 1;
    for (let i = 0; i < p.across; i++) out.push([i + 1, 0]);
    for (let i = 0; i < p.down; i++) out.push([W, i + 1]);
    for (let i = 0; i < p.across; i++) out.push([p.across - i, H]);
    for (let i = 0; i < p.down; i++) out.push([0, p.down - i]);
  }
  return out;
}

// Lays LED spots into a grid as small as keeps every LED in its own cell (up to the size limits; past
// those, an LED that lands on a taken cell goes to the nearest free one).
export function rasterise(points) {
  const n = points.length;
  if (!n) return null;
  const xs = points.map((q) => q[0]), ys = points.map((q) => q[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), spanX = Math.max(...xs) - x0, spanY = Math.max(...ys) - y0;
  const big = Math.max(spanX, spanY) || 1;
  const fit = (side) => {
    const w = Math.max(1, Math.round((spanX / big) * (side - 1)) + 1), h = Math.max(1, Math.round((spanY / big) * (side - 1)) + 1);
    const at = points.map(([x, y]) => [w > 1 ? Math.round(((x - x0) / (spanX || 1)) * (w - 1)) : 0, h > 1 ? Math.round(((y - y0) / (spanY || 1)) * (h - 1)) : 0]);
    return { w, h, at };
  };
  let side = Math.max(2, Math.ceil(Math.sqrt(n)));
  let best = null;
  for (; side <= MAX_SHAPE_SIDE; side = Math.ceil(side * 1.15) + 1) {
    const f = fit(side);
    if (f.w * f.h > MAX_SHAPE_CELLS) break;
    best = f;
    if (new Set(f.at.map(([x, y]) => y * f.w + x)).size === n) break;
  }
  best ||= fit(2);
  const cells = new Array(best.w * best.h).fill(-1);
  best.at.forEach(([x, y], i) => {
    let c = y * best.w + x;
    if (cells[c] >= 0) c = nearestFree(cells, best.w, best.h, x, y);
    if (c >= 0) cells[c] = i;
  });
  return { w: best.w, h: best.h, cells };
}

function nearestFree(cells, w, h, x, y) {
  for (let r = 1; r < Math.max(w, h); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h && cells[Y * w + X] < 0) return Y * w + X;
    }
  }
  return -1;
}

// A built-in shape, ready to save on a light.
export function builtInShape(source, params) {
  const p = shapeParams(source, params);
  const grid = rasterise(spots(source, p));
  return grid && { ...grid, source, params: p };
}

// Its LED count (the highest LED in it, plus one). Asked for every frame, so kept.
const ledCounts = new WeakMap();
export function shapeLeds(shape) {
  if (!shape?.cells?.length) return 0;
  let n = ledCounts.get(shape);
  if (n === undefined) {
    n = 0;
    for (const c of shape.cells) if (c + 1 > n) n = c + 1;
    ledCounts.set(shape, n);
  }
  return n;
}

// A light's shape, or null. One whose LED count no longer matches its shape plays as a strip.
export function shapeOf(light) {
  const s = light?.shape;
  if (!s || !(s.w >= 1) || !(s.h >= 1) || !Array.isArray(s.cells) || s.cells.length !== s.w * s.h) return null;
  return shapeLeds(s) === light.segments ? s : null;
}

// Where each LED is: x, y in cells (an LED in several cells sits in their middle; one in none is NaN),
// u, v across and down the shape from 0 to 1, and its angle (0 at the top, clockwise, 0 to 1) and
// distance (0 to 1) from the shape's middle.
const layouts = new WeakMap();
export function shapeLayout(shape) {
  let L = layouts.get(shape);
  if (L) return L;
  const n = shapeLeds(shape), x = new Float64Array(n), y = new Float64Array(n), k = new Float64Array(n);
  shape.cells.forEach((led, c) => {
    if (led < 0) return;
    x[led] += c % shape.w; y[led] += Math.floor(c / shape.w); k[led]++;
  });
  // A built-in shape knows exactly where its LEDs are, rather than to the nearest cell, so a wreath's
  // rings line up exactly when they chase round.
  const exact = BUILT_IN_SHAPES[shape.source] ? spots(shape.source, shapeParams(shape.source, shape.params)) : null;
  if (exact?.length === n) {
    const xs = exact.map((q) => q[0]), ys = exact.map((q) => q[1]);
    const ex0 = Math.min(...xs), ey0 = Math.min(...ys), sx = Math.max(...xs) - ex0 || 1, sy = Math.max(...ys) - ey0 || 1;
    for (let i = 0; i < n; i++) {
      x[i] = shape.w > 1 ? ((exact[i][0] - ex0) / sx) * (shape.w - 1) : 0;
      y[i] = shape.h > 1 ? ((exact[i][1] - ey0) / sy) * (shape.h - 1) : 0;
      k[i] = 1;
    }
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (k[i]) {
      if (!exact || exact.length !== n) { x[i] /= k[i]; y[i] /= k[i]; }
      x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]); y0 = Math.min(y0, y[i]); y1 = Math.max(y1, y[i]);
    } else x[i] = y[i] = NaN;
  }
  const useExact = exact?.length === n;
  const ecx = useExact ? (Math.min(...exact.map((q) => q[0])) + Math.max(...exact.map((q) => q[0]))) / 2 : 0;
  const ecy = useExact ? (Math.min(...exact.map((q) => q[1])) + Math.max(...exact.map((q) => q[1]))) / 2 : 0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, u = new Float64Array(n), v = new Float64Array(n);
  const angle = new Float64Array(n), dist = new Float64Array(n);
  let far = 0;
  for (let i = 0; i < n; i++) {
    u[i] = shape.w > 1 ? x[i] / (shape.w - 1) : 0.5;
    v[i] = shape.h > 1 ? y[i] / (shape.h - 1) : 0.5;
    // A star, wreath or spinner turns about its own middle, which isn't always its box's middle (a
    // star's top point reaches further than its lower ones); exact spots also keep its true proportions.
    const [dx, dy] = !useExact ? [x[i] - cx, y[i] - cy]
      : ROUND_SHAPES.includes(shape.source) ? exact[i] : [exact[i][0] - ecx, exact[i][1] - ecy];
    dist[i] = Math.hypot(dx, dy);
    if (dist[i] > far) far = dist[i];
    angle[i] = (((Math.atan2(dx, -dy) / (2 * Math.PI)) % 1) + 1) % 1;
  }
  for (let i = 0; i < n; i++) dist[i] = far ? dist[i] / far : 0;
  // How close two LEDs' angles or distances must be to count as level: exact for built-ins, half a
  // cell for a model drawn on a grid.
  const fuzz = exact?.length === n ? 1e-6 : 0.5;
  L = { n, w: shape.w, h: shape.h, x, y, u, v, angle, dist, arms: armsOf(shape), runs: {},
    tolAngle: fuzz / (2 * Math.PI * Math.max(far, 1)), tolDist: fuzz / Math.max(far, 1) };
  layouts.set(shape, L);
  return L;
}

const ROUND_SHAPES = ["star", "circle", "spinner"];
const armsOf = (shape) => clampInt(shape.params?.arms ?? shape.params?.points ?? 1, 1, 64, 1);

// How a strip effect plays on a shape (a clip's `runs`): along the wire, round the shape, out from the
// middle, out along each arm, or across or down it.
export const SHAPE_RUNS = ["strip", "round", "out", "arms", "rows", "columns"];
export const shapeRunsOf = (clip) => (SHAPE_RUNS.includes(clip?.runs) ? clip.runs : "strip");

// For a way of running, how long a strip the effect plays (len) and which spot along it each LED shows
// (index). LEDs at the same angle, distance or place show the same spot, so a wreath's rings chase
// round together and a spinner's arms light out together.
export function shapeRuns(L, runs) {
  if (L.runs[runs]) return L.runs[runs];
  const index = new Int32Array(L.n);
  let len = L.n;
  if (runs === "strip" || !SHAPE_RUNS.includes(runs)) {
    for (let i = 0; i < L.n; i++) index[i] = i;
  } else if (runs === "arms") {
    // Each arm (a star's point, a spinner's arm) from the middle out; all arms play the same strip.
    const arm = new Int32Array(L.n);
    for (let i = 0; i < L.n; i++) arm[i] = Math.floor(((L.angle[i] + 0.5 / L.arms + 1e-9) % 1) * L.arms) % L.arms; // a spot right between two arms goes to the later one
    len = 0;
    for (let a = 0; a < L.arms; a++) {
      const mine = [];
      for (let i = 0; i < L.n; i++) if (arm[i] === a) mine.push(i);
      len = Math.max(len, rankInto(mine, (i) => L.dist[i], L.tolDist, index));
    }
  } else {
    const key = runs === "round" ? (i) => L.angle[i] : runs === "out" ? (i) => L.dist[i] : runs === "rows" ? (i) => L.x[i] : (i) => L.y[i];
    const tol = runs === "round" ? L.tolAngle : runs === "out" ? L.tolDist : 0.5;
    len = rankInto(Array.from({ length: L.n }, (_, i) => i), key, tol, index);
  }
  return (L.runs[runs] = { len: Math.max(len, 1), index });
}

// Puts each LED's rank by key into index (LEDs whose keys are within tol share one); returns how many
// ranks there are. LEDs not in the shape (NaN) go last.
function rankInto(leds, key, tol, index) {
  const sorted = leds.slice().sort((a, b) => (key(a) || 0) - (key(b) || 0) || a - b);
  let rank = -1, last = -Infinity;
  for (const i of sorted) {
    const k = key(i);
    if (!(k - last <= tol)) { rank++; last = k; }
    index[i] = rank;
  }
  return rank + 1;
}

// Test wiring: LED 1 white and the rest through the rainbow in wiring order, so a wrong start or a
// wire running the other way shows at once.
export function shapeTestFrame(n) {
  const out = new Uint8Array(n * 3);
  for (let i = 1; i < n; i++) {
    const h = ((i - 1) / Math.max(n - 1, 1)) * 0.8 * 6, f = h % 1, s = Math.floor(h);
    const rgb = [[1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f]][s];
    for (let j = 0; j < 3; j++) out[i * 3 + j] = Math.round(rgb[j] * 255);
  }
  out.set([255, 255, 255], 0);
  return out;
}

// An xLights model file (.xmodel): its grid of node numbers, and its submodels as bits. Only custom
// models carry a grid; other kinds are refused with a message.
export function parseXmodel(text) {
  const doc = String(text || "");
  const root = doc.match(/<\s*([A-Za-z]+)\b([^>]*)>/g)?.find((t) => !/^<\s*\?/.test(t));
  if (!root) throw new Error("That isn't an xLights model file");
  const tag = root.match(/<\s*([A-Za-z]+)/)[1];
  if (tag.toLowerCase() !== "custommodel") throw new Error("Only xLights custom models have their own pixel map. Pick a built-in shape for this one");
  const attr = (src, name) => {
    const m = src.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
    return m ? unescapeXml(m[1]) : undefined;
  };
  const name = (attr(root, "name") || "").slice(0, 64);
  let w = Number(attr(root, "parm1")), h = Number(attr(root, "parm2"));
  const nodes = []; // [node (1-based), x, y]
  const plain = attr(root, "CustomModel");
  if (plain && plain.replace(/[;,|\s]/g, "")) {
    // Rows split by ";", cells by ","; layers (deep models) by "|", all laid flat over each other.
    for (const layer of plain.split("|")) {
      layer.split(";").forEach((row, y) => row.split(",").forEach((cell, x) => {
        const v = parseInt(cell, 10);
        if (v > 0) nodes.push([v, x, y]);
      }));
    }
  } else {
    const packed = attr(root, "CustomModelCompressed") || "";
    const parts = packed.split(";").map((e) => e.split(",").map((s) => parseInt(s, 10))).filter((e) => e.length >= 3 && e.every(Number.isFinite));
    for (const [v, r, c] of parts) if (v > 0) nodes.push([v, c, r]);
  }
  if (!nodes.length) throw new Error("That model has no pixels in it");
  w = Math.max(w || 0, ...nodes.map((q) => q[1] + 1));
  h = Math.max(h || 0, ...nodes.map((q) => q[2] + 1));
  const leds = Math.max(...nodes.map((q) => q[0]));
  if (leds > MAX_SHAPE_LEDS) throw new Error(`That model has ${leds} pixels; a shaped prop has up to ${MAX_SHAPE_LEDS}`);
  let shape;
  if (w <= MAX_SHAPE_SIDE && h <= MAX_SHAPE_SIDE && w * h <= MAX_SHAPE_CELLS) {
    const cells = new Array(w * h).fill(-1);
    for (const [v, x, y] of nodes) if (cells[y * w + x] < 0) cells[y * w + x] = v - 1;
    shape = { w, h, cells };
  } else {
    // Too big a grid to keep: shrink it, keeping each pixel's place as near as it can.
    const pos = Array.from({ length: leds }, () => null);
    for (const [v, x, y] of nodes) pos[v - 1] ||= [x, y];
    const order = pos.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    const r = rasterise(order.map((i) => pos[i]));
    shape = { w: r.w, h: r.h, cells: r.cells.map((k) => (k < 0 ? -1 : order[k])) };
  }
  const bits = [];
  for (const m of doc.matchAll(/<\s*subModel\b([^>]*)\/?>/gi)) {
    if ((attr(m[1], "type") || "ranges") !== "ranges") continue;
    const set = new Set();
    for (const [, value] of m[1].matchAll(/\bline\d+\s*=\s*"([^"]*)"/gi)) {
      for (const range of value.split(",")) {
        const [a, b] = range.trim().split("-").map((s) => parseInt(s, 10));
        if (!(a > 0)) continue;
        for (let k = a; k <= (b >= a ? b : a) && k <= leds; k++) set.add(k - 1);
      }
    }
    if (set.size && bits.length < MAX_BITS) {
      bits.push({ id: `b${bits.length + 1}`, name: (attr(m[1], "name") || `Bit ${bits.length + 1}`).slice(0, 64),
        leds: [...set].sort((a, b) => a - b) });
    }
  }
  return { name, shape: { ...shape, source: "xmodel", params: {} }, bits, leds };
}
export const MAX_BITS = 64;

const unescapeXml = (s) => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e]);

// A short key for a shape, for caches that need to know when it changed.
const keys = new WeakMap();
export function shapeKey(shape) {
  if (!shape) return "";
  let k = keys.get(shape);
  if (k === undefined) keys.set(shape, (k = JSON.stringify([shape.w, shape.h, shape.cells])));
  return k;
}

// A frame of a shaped prop (wiring order) laid out on its grid, the empty cells dark, for drawing.
export function shapeToGrid(rgb, shape, out = new Uint8Array(shape.w * shape.h * 3)) {
  out.fill(0);
  shape.cells.forEach((led, c) => {
    if (led >= 0) { out[c * 3] = rgb[led * 3]; out[c * 3 + 1] = rgb[led * 3 + 1]; out[c * 3 + 2] = rgb[led * 3 + 2]; }
  });
  return out;
}
