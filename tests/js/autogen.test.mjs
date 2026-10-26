import assert from "node:assert/strict";
import test from "node:test";

import { generateShow, barGrid, suggestLooks, tier } from "../../haliday_show/app/halidayshow/static/js/autogen.js";
import { EFFECTS, HOUSE } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import { applyGenerated } from "../../haliday_show/app/halidayshow/static/js/autogen.js";

// A 120 BPM song: quiet intro, verse, loud chorus, verse, chorus, quiet outro, 8 bars each.
const bar = 2;
const parts = [["Intro", 0.1], ["Verse", 0.5], ["Chorus", 1], ["Verse", 0.5], ["Chorus", 0.95], ["Outro", 0.05]];
const sections = parts.map(([label, energy], i) => ({ start: i * 8 * bar, end: (i + 1) * 8 * bar, label, energy }));
const duration = parts.length * 8 * bar;
const beats = Array.from({ length: duration * 2 }, (_, i) => i / 2);
const analysis = { tempo: 120, beats, bars: beats.filter((_, i) => i % 4 === 0), sections, duration };
const lights = [{ id: "a", segments: 15 }, { id: "b", segments: 10 }, { id: "c", segments: 20 }];
const colors = ["#ff0000", "#00b000", "#ffffff"];

test("fills every light from start to end with no gaps or overlaps", () => {
  const { clips } = generateShow(analysis, lights, colors);
  for (const l of lights) {
    const list = clips[l.id];
    assert.equal(list[0].start, 0);
    assert.equal(list[list.length - 1].end, duration);
    list.slice(1).forEach((c, i) => assert.ok(Math.abs(c.start - list[i].end) < 1e-6, `${l.id} gap at ${c.start}`));
    for (const c of list) {
      assert.ok(EFFECTS[c.effect] && !EFFECTS[c.effect].house, c.effect);
      assert.ok(c.end > c.start);
    }
  }
});

test("clips change on bar lines", () => {
  const { clips } = generateShow(analysis, lights, colors);
  for (const c of clips.a) assert.equal(c.start % bar, 0, `clip starts at ${c.start}`);
});

test("repeated sections get the same looks, and loud ones move on every light together", () => {
  const { clips } = generateShow(analysis, lights, colors, { seed: 3 });
  const at = (id, t) => clips[id].find((c) => c.start <= t && t < c.end).effect;
  assert.equal(at("a", 2 * 16 + 1), at("a", 4 * 16 + 1)); // both choruses
  assert.equal(at("a", 16 + 1), at("a", 3 * 16 + 1)); // both verses
  assert.equal(at("a", 2 * 16 + 1), at("b", 2 * 16 + 1));
});

test("quiet ends fade in and out, and colours come from the palette", () => {
  const { clips } = generateShow(analysis, lights, colors);
  const first = clips.a[0], last = clips.a[clips.a.length - 1];
  assert.equal(first.effect, "fade");
  assert.equal(first.from, "#000000");
  assert.equal(last.effect, "fade");
  assert.equal(last.to, "#000000");
  for (const c of clips.a) if (c.color) assert.ok(colors.includes(c.color), c.color);
});

test("speeds follow the tempo", () => {
  const fast = generateShow({ ...analysis, tempo: 180 }, lights, colors, { seed: 5 });
  const slow = generateShow({ ...analysis, tempo: 90 }, lights, colors, { seed: 5 });
  const chorus = (r) => r.clips.a.find((c) => c.start >= 32 && c.start < 48);
  const speed = (c) => c.rate ?? c.speed;
  assert.equal(chorus(fast).effect, chorus(slow).effect);
  assert.ok(speed(chorus(fast)) > speed(chorus(slow)));
});

test("styles and seeds change the result", () => {
  assert.equal(tier(0.5, "calm"), "low");
  assert.equal(tier(0.5, "balanced"), "mid");
  assert.equal(tier(0.6, "lively"), "high");
  const looks = (seed) => generateShow(analysis, lights, colors, { seed }).clips.a.map((c) => c.effect).join();
  assert.ok(new Set([1, 2, 3, 4, 5].map(looks)).size > 1);
});

test("house sweeps mark lifts into louder sections", () => {
  const r = generateShow(analysis, lights, colors, { house: true });
  assert.ok(r.house.length >= 2);
  assert.ok(r.house.every((c) => c.effect === "sweep"));
  assert.ok(r.house.some((c) => c.start === 32));
  const show = { tracks: [{ device: HOUSE, clips: [] }, { device: "a", clips: [{ effect: "solid" }] }, { device: "z", clips: [1] }] };
  applyGenerated(show, r);
  assert.equal(show.tracks[0].clips, r.house);
  assert.equal(show.tracks[1].clips, r.clips.a);
  assert.deepEqual(show.tracks[2].clips, [1]);
});

test("works without any analysis", () => {
  const r = generateShow({ duration: 30 }, lights, colors);
  assert.equal(r.clips.a[0].start, 0);
  assert.equal(r.clips.a[r.clips.a.length - 1].end, 30);
  assert.deepEqual(barGrid({ duration: 5 }), [0, 2, 4, 5]);
});

test("suggests looks for the section a stretch falls in, at the song's tempo", async () => {
  const { suggestLooks } = await import("../../haliday_show/app/halidayshow/static/js/autogen.js");
  const chorus = suggestLooks(analysis, 33, 40);
  assert.equal(chorus.section.label, "Chorus");
  assert.equal(chorus.tier, "high");
  const flash = chorus.looks.find((l) => l.effect === "cycle");
  assert.equal(flash.params.rate, 2); // one change a beat at 120 BPM
  assert.ok(chorus.looks.every((l) => l.label && EFFECTS[l.effect]));
  assert.equal(suggestLooks(analysis, 1, 3).tier, "low");
  assert.equal(suggestLooks({ duration: 10 }, 1, 3).section, null);
});

test("picks a palette for the time of year", async () => {
  const { seasonalPalette } = await import("../../haliday_show/app/halidayshow/static/js/palettes.js");
  assert.equal(seasonalPalette(new Date(2026, 9, 21)).name, "Halloween");
  assert.equal(seasonalPalette(new Date(2026, 11, 1)).name, "Christmas");
  assert.equal(seasonalPalette(new Date(2026, 10, 5)).name, "Bonfire Night");
  assert.equal(seasonalPalette(new Date(2026, 5, 1)), null);
});

test("slow lights get looks that change the whole light, never faster than the beat", () => {
  const analysis = { duration: 60, tempo: 120, beats: [], bars: [],
    sections: [{ start: 0, end: 20, label: "Verse", energy: 0.2 }, { start: 20, end: 40, label: "Chorus", energy: 0.9 },
      { start: 40, end: 60, label: "Bridge", energy: 0.5 }] };
  const lights = [{ id: "fast", segments: 30 }, { id: "slow", segments: 300, slow: true }];
  for (let seed = 1; seed <= 20; seed++) {
    const { clips } = generateShow(analysis, lights, ["#ff0000", "#00ff00", "#0000ff"], { seed });
    for (const c of clips.slow) {
      assert.ok(["gradient", "pulse", "duo", "cycle", "fade"].includes(c.effect), c.effect);
      for (const k of ["rate", "speed"]) if (c[k] != null) assert.ok(c[k] <= 2, `${c.effect} ${k} ${c[k]}`);
    }
  }
  const { looks } = suggestLooks(analysis, 20, 30, 300, "balanced", true);
  assert.ok(looks.every((l) => !["chase", "twinkle", "comet", "trio"].includes(l.effect)));
});

test("a look a light can't show is swapped for another of the section's looks", () => {
  const blocks = (c) => !["duo", "trio", "gradient", "chase", "comet", "scanner", "twinkle"].includes(c.effect);
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const slow of [false, true]) {
      const { clips } = generateShow(analysis, [{ id: "a", segments: 15, slow, fits: blocks }], colors, { seed });
      assert.ok(clips.a.length);
      for (const c of clips.a) assert.ok(blocks(c), `${c.effect} (seed ${seed})`);
    }
  }
});

// Six lights, one of them split in two parts that must go on and off together.
const house6 = [
  { id: "roof", segments: 30 }, { id: "icicles", segments: 40 }, { id: "porch", segments: 10 },
  { id: "tree", segments: 50 }, { id: "door", segments: 8 },
  { id: "pl", segments: 60, group: "pillars" }, { id: "pr", segments: 60, group: "pillars" },
];
const litAt = (clips, t) => Object.keys(clips).filter((id) => clips[id].some((c) => c.start <= t && t < c.end));
const groupsAt = (clips, t) => new Set(litAt(clips, t).map((id) => house6.find((l) => l.id === id).group ?? id));

test("building up: few lights when quiet, more as it builds, all of them in the chorus", () => {
  const { clips } = generateShow(analysis, house6, colors, { build: true });
  const intro = groupsAt(clips, 4).size, verse = groupsAt(clips, 17).size, laterVerse = groupsAt(clips, 31).size;
  assert.ok(intro >= 1 && intro <= 2, `intro lights ${intro}`);
  assert.ok(verse < 6 && laterVerse >= verse, `verse builds ${verse} → ${laterVerse}`);
  assert.equal(groupsAt(clips, 33).size, 6); // chorus: every light
  assert.equal(groupsAt(clips, 65).size, 6); // second chorus
});

test("building up: a repeated section uses the same lights, and parts of a light stay together", () => {
  const { clips } = generateShow(analysis, house6, colors, { build: true, seed: 4 });
  assert.deepEqual(litAt(clips, 17).sort(), litAt(clips, 49).sort()); // both verses, first phrase
  for (const t of [4, 17, 31, 49, 90]) {
    const on = litAt(clips, t);
    assert.equal(on.includes("pl"), on.includes("pr"), `pillars split at ${t}`);
  }
});

test("without building up, every light plays all the way through", () => {
  const { clips } = generateShow(analysis, house6, colors, { build: false });
  for (const t of [4, 17, 33, 90]) assert.equal(litAt(clips, t).length, house6.length);
});

test("building up only fades in the lights that are on at the start", () => {
  const { clips } = generateShow(analysis, house6, colors, { build: true });
  for (const [id, list] of Object.entries(clips)) {
    if (list[0]?.effect === "fade" && list[0].from === "#000000") assert.equal(list[0].start, 0, id);
    if (list.length && list[0].start > 0) assert.notEqual(list[0].effect === "fade" && list[0].from === "#000000", true, id);
  }
});

test("building up with no sections fills every light", () => {
  const { clips } = generateShow({ ...analysis, sections: [] }, house6, colors, { build: true });
  for (const l of house6) assert.ok(clips[l.id].length, `${l.id} left dark`);
});

test("building up a calm song with no chorus still uses every light somewhere", () => {
  const calm = [["Intro", 0.2], ["Verse", 0.5], ["Bridge", 0.45], ["Outro", 0.2]]
    .map(([label, energy], i) => ({ start: i * 16, end: (i + 1) * 16, label, energy }));
  for (const style of ["calm", "balanced"]) {
    for (const seed of [1, 2, 3]) {
      const { clips } = generateShow({ ...analysis, sections: calm, duration: 64 }, house6, colors, { build: true, style, seed });
      for (const l of house6) assert.ok(clips[l.id].length, `${l.id} left dark (${style}, seed ${seed})`);
      assert.equal(groupsAt(clips, 17).size, 6); // the loudest part, the verse, uses them all
    }
  }
});

test("building up works with one or two lights", () => {
  for (const few of [[{ id: "a", segments: 10 }], [{ id: "a", segments: 10 }, { id: "b", segments: 10 }]]) {
    const { clips } = generateShow(analysis, few, colors, { build: true });
    for (const l of few) assert.ok(clips[l.id].length);
    assert.ok(Object.values(clips).some((list) => list.some((c) => c.start <= 4 && 4 < c.end))); // something in the intro
  }
});

test("the longest effect setting caps how long one look runs", () => {
  for (const [maxBars, style] of [[2, "balanced"], [4, "calm"], [8, "calm"]]) {
    const { clips } = generateShow(analysis, lights, colors, { maxBars, style });
    for (const list of Object.values(clips)) {
      for (const c of list) assert.ok(c.end - c.start <= maxBars * bar + 1e-6, `${c.effect} ${c.end - c.start}s over ${maxBars} bars (${style})`);
    }
  }
  // Without a cap, calm looks run a whole 8-bar section here.
  const { clips } = generateShow(analysis, lights, colors, { style: "calm" });
  assert.ok(Object.values(clips).flat().some((c) => c.end - c.start > 4 * bar));
});
