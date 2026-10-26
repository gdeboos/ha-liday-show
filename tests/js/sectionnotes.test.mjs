import assert from "node:assert/strict";
import test from "node:test";
import { features, measureSections } from "../../haliday_show/app/halidayshow/static/js/analysis.js";
import { autoNamed, describeSections, notesFree, ruleNote } from "../../haliday_show/app/halidayshow/static/js/sectionnotes.js";

// 30 s at 8 kHz: a quiet held tone, then a part with a click every half second that gets louder,
// with one big crash at 25 s, then the crash stops dead at 28 s.
function song() {
  const rate = 8000, n = 30 * rate, s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    if (t < 15) s[i] = 0.02 * Math.sin(2 * Math.PI * 330 * t);
    else if (t < 28) {
      const gain = 0.1 + 0.5 * ((t - 15) / 13);
      const click = (t % 0.5) < 0.02 ? Math.sin(2 * Math.PI * 80 * t) : 0;
      const crash = t >= 25 && t < 26 ? (Math.random() * 2 - 1) * 0.9 : 0;
      s[i] = gain * (0.3 * Math.sin(2 * Math.PI * 110 * t) + click) + crash;
    }
  }
  return { s, rate };
}

test("measures each section: loudness, build-up, busyness, hits and drops", () => {
  const { s, rate } = song();
  const [quiet, loud] = measureSections(features(s, rate), [{ start: 0, end: 15 }, { start: 15, end: 30 }]);
  assert.equal(quiet.level, 0);
  assert.equal(loud.level, 1);
  assert.equal(quiet.busy, "sparse");
  assert.equal(loud.busy, "busy");
  assert.equal(loud.shape, "builds");
  assert.ok(loud.hits.some((t) => Math.abs(t - 25) < 0.5), `hits ${loud.hits}`);
  // The crash ending is itself a drop; the stop at 28 s is too close after it to count again.
  assert.ok(loud.drops.length === 1 && loud.drops[0] >= 25.5 && loud.drops[0] <= 28.6, `drops ${loud.drops}`);
  assert.deepEqual(quiet.hits, []);
});

const trait = { level: 0.9, shape: "builds", busy: "busy", tone: "bass", hits: [42.3], drops: [] };

test("a rule note says what a section sounds like and how to light it", () => {
  const secs = [{ start: 0, end: 30, label: "Chorus" }, { start: 30, end: 60, label: "Verse" }, { start: 60, end: 90, label: "Chorus" }];
  const note = ruleNote(trait, secs[2], secs);
  assert.match(note, /^Loud, busy, lots of hits, bass-heavy; builds up through it; big hit at 0:42; like the Chorus at 0:00\. /);
  assert.match(note, /Everything on/);
  assert.match(note, /flash everything on the hit/);
  assert.match(ruleNote({ level: 0.1, shape: "fades", busy: "sparse", tone: "bright", hits: [], drops: [] }, secs[1], secs),
    /^Quiet, sparse, bright and tinkly; fades away\. Keep it gentle/);
  assert.ok(ruleNote(trait, secs[0], secs).length <= 300);
});

test("describing keeps notes and names you wrote, and rewrites its own", () => {
  const secs = [
    { start: 0, end: 10, label: "Intro" },
    { start: 10, end: 20, label: "Part B", notes: "bells only, very gentle" },
    { start: 20, end: 30, label: "Part C", notes: "old note", autoNotes: true },
    { start: 30, end: 40, label: "Big finish", named: true },
    { start: 40, end: 50, label: "Big finish" },
  ];
  assert.equal(autoNamed(secs[0]), true);
  assert.equal(autoNamed(secs[3]), false);
  assert.equal(autoNamed(secs[4]), false); // not a name Detect gives
  assert.equal(notesFree(secs[1]), false);
  const out = describeSections(secs, secs.map(() => trait), { write: () => "new note", names: { 0: "Opening", 1: "Verse", 3: "Drop", 4: "Drop" } });
  assert.deepEqual(out.map((s) => s.label), ["Opening", "Verse", "Part C", "Big finish", "Big finish"]);
  assert.deepEqual(out.map((s) => s.notes), ["new note", "bells only, very gentle", "new note", "new note", "new note"]);
  assert.equal(out[1].autoNotes, undefined);
  assert.equal(out[0].autoNotes, true);
  const mine = { start: 0, end: 10, label: "Opening", named: true, notes: "my note" };
  assert.equal(describeSections([mine], [trait], { names: { 0: "Intro" } })[0], mine); // left exactly as it was
});

test("sections past the song's end, tiny ones and a lone section don't upset the measurements", async () => {
  const { s, rate } = song();
  const f = features(s, rate);
  const out = measureSections(f, [{ start: 0, end: 15 }, { start: 15, end: 29.99 }, { start: 29.99, end: 30 }, { start: 40, end: 50 }]);
  assert.ok(out[0].level < out[1].level); // the quiet part is still quieter than the loud one
  assert.equal(out[2].shape, "steady"); // one frame long: nothing to build or fade
  for (const t of out) for (const v of [t.level]) assert.ok(Number.isFinite(v));
  assert.equal(out[3].alone, true);
  const [only] = measureSections(f, [{ start: 0, end: 30 }]);
  assert.equal(only.alone, true);
  assert.doesNotMatch(ruleNote(only, { start: 0, end: 30, label: "Song" }, []), /Medium|Quiet|Loud/);
});

test("Detect again keeps the names and notes you wrote", async () => {
  const { keepYours } = await import("../../haliday_show/app/halidayshow/static/js/sectionnotes.js");
  const old = [
    { start: 0, end: 10, label: "Opening bells", named: true, notes: "bells only" },
    { start: 10, end: 20, label: "Part B", notes: "auto words", autoNotes: true },
    { start: 20, end: 31, label: "Verse", notes: "everything flashes at the end" },
  ];
  const fresh = [{ start: 0, end: 9.5, label: "Intro" }, { start: 9.5, end: 21, label: "Part A" }, { start: 21, end: 30, label: "Part B" }];
  const out = keepYours(fresh, old);
  assert.deepEqual(out.map((x) => x.label), ["Opening bells", "Part A", "Part B"]);
  assert.equal(out[0].named, true);
  assert.deepEqual(out.map((x) => x.notes), ["bells only", undefined, "everything flashes at the end"]);
  assert.equal(fresh[0].label, "Intro"); // the fresh sections themselves aren't changed
  const described = describeSections(out, out.map(() => trait), { write: () => "new" });
  assert.deepEqual(described.map((x) => x.notes), ["bells only", "new", "everything flashes at the end"]);
});
