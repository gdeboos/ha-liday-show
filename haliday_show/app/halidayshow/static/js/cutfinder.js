// Cut suggestions for the Music editor: where to cut whole bars out of a section (or the whole song)
// so it gets shorter without the join being heard.
//
// A cut from bar i to bar j joins the end of bar i-1 straight onto bar j. That sounds natural when
// bar j is like bar i (what follows the join is what used to follow there) or bar j-1 is like bar
// i-1 (what leads into the join is what used to lead into bar j). Music repeats in phrases of 4 and
// 8 bars, so cuts of whole phrases that start on a phrase are preferred, and for the whole song,
// cuts of bars that are heard again elsewhere, so nothing unique is lost.
//
// Pure functions of bar times and bar vectors (analysis.js barVectors), so they're tested in Node.

const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const MAX_BARS = 32;

// How alike every pair of bars is, -1 to 1.
export function similarity(vecs) {
  return vecs.map((a) => vecs.map((b) => dot(a, b)));
}

// How well a cut of bars [i, j) joins, 0 to 1. n is the number of bars; j === n cuts to the end.
export function joinScore(sim, i, j, n) {
  const after = i < n && j < n ? sim[i][j] : null; // bar j in place of bar i
  const before = i > 0 ? sim[i - 1][j - 1] : null; // bar i-1 in place of bar j-1
  if (after === null && before === null) return 0;
  if (after === null) return clamp01(before);
  if (before === null) return clamp01(after);
  return clamp01(0.6 * Math.max(after, before) + 0.4 * Math.min(after, before));
}

// Whole phrases (8 or 4 bars) are best, then pairs of bars.
export function phraseScore(count) {
  return count % 8 === 0 ? 1 : count % 4 === 0 ? 0.9 : count % 2 === 0 ? 0.6 : 0.3;
}

export function joinLabel(q) {
  return q >= 0.8 ? "smooth join" : q >= 0.6 ? "good join" : "join may be heard";
}

// The bar index range [first, end) inside from..to seconds (end === bars.length means to the end).
export function barRange(bars, from, to) {
  const near = 0.08;
  let first = bars.findIndex((t) => t >= from - near);
  if (first < 0) first = bars.length;
  let end = first;
  while (end < bars.length && bars[end] < to - near) end++;
  return [first, end];
}

const timeOf = (bars, total, k) => (k < bars.length ? bars[k] : total);

// "1:30", "90", "90 s" or "1m30" as seconds; null if it isn't a time.
export function parseTime(text) {
  const s = String(text ?? "").trim().toLowerCase().replace(/\s*s(ec(ond)?s?)?$/, "");
  let m = s.match(/^(\d+)\s*[:m]\s*(\d{1,2}(?:\.\d+)?)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
  m = s.match(/^\d+(?:\.\d+)?$/);
  return m ? Number(s) : null;
}

// Up to `count` single cuts inside one section (from..to seconds) that take out about `remove`
// seconds. bars: bar start times; total: the song's length. Each option is
// {cuts: [{start, end, bars, join}], removed, join}, best first.
export function sectionCuts({ bars, total, sim, from, to, remove, count = 3 }) {
  const n = bars.length;
  const [first, end] = barRange(bars, from, to);
  const inside = end - first;
  if (inside < 2 || !(remove > 0)) return [];
  const barLen = (timeOf(bars, total, end) - bars[first]) / inside;
  const tol = Math.max(remove * 0.3, barLen * 1.5);
  const found = [];
  for (let i = first; i < end; i++) {
    // Leave at least one bar of the section.
    for (let j = i + 1; j <= end && j - i <= MAX_BARS; j++) {
      if (j - i >= inside) break;
      const start = bars[i], stop = timeOf(bars, total, j), removed = stop - start;
      if (removed > remove + tol * 2) break;
      const join = joinScore(sim, i, j, n);
      const fit = Math.exp(-(((removed - remove) / tol) ** 2));
      const onPhrase = (i - first) % 4 === 0 || j === end ? 1 : (i - first) % 2 === 0 ? 0.7 : 0.4;
      const score = 0.45 * join + 0.15 * phraseScore(j - i) + 0.1 * onPhrase + 0.3 * fit;
      found.push({ i, j, score, cut: { start, end: stop, bars: j - i, join } });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of found) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.i - c.i) < 2 && Math.abs(p.j - c.j) < 2)) continue;
    picked.push(c);
  }
  return picked.map(({ cut }) => ({ cuts: [cut], removed: cut.end - cut.start, join: cut.join }));
}

// Up to `count` plans of one or more cuts across the whole song that together take out about
// `remove` seconds, favouring smooth joins and bars that are heard again elsewhere. sections (with
// start times) are used to keep cuts on phrases. Same shape as sectionCuts, cuts in song order.
export function songPlans({ bars, total, sim, sections = [], remove, count = 3 }) {
  const n = bars.length;
  if (n < 4 || !(remove > 0)) return [];
  const barLen = (total - bars[0]) / n;
  const tol = Math.max(3, barLen);
  const starts = sections.map((s) => barRange(bars, s.start, s.start + 0.01)[0]);
  const phraseStart = (i) => {
    const s = Math.max(0, ...starts.filter((k) => k <= i));
    return (i - s) % 4 === 0 ? 1 : (i - s) % 2 === 0 ? 0.6 : 0.3;
  };
  const cands = [];
  for (let i = 0; i < n; i++) {
    // Not to the very end: that's an early ending, better done with Fade out.
    for (let j = i + 2; j < n && j - i <= MAX_BARS; j += 2) {
      const start = bars[i], stop = bars[j], removed = stop - start;
      if (removed > remove + tol) break;
      const join = joinScore(sim, i, j, n);
      if (join < 0.5) continue;
      // How much of what's cut is heard again elsewhere.
      let rep = 0;
      for (let k = i; k < j; k++) {
        let best = -1;
        for (let m = 0; m < n; m++) if ((m < i || m >= j) && sim[k][m] > best) best = sim[k][m];
        rep += clamp01(best);
      }
      rep /= j - i;
      const score = 0.5 * join + 0.15 * phraseScore(j - i) + 0.25 * rep + 0.1 * phraseStart(i);
      cands.push({ i, j, score, cut: { start, end: stop, bars: j - i, join } });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const plans = [], banned = new Set();
  for (let attempt = 0; attempt < count * 3 && plans.length < count; attempt++) {
    const chosen = [];
    let sum = 0;
    for (const c of cands) {
      if (sum >= remove - tol) break;
      if (banned.has(`${c.i}:${c.j}`)) continue;
      const removed = c.cut.end - c.cut.start;
      if (sum + removed > remove + tol) continue;
      // Two bars apart at least, so each join stays the one that was scored.
      if (chosen.some((p) => c.i < p.j + 2 && p.i < c.j + 2)) continue;
      chosen.push(c);
      sum += removed;
    }
    if (!chosen.length) break;
    banned.add(`${chosen[0].i}:${chosen[0].j}`);
    const key = chosen.map((c) => `${c.i}:${c.j}`).sort().join(",");
    if (plans.some((p) => p.key === key)) continue;
    chosen.sort((a, b) => a.i - b.i);
    plans.push({
      key,
      cuts: chosen.map((c) => c.cut),
      removed: sum,
      join: Math.min(...chosen.map((c) => c.cut.join)),
      score: chosen.reduce((s, c) => s + c.score, 0) / chosen.length - Math.abs(sum - remove) / (remove * 4),
    });
  }
  plans.sort((a, b) => b.score - a.score);
  return plans.map(({ cuts, removed, join }) => ({ cuts, removed, join }));
}
