import assert from "node:assert/strict";
import test from "node:test";

import { lineUpOnBar, mashFit, rankFits } from "../../haliday_show/app/halidayshow/static/js/mashfit.js";

test("says how much a song's tempo and key change to fit another", () => {
  const draft = { tempo: 121, key: "A minor" };
  const same = mashFit({ tempo: 120, key: "A minor" }, draft);
  assert.equal(same.fit, "great");
  assert.equal(same.tempo, "1 BPM slower");
  assert.equal(same.key, "same key");
  // Relative keys share their notes: no move needed.
  const rel = mashFit({ tempo: 125, key: "C major" }, draft);
  assert.equal(rel.semis, 0);
  assert.equal(rel.key, "A minor, fits C major");
  assert.equal(rel.fit, "good");
  assert.equal(rel.tempo, "4 BPM faster");
  // Sugar Plum (E minor, 111.5) over Vibe Ace (A minor, 121): 8.5% faster, up 5 semitones.
  const plum = mashFit({ tempo: 111.5, key: "E minor" }, draft);
  assert.ok(Math.abs(plum.speed - 1.0852) < 1e-3);
  assert.equal(plum.semis, 5);
  assert.equal(plum.key, "moved up 5 semitones into A minor");
  assert.equal(plum.fit, "change");
  // Half time counts: 60 BPM under 121 plays at double.
  assert.equal(mashFit({ tempo: 60, key: "A minor" }, draft).tempo, "60 BPM, half time");
  assert.equal(mashFit({ tempo: 80, key: "F# major" }, draft).fit, "big");
  assert.equal(mashFit({}, draft).tempo, "tempo not known yet");
});

test("ranks songs by how well they fit", () => {
  const info = { a: { tempo: 80, key: "F# major" }, b: { tempo: 120, key: "A minor" }, c: { tempo: 125, key: "C major" } };
  assert.deepEqual(rankFits(["a", "b", "c"], { tempo: 121, key: "A minor" }, (s) => info[s]).map((r) => r.song), ["b", "c", "a"]);
});

test("a clip's first bar is lined up with the song's nearest bar", () => {
  // The clip's song has bars every 2 s from 0.5; it plays from 3 s, so its first bar is 1.5 s in.
  const clipBars = [0.5, 2.5, 4.5, 6.5], songBars = [0, 2, 4, 6, 8];
  assert.equal(lineUpOnBar(3.7, { start: 3, end: 7 }, 1, clipBars, songBars), 4.5); // its bar at 5.2 goes to 6
  // Played faster, it's in sooner: 1.5 s of its song is 1.2 s at 1.25 times, so its bar at 4.9 goes to 4.
  assert.ok(Math.abs(lineUpOnBar(3.7, { start: 3, end: 7 }, 1.25, clipBars, songBars) - 2.8) < 1e-9);
  assert.equal(lineUpOnBar(3.7, { start: 3, end: 7 }, 1, [], songBars), 3.7);
});
