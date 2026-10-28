import assert from "node:assert/strict";
import test from "node:test";
import { describeSchedule, describeStart, entriesFor, newEntry, nextFor, scheduleLine, whenNext } from "../../haliday_show/app/halidayshow/static/js/schedule.js";

test("when a playlist next starts, in words", () => {
  assert.equal(whenNext("2026-10-25T17:00", "2026-10-25T13:55"), "today at 17:00");
  assert.equal(whenNext("2026-10-26T17:00", "2026-10-25T23:59"), "tomorrow at 17:00");
  assert.equal(whenNext("2026-10-31T17:00", "2026-10-25T13:55"), "on Sat 31 Oct at 17:00");
  assert.equal(whenNext("2027-01-01T17:00", "2026-12-31T20:00"), "tomorrow at 17:00");
});

test("a schedule in words", () => {
  const s = { start: "17:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6], from: "", to: "" };
  assert.equal(describeSchedule(s), "17:00 to 22:00 every day");
  assert.equal(describeSchedule({ ...s, days: [5, 6] }), "17:00 to 22:00 at weekends");
  assert.equal(describeSchedule({ ...s, days: [0, 1, 2, 3, 4] }), "17:00 to 22:00 on weekdays");
  assert.equal(describeSchedule({ ...s, days: [0, 2, 4] }), "17:00 to 22:00 on Mon, Wed and Fri");
  assert.equal(describeSchedule({ ...s, start: "20:00", end: "01:00", days: [4], from: "12-01", to: "01-06" }),
    "20:00 to 01:00 (the next day) on Fri, 1 Dec to 6 Jan");
});

test("a sunset start in words", () => {
  const s = { start: "sunset", offset: 0, end: "22:00", days: [0, 1, 2, 3, 4, 5, 6], from: "", to: "" };
  assert.equal(describeSchedule(s), "sunset to 22:00 every day");
  assert.equal(describeStart({ ...s, offset: 20 }), "20 minutes after sunset");
  assert.equal(describeStart({ ...s, offset: -60 }), "1 hour before sunset");
  assert.equal(describeStart({ ...s, offset: -120 }), "2 hours before sunset");
  assert.equal(describeStart({ ...s, offset: 1 }), "1 minute after sunset");
  assert.equal(describeSchedule({ ...s, end: "01:00" }), "sunset to 01:00 (the next day) every day");
});

test("schedule entries: finding them, new ones and their line", () => {
  const eve = { on: true, start: "17:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6], from: "", to: "" };
  const entries = [
    { id: "a", play: { type: "playlist", id: "night" }, ...eve },
    { id: "b", play: { type: "playlist", id: "night" }, ...eve, days: [5, 6], end: "23:00" },
    { id: "c", play: { type: "scene", id: "glow" }, ...eve, on: false },
  ];
  assert.deepEqual(entriesFor(entries, "playlist", "night").map((e) => e.id), ["a", "b"]);
  const e = newEntry("show", "one", [{ id: "x" }]);
  assert.equal(e.play.type, "show");
  assert.ok(e.on && e.days.length === 7 && e.id.startsWith("e-"));
  const state = { now: "2026-10-25T13:00", next: { a: "2026-10-26T17:00", b: "2026-10-25T17:00" } };
  assert.equal(nextFor(entries, "playlist", "night", state), "2026-10-25T17:00");
  assert.equal(scheduleLine(entries, "playlist", "night", state), "On the schedule 2×. Next starts today at 17:00");
  assert.equal(scheduleLine(entries, "playlist", "night", { ...state, scheduled: "b" }), "On now, on the schedule");
  assert.equal(scheduleLine(entries, "scene", "glow", state), "On the schedule, switched off");
  assert.equal(scheduleLine(entries, "show", "one", state), "Not on the schedule");
  assert.equal(scheduleLine([entries[0]], "playlist", "night", { now: state.now, next: { a: "2026-10-26T17:00" } }),
    "On the schedule: 17:00 to 22:00 every day. Next starts tomorrow at 17:00");
});
