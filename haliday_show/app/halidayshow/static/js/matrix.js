// Matrices: a light laid out as a grid of width x height LEDs (a panel, or a mega-tree's strings).
// Everything in the editor works in grid order, in rows from the top left; only the baked frames are
// put into the light's wiring order (toWire), so previews never need to know how it's wired.

export const MAX_MATRIX = 4096;

// How a strip effect plays on a matrix (a clip's `runs`): the same along every row, the same down
// every column, or once round the whole grid.
export const RUNS = ["rows", "columns", "strip"];
export const runsOf = (clip) => (RUNS.includes(clip?.runs) ? clip.runs : "rows");

// A light's grid, or null for a strip. One whose LED count no longer fills its grid plays as a strip.
export function gridOf(light) {
  const m = light?.matrix;
  if (!m || !(m.w >= 1) || !(m.h >= 1) || m.w * m.h !== light.segments) return null;
  return { w: m.w, h: m.h };
}

// Grid spot i's place across (u) and down (v), 0 to 1; a single row or column sits in the middle.
export function gridUV(i, w, h) {
  const x = i % w, y = Math.floor(i / w);
  return [w > 1 ? x / (w - 1) : 0.5, h > 1 ? y / (h - 1) : 0.5];
}

// For each LED along the wire, the grid spot it lights (rows from the top left).
export function wireOrder({ w, h, start = "top left", order = "rows", zigzag = false }) {
  const out = new Int32Array(w * h);
  const rows = order !== "columns", len = rows ? w : h;
  for (let k = 0; k < w * h; k++) {
    const line = Math.floor(k / len);
    let pos = k % len;
    if (zigzag && line % 2) pos = len - 1 - pos;
    let x = rows ? pos : line, y = rows ? line : pos;
    if (start.endsWith("right")) x = w - 1 - x;
    if (start.startsWith("bottom")) y = h - 1 - y;
    out[k] = y * w + x;
  }
  return out;
}

const plain = (m) => (m.start || "top left") === "top left" && (m.order || "rows") === "rows" && !m.zigzag;

// A frame in grid order put into wiring order. Plain rows from the top left come back as they are.
export function toWire(rgb, matrix) {
  if (plain(matrix)) return rgb;
  const order = wireOrder(matrix), out = new Uint8Array(rgb.length);
  for (let k = 0; k < order.length; k++) {
    const g = order[k] * 3;
    out[k * 3] = rgb[g]; out[k * 3 + 1] = rgb[g + 1]; out[k * 3 + 2] = rgb[g + 2];
  }
  return out;
}

// The other way: a frame as it goes down the wire, back in grid order (for showing what a light shows).
export function fromWire(rgb, matrix) {
  if (plain(matrix)) return rgb;
  const order = wireOrder(matrix), out = new Uint8Array(rgb.length);
  for (let k = 0; k < order.length; k++) {
    const g = order[k] * 3;
    out[g] = rgb[k * 3]; out[g + 1] = rgb[k * 3 + 1]; out[g + 2] = rgb[k * 3 + 2];
  }
  return out;
}

export const stripLength = (runs, w, h) => (runs === "columns" ? h : runs === "strip" ? w * h : w);

// Lays a strip effect's colours (stripLength of them, 3 values each) over the grid in `out`.
export function expandRuns(strip, runs, w, h, out) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // As one strip it zig-zags, so a chase going off one row comes on at the same end of the next.
      const s = runs === "columns" ? y : runs === "strip" ? y * w + (y % 2 ? w - 1 - x : x) : x;
      const o = (y * w + x) * 3;
      out[o] = strip[s * 3]; out[o + 1] = strip[s * 3 + 1]; out[o + 2] = strip[s * 3 + 2];
    }
  }
  return out;
}

// Test wiring: the top left white, the rest of the top row red and of the left column green, in grid
// order. Sent through toWire, a mistake in the wiring settings shows straight away.
export function matrixTestFrame({ w, h }) {
  const out = new Uint8Array(w * h * 3);
  for (let x = 1; x < w; x++) out[x * 3] = 255;
  for (let y = 1; y < h; y++) out[y * w * 3 + 1] = 255;
  out.set([255, 255, 255], 0);
  return out;
}

// Where a matrix clip's snapshots go along the timeline between x0 and x1: each as tall as the lane
// and the grid's shape (at least 8 px wide), a small gap between, the last trimmed to the clip's end.
export function gridTiles(x0, x1, height, grid, gap = 2) {
  const w = Math.max(8, (height * grid.w) / grid.h), out = [];
  // frac: how much of the grid fits (the last is trimmed at the clip's end). A sliver under 4 px
  // would show less than a column, so it's left out.
  for (let x = x0; x < x1 - (out.length ? 4 : 0.5); x += w + gap) {
    const tw = Math.min(w, x1 - x);
    out.push({ x, w: tw, frac: tw / w });
  }
  return out;
}

// House effects that also suit a matrix's own lane, drawn across its grid.
export const ON_A_MATRIX = ["plasma", "spiral"];

// Whether an effect can go on a lane: house effects on the House lane, the rest on lights, with
// ON_A_MATRIX on a matrix too, and effects made for matrices (fx.grid) on matrices. Group lanes
// take anything but the Phones lane's own. lane: "house", "group", "matrix", "light" or "phones".
export function laneTakes(key, fx, lane) {
  if (!fx) return false;
  // The Phones lane takes light effects and its own (House colour); nothing else takes those.
  if (fx.phones) return lane === "phones";
  // A phone's screen is a matrix: light effects, matrix effects, and Plasma and Spiral.
  if (lane === "phones") return !fx.wholeLoop && (!fx.house || ON_A_MATRIX.includes(key));
  if (lane === "group") return true;
  if (lane === "house") return !!fx.house;
  if (fx.house) return lane === "matrix" && ON_A_MATRIX.includes(key);
  return true;
}

// A strip effect on a mega-tree runs down its strings (its columns) unless set otherwise.
export const runsDownTree = (fx) => !!fx && !fx.house && !fx.grid;

// A clip pasted or copied onto a lane: null if the lane can't take its effect. From a strip onto a
// mega-tree, a strip effect runs down the strings, as one added there does; from a matrix it keeps its Runs.
export function clipForLane(clip, fx, { lane, tree = false, fromMatrix = false }) {
  if (!laneTakes(clip.effect, fx, lane)) return null;
  return tree && !fromMatrix && runsDownTree(fx) && !clip.runs ? { ...clip, runs: "columns" } : clip;
}
