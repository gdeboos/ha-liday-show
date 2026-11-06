import assert from "node:assert/strict";
import test from "node:test";

import { CLASSES, SOUNDS, SOUND_LOOKS, feelFor, soundsFrom, soundsIn } from "../../haliday_show/app/halidayshow/static/js/sounds.js";
import { generateShow } from "../../haliday_show/app/halidayshow/static/js/autogen.js";

// YAMNet's rows (one every 0.1 s) with `loud` sounds at their score over [from, to) seconds.
function rows(seconds, loud) {
  const n = Math.round((seconds - 0.96) / 0.1) + 1;
  return Array.from({ length: n }, (_, f) => {
    const t = f * 0.1 + 0.48;
    return CLASSES.map((c) => {
      for (const [key, score, from, to] of loud) if (SOUNDS[key].classes.includes(c) && t >= from && t < to) return score;
      return 0.01;
    });
  });
}

test("keeps each sound's score every half second, only for sounds that are there", () => {
  const kept = soundsFrom(rows(30, [["sleighbells", 0.4, 10, 20], ["happy", 0.3, 0, 30]]), 30);
  assert.equal(kept.step, 0.5);
  assert.deepEqual(Object.keys(kept.sounds).sort(), ["happy", "sleighbells"]);
  assert.equal(kept.sounds.sleighbells.length, 60);
  assert.ok(kept.sounds.sleighbells[30] >= 35 && kept.sounds.sleighbells[4] === 1);
  assert.ok(JSON.stringify(kept).length < 1000);
});

test("finds what's heard in a stretch, sounds before moods", () => {
  const kept = soundsFrom(rows(60, [["choir", 0.3, 0, 30], ["brass", 0.2, 30, 60], ["scary", 0.2, 0, 60]]), 60);
  assert.deepEqual(soundsIn(kept, 0, 25), ["choir", "scary"]);
  assert.deepEqual(soundsIn(kept, 35, 60), ["brass", "scary"]);
  assert.deepEqual(soundsIn(kept), ["choir", "brass", "scary"]);
  assert.deepEqual(soundsIn(null), []);
  assert.equal(feelFor(kept), "spooky");
  assert.equal(feelFor(soundsFrom(rows(20, [["piano", 0.5, 0, 20]]), 20)), null);
});

test("Generate picks looks that suit what's heard", () => {
  const duration = 64, beats = Array.from({ length: duration * 2 }, (_, i) => i / 2);
  const sections = [{ start: 0, end: 32, label: "Verse", energy: 0.6 }, { start: 32, end: 64, label: "Bridge", energy: 0.6 }];
  const sounds = soundsFrom(rows(64, [["sleighbells", 0.5, 0, 32], ["guitar", 0.5, 32, 64]]), 64);
  const lights = [{ id: "a", segments: 30 }, { id: "b", segments: 30 }];
  for (let seed = 1; seed <= 5; seed++) {
    const g = generateShow({ tempo: 120, beats, bars: beats.filter((_, i) => i % 4 === 0), sections, duration, sounds }, lights,
      ["#ff0000", "#ffffff"], { seed, style: "balanced", build: false });
    const at = (from, to) => new Set(Object.values(g.clips).flat().filter((c) => c.start >= from && c.end <= to).map((c) => c.effect));
    for (const e of at(0, 32)) assert.ok([...SOUND_LOOKS.sleighbells, "fade"].includes(e), `bells: ${e}`);
    for (const e of at(32, 64)) assert.ok([...SOUND_LOOKS.guitar, "fade"].includes(e), `guitar: ${e}`);
  }
});

test("every sound suits at least two looks at each loudness", async () => {
  const { LOOKS } = await import("../../haliday_show/app/halidayshow/static/js/autogen.js");
  for (const [key, suits] of Object.entries(SOUND_LOOKS)) {
    for (const t of ["low", "mid", "high"]) assert.ok(LOOKS[t].filter((l) => suits.includes(l.effect)).length >= 2, `${key} ${t}`);
  }
});
