import assert from "node:assert/strict";
import test from "node:test";

import {
  barRange, cutsRequest, joinScore, parseTime, phraseScore, rankCuts, sectionCuts, similarity, songPlans,
} from "../../haliday_show/app/halidayshow/static/js/cutfinder.js";

// Unit vectors that are near-orthogonal to each other, one per name.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const pool = {};
const vec = (name) => {
  if (!pool[name]) {
    const v = Array.from({ length: 64 }, rnd);
    const s = Math.hypot(...v);
    pool[name] = v.map((x) => x / s);
  }
  return pool[name];
};
// A song from bar names, 2 s a bar.
const song = (names) => {
  const vecs = names.map(vec);
  return { bars: names.map((_, k) => k * 2), total: names.length * 2, sim: similarity(vecs) };
};
const phrase = (p) => Array.from({ length: 8 }, (_, k) => `${p}${k}`);

test("times are read as m:ss or seconds", () => {
  assert.equal(parseTime("1:30"), 90);
  assert.equal(parseTime("90"), 90);
  assert.equal(parseTime("45 s"), 45);
  assert.equal(parseTime("2m"), 120);
  assert.equal(parseTime("0:07.5"), 7.5);
  assert.equal(parseTime("soon"), null);
  assert.equal(parseTime(""), null);
});

test("a join is smooth when what follows or leads into it matches the original", () => {
  const { sim } = song(["a", "b", "a", "b", "c"]);
  assert.ok(joinScore(sim, 0, 2, 5) > 0.99); // a b | a b: bar 2 is like bar 0
  assert.ok(joinScore(sim, 1, 4, 5) < 0.3); // a | c, where b used to follow
  assert.ok(joinScore(sim, 2, 5, 5) < 0.3, "to the end, judged by the bar before");
  assert.equal(phraseScore(8), 1);
  assert.ok(phraseScore(3) < phraseScore(2));
});

test("bar ranges cover the bars inside a stretch", () => {
  assert.deepEqual(barRange([0, 2, 4, 6, 8], 2, 6), [1, 3]);
  assert.deepEqual(barRange([0, 2, 4, 6, 8], 4, 10), [2, 5]);
});

test("a long intro made of a repeating loop is shortened by whole loops", () => {
  const names = [...Array(12).fill(0).map((_, k) => (k % 2 ? "y" : "x")), ...phrase("v")];
  const s = song(names);
  const got = sectionCuts({ ...s, from: 0, to: 24, remove: 8 });
  assert.ok(got.length >= 2);
  const [best] = got;
  assert.equal(best.cuts.length, 1);
  assert.ok(best.join > 0.99, `join ${best.join}`);
  assert.equal(best.cuts[0].bars % 2, 0);
  assert.ok(Math.abs(best.removed - 8) <= 2, `removed ${best.removed}`);
  for (const o of got) {
    assert.ok(o.cuts[0].start >= 0 && o.cuts[0].end <= 24, "stays inside the intro");
  }
});

test("a section is never cut away completely", () => {
  const s = song([...phrase("a"), ...phrase("b")]);
  for (const o of sectionCuts({ ...s, from: 0, to: 16, remove: 16 })) assert.ok(o.removed < 16);
});

test("for the whole song, a repeated verse and chorus pair is cut whole", () => {
  const s = song([...phrase("i"), ...phrase("v"), ...phrase("c"), ...phrase("v"), ...phrase("c"), ...phrase("o")]);
  const plans = songPlans({ ...s, sections: [0, 16, 32, 48, 64, 80].map((start) => ({ start })), remove: 32 });
  assert.ok(plans.length >= 1);
  const [best] = plans;
  assert.equal(best.cuts.length, 1);
  assert.equal(best.cuts[0].bars, 16);
  assert.ok(best.join > 0.99);
  assert.equal(best.removed, 32);
});

test("plans add up several cuts, in song order and apart from each other", () => {
  const loop = (n) => Array.from({ length: n }, (_, k) => (k % 2 ? "y" : "x"));
  const s = song([...loop(12), ...phrase("v"), ...loop(12), ...phrase("w")]);
  const plans = songPlans({ ...s, remove: 24 });
  assert.ok(plans.length >= 1);
  for (const p of plans) {
    assert.ok(Math.abs(p.removed - 24) <= 3, `removed ${p.removed}`);
    for (let k = 1; k < p.cuts.length; k++) assert.ok(p.cuts[k].start >= p.cuts[k - 1].end + 4);
    assert.ok(p.cuts.every((c) => c.end < s.total), "never cuts to the end");
  }
});

test("nothing to suggest without bars or anything to remove", () => {
  const s = song(phrase("a"));
  assert.deepEqual(sectionCuts({ ...s, from: 0, to: 16, remove: 0 }), []);
  assert.deepEqual(songPlans({ bars: [], total: 10, sim: [], remove: 5 }), []);
});

test("bars of audio that repeat come out alike, and different music doesn't", async () => {
  const { barVectors } = await import("../../haliday_show/app/halidayshow/static/js/analysis.js");
  const rate = 11025, bar = 2;
  // Four bars of a C-E-G-ish riff, the same four again, then four bars of a louder bass line.
  const riff = [262, 330, 392, 330], other = [98, 110, 98, 123];
  const samples = new Float32Array(rate * bar * 12);
  for (let b = 0; b < 12; b++) {
    const notes = b < 8 ? riff : other;
    for (let k = 0; k < rate * bar; k++) {
      const t = k / rate, f = notes[Math.floor((t / bar) * 4)];
      const env = Math.exp(-((t * 2) % 1) * 4);
      samples[b * rate * bar + k] = env * Math.sin(2 * Math.PI * f * t * (1 + (b % 4) * 0.25)) * (b < 8 ? 0.5 : 0.9);
    }
  }
  const vecs = barVectors(samples, rate, Array.from({ length: 12 }, (_, k) => k * bar));
  const sim = similarity(vecs);
  for (let k = 0; k < 4; k++) {
    assert.ok(sim[k][k + 4] > 0.9, `bar ${k} vs ${k + 4}: ${sim[k][k + 4]}`);
    assert.ok(sim[k][k + 4] > sim[k][k + 8] + 0.3, `bar ${k} vs ${k + 8}: ${sim[k][k + 8]}`);
  }
});

test("the AI is told about the options, sections, marks and what's being shortened", () => {
  const options = [
    { cuts: [{ start: 10, end: 26, bars: 8, join: 0.9 }], removed: 16, join: 0.9 },
    { cuts: [{ start: 40, end: 48.04, bars: 4, join: 0.5 }], removed: 8.04, join: 0.5 },
  ];
  const { request, context } = cutsRequest(options, {
    song: { name: "Jingle Bells", tempo: 120 }, total: 104.2,
    scope: { label: "Chorus", now: 30, target: 15 },
    sections: [{ start: 0, end: 30, label: "Chorus", notes: "Keep the bells", autoNotes: false },
      { start: 30, end: 60, label: "Verse", notes: "Quiet.", autoNotes: true }],
    marks: [{ t: 12.345, label: "Big hit" }, { t: 50, label: "" }],
  });
  assert.match(request, /works best/);
  assert.deepEqual(context.shorten, { what: 'the section "Chorus"', now: 30, want: 15 });
  assert.equal(context.sections[0].notes_by_person, true);
  assert.equal(context.sections[1].notes_by_person, undefined);
  assert.deepEqual(context.marks, [{ at: 12.3, name: "Big hit" }, { at: 50, name: "(unnamed)" }]);
  assert.deepEqual(context.options[1], { index: 1, cuts: [{ from: 40, to: 48, bars: 4, join: "join may be heard" }],
    shorter_by: 8, length_after: 22 });
});

test("the AI's ranking reorders the options, and a bad reply leaves them as they were", () => {
  const options = [{ removed: 1 }, { removed: 2 }, { removed: 3 }];
  const got = rankCuts(options, { choices: [{ index: 2, reason: " Drops the repeat " }, { index: 0, reason: "" },
    { index: 2, reason: "again" }, { index: 9, reason: "no such" }] });
  assert.ok(got.used);
  assert.deepEqual(got.options.map((o) => [o.removed, o.reason, o.aiRank]),
    [[3, "Drops the repeat", 1], [1, undefined, 2], [2, undefined, undefined]]);
  assert.deepEqual(rankCuts(options, { choices: "nope" }), { options, used: false });
  assert.deepEqual(rankCuts(options, null).options, options);
});
