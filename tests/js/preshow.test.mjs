import assert from "node:assert/strict";
import test from "node:test";

import { finalGroups, headline, lastText, lookLines, tally, when, worst } from "../../haliday_show/app/halidayshow/static/js/preshow.js";

test("the worst level wins", () => {
  assert.equal(worst([]), "ok");
  assert.equal(worst(["ok", "info"]), "info");
  assert.equal(worst(["warn", "ok", "fail", "info"]), "fail");
});

test("what you saw becomes lines", () => {
  const lines = lookLines([{ name: "Porch", answer: "yes" }, { name: "Tree", answer: "yes" }, { name: "Gate", answer: "no" },
    { name: "Fence", answer: "skip" }]);
  assert.deepEqual(lines.map((x) => [x.level, x.text]), [
    ["ok", "You saw Porch and Tree blink."], ["fail", "You didn't see Gate blink properly."], ["warn", "Fence wasn't looked at."]]);
  assert.deepEqual(lookLines([]), []);
});

test("counting problems: the How shows start line only on its own", () => {
  const groups = [
    { key: "lights", items: [{ level: "ok", text: "All 2 lights answered." }] },
    { key: "start", summary: { level: "warn", text: "Nothing will start shows tonight…" }, items: [] },
    { key: "sound", items: [{ level: "info", text: "No sound." }] }];
  assert.deepEqual(tally(groups), { level: "warn", problems: 0, warnings: 1 });
  const done = finalGroups(groups, [{ name: "Gate", answer: "no" }]);
  assert.deepEqual(tally(done), { level: "fail", problems: 1, warnings: 1 });
  assert.equal(done[0].items[0].level, "fail"); // problems first
  const started = [{ key: "start", summary: { level: "ok", text: "Shows start from the visitors' page." },
    items: [{ level: "warn", text: "No Public address" }, { level: "ok", text: "Open now" }] }];
  assert.deepEqual(tally(started), { level: "warn", problems: 0, warnings: 1 });
});

test("headlines", () => {
  assert.equal(headline({ level: "ok", problems: 0, warnings: 0 }), "All good for tonight");
  assert.equal(headline({ level: "info", problems: 0, warnings: 0 }), "All good for tonight");
  assert.equal(headline({ level: "warn", problems: 0, warnings: 1 }), "Ready, with 1 thing to look at");
  assert.equal(headline({ level: "fail", problems: 2, warnings: 3 }), "2 problems to fix before the show");
});

test("when it was, in words", () => {
  const now = new Date(2026, 10, 5, 20, 0);
  assert.equal(when("2026-11-05T18:40", now), "tonight at 18:40");
  assert.equal(when("2026-11-05T09:05", now), "today at 09:05");
  assert.equal(when("2026-11-04T18:40", now), "yesterday at 18:40");
  assert.equal(when("2026-11-02T18:40", now), "on Monday at 18:40");
  assert.equal(when("2026-10-01T18:40", now), "on 1 October");
});

test("Setup's line", () => {
  const now = new Date(2026, 10, 5, 20, 0);
  assert.match(lastText(null, now), /^Not run yet/);
  assert.equal(lastText({ at: "2026-11-05T18:40", level: "ok", problems: 0, warnings: 0 }, now), "Last checked tonight at 18:40: all good.");
  assert.equal(lastText({ at: "2026-11-04T18:40", level: "fail", problems: 1, warnings: 0 }, now), "Last checked yesterday at 18:40: 1 problem.");
  assert.equal(lastText({ at: "2026-11-05T18:40", level: "warn", problems: 0, warnings: 2 }, now), "Last checked tonight at 18:40: 2 things to look at.");
});
