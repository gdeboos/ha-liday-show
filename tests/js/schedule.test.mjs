import assert from "node:assert/strict";
import test from "node:test";
import { describeSchedule, whenNext } from "../../haliday_show/app/halidayshow/static/js/schedule.js";

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
