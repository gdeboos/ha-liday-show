import assert from "node:assert/strict";
import test from "node:test";

import { weekLayout } from "../../haliday_show/app/halidayshow/static/js/weekview.js";

const week = {
  days: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"],
  slots: [
    { entry: "every", lane: "show", day: "2026-11-07", start: "2026-11-07T17:00", end: "2026-11-07T22:00",
      plays: ["2026-11-07T17:00", "2026-11-07T22:00"], covered: [] },
    { entry: "party", lane: "show", day: "2026-11-07", start: "2026-11-07T18:00", end: "2026-11-07T20:00",
      plays: null, covered: [["2026-11-07T18:00", "2026-11-07T20:00"]] },
    { entry: "eleven", lane: "show", day: "2026-11-06", start: "2026-11-06T21:00", end: "2026-11-06T23:00",
      plays: ["2026-11-06T22:00", "2026-11-06T23:00"], covered: [["2026-11-06T21:00", "2026-11-06T22:00"]] },
    { entry: "late", lane: "show", day: "2026-11-08", start: "2026-11-08T23:00", end: "2026-11-09T01:00",
      plays: ["2026-11-08T23:00", "2026-11-09T01:00"], covered: [] },
    { entry: "glow", lane: "scene", day: "2026-11-07", start: "2026-11-07T16:00", end: "2026-11-07T23:30",
      plays: ["2026-11-07T16:00", "2026-11-07T23:30"], covered: [], waits: [["2026-11-07T17:00", "2026-11-07T22:00"]] },
  ],
};
const name = (id) => id.toUpperCase();

test("the week runs from the earliest time to the latest, on whole hours, past midnight if need be", () => {
  const w = weekLayout(week, name, "2026-11-07");
  assert.deepEqual([w.from, w.to], [16, 25]);
  assert.deepEqual(w.ticks.map((t) => t.label), ["16:00", "18:00", "20:00", "22:00", "00:00"]);
  assert.deepEqual(w.days.map((d) => d.label).slice(0, 2), ["Mon 2 Nov", "Tue 3 Nov"]);
  assert.ok(w.days[5].today && !w.days[0].today);
});

test("a bar for what really plays, and a strip for each row's time spent waiting for another", () => {
  const w = weekLayout(week, name, "2026-11-07");
  const sat = w.days[5];
  assert.deepEqual(sat.bars.map((b) => b.entry).sort(), ["every", "glow"]); // the party row never plays
  const every = sat.bars.find((b) => b.entry === "every");
  assert.equal(every.left.toFixed(2), (100 / 9).toFixed(2)); // 17:00 on a 16:00-01:00 axis
  assert.equal(every.title, "EVERY · Sat 7 Nov · 17:00–22:00");
  const [party] = sat.waiting;
  assert.equal(party.entry, "party");
  assert.equal(party.left.toFixed(2), ((2 * 100) / 9).toFixed(2));
  assert.equal(party.title, "PARTY · Sat 7 Nov · its time is 18:00–20:00, but another row is still playing, so it doesn't get a turn");
  const fri = w.days[4];
  assert.equal(fri.bars[0].title, "ELEVEN · Fri 6 Nov · 22:00–23:00 (its time starts at 21:00; it waits for another row to finish)");
  const glow = sat.bars.find((b) => b.entry === "glow");
  assert.equal(glow.waits.length, 1);
  assert.equal(glow.waits[0].left.toFixed(2), ((100 * 1) / 7.5).toFixed(2)); // 17:00, an hour into its 7.5
  assert.match(glow.title, /waits while a playlist or show plays 17:00–22:00/);
  assert.equal(w.days[6].bars[0].title, "LATE · Sun 8 Nov · 23:00–01:00");
});

test("an empty week still has an evening to show", () => {
  const w = weekLayout({ days: week.days, slots: [] }, String, "2026-11-02");
  assert.deepEqual([w.from, w.to], [16, 24]);
});
