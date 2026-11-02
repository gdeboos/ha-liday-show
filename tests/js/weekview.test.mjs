import assert from "node:assert/strict";
import test from "node:test";

import { weekLayout } from "../../haliday_show/app/halidayshow/static/js/weekview.js";

const week = {
  days: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"],
  slots: [
    { entry: "every", lane: "show", day: "2026-11-07", start: "2026-11-07T17:00", end: "2026-11-07T22:00", covered: [["2026-11-07T18:00", "2026-11-07T20:00"]] },
    { entry: "late", lane: "show", day: "2026-11-08", start: "2026-11-08T23:00", end: "2026-11-09T01:00", covered: [] },
    { entry: "glow", lane: "scene", day: "2026-11-07", start: "2026-11-07T16:00", end: "2026-11-07T23:30", covered: [], waits: [["2026-11-07T17:00", "2026-11-07T22:00"]] },
  ],
};

test("the week runs from the earliest start to the latest end, on whole hours, past midnight if need be", () => {
  const w = weekLayout(week, (id) => id.toUpperCase(), "2026-11-07");
  assert.deepEqual([w.from, w.to], [16, 25]);
  assert.deepEqual(w.ticks.map((t) => t.label), ["16:00", "18:00", "20:00", "22:00", "00:00"]);
  assert.equal(w.days.length, 7);
  assert.deepEqual(w.days.map((d) => d.label).slice(0, 2), ["Mon 2 Nov", "Tue 3 Nov"]);
  assert.ok(w.days[5].today && !w.days[0].today);
});

test("each stretch is placed along its day, with the parts a higher row takes and the waits for a show", () => {
  const w = weekLayout(week, (id) => id.toUpperCase(), "2026-11-07");
  const sat = w.days[5].bars;
  const every = sat.find((b) => b.entry === "every");
  assert.equal(every.left.toFixed(2), (100 / 9).toFixed(2)); // 17:00 on a 16:00-01:00 axis
  assert.equal(every.width.toFixed(2), ((5 * 100) / 9).toFixed(2));
  assert.equal(every.covered[0].left, 20); // 18:00 is 1 of the bar's 5 hours in
  assert.equal(every.covered[0].width, 40);
  assert.equal(every.title, "EVERY · 17:00–22:00 · a row higher up plays 18:00–20:00");
  const glow = sat.find((b) => b.entry === "glow");
  assert.equal(glow.lane, "scene");
  assert.equal(glow.waits.length, 1);
  assert.match(glow.title, /waits while a playlist or show plays 17:00–22:00/);
  const late = w.days[6].bars[0];
  assert.equal(late.title, "LATE · 23:00–01:00");
});

test("an empty week still has an evening to show", () => {
  const w = weekLayout({ days: week.days, slots: [] }, String, "2026-11-02");
  assert.deepEqual([w.from, w.to], [16, 24]);
});
