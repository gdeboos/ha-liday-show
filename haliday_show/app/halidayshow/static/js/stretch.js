// Moving and pasting a selected stretch of time: every effect inside it, across one or more lanes,
// lifted together and put down on other lanes and/or at another time, replacing what was there.
// Clips crossing the stretch's edges are cut there (as Delete effects here does).
import { clipPiece } from "./effects.js";

// The parts of `clips` inside start..end, cut at the edges.
export function piecesIn(clips, start, end) {
  const out = [];
  for (const c of clips) {
    if (c.end <= start || c.start >= end) continue;
    out.push(c.start >= start && c.end <= end ? c : clipPiece(c, Math.max(c.start, start), Math.min(c.end, end)));
  }
  return out;
}

// `clips` with start..end cleared: clips inside go, clips crossing the edges are trimmed.
export function clearIn(clips, start, end) {
  const kept = [];
  for (const c of clips) {
    if (c.end <= start || c.start >= end) { kept.push(c); continue; }
    if (c.start < start) kept.push(clipPiece(c, c.start, start));
    if (c.end > end) kept.push(clipPiece(c, end, c.end));
  }
  return kept;
}

// Which rows a stretch on rows `from` lands on, `by` rows further down `rows` (the lanes on show,
// top to bottom). Null if any would fall off the top or bottom.
export function rowsBy(rows, from, by) {
  const out = from.map((t) => rows[rows.indexOf(t) + by]);
  return from.every((t) => rows.includes(t)) && out.every((t) => t !== undefined) ? out : null;
}

// How far a stretch on rows `from` can move up (negative) and down within `rows`.
export function rowLimits(rows, from) {
  const idx = from.map((t) => rows.indexOf(t));
  return [-Math.min(...idx), rows.length - 1 - Math.max(...idx)];
}

// Puts a stretch down. `lanes(i)` gives lane i's clips. `moves` is one row per lane of the stretch:
// {from, to, pieces} (pieces at their old times). Everything shifts by `dt`. `onto(clip, from, to)`
// gives the clip as it goes on lane `to`, or null where that lane can't take it.
// With `lift`, the pieces leave their old lanes (a move); without, they're copies (a paste).
// Each target lane's stretch is cleared first, so what lands replaces what was there. A row none of
// whose effects can go on its target is left alone on both lanes; single effects that can't go stay
// where they were. Returns the new clip lists by lane, what was placed and how many were left behind.
export function placeStretch({ lanes, moves, start, end, dt, onto, lift = false }) {
  const out = new Map();
  const get = (i) => { if (!out.has(i)) out.set(i, [...lanes(i)]); return out.get(i); };
  const shift = (c) => ({ ...c, start: c.start + dt, end: c.end + dt });
  const rows = moves.map((m) => {
    const fits = [], left = [];
    for (const p of m.pieces) {
      const c = onto(shift(p), m.from, m.to);
      if (c) fits.push(c); else left.push(p);
    }
    return { ...m, fits, left, skip: m.pieces.length > 0 && !fits.length };
  });
  if (lift) {
    for (const r of rows) {
      if (r.skip) continue;
      out.set(r.from, [...clearIn(get(r.from), start, end), ...r.left]);
    }
  }
  const placed = [];
  for (const r of rows) {
    if (r.skip) continue;
    out.set(r.to, [...clearIn(get(r.to), start + dt, end + dt), ...r.fits]);
    for (const clip of r.fits) placed.push({ track: r.to, clip });
  }
  const left = rows.reduce((n, r) => n + r.left.length, 0);
  const skipped = rows.filter((r) => r.skip).length;
  return { lanes: out, placed, left, skipped };
}
