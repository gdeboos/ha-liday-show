import assert from "node:assert/strict";
import test from "node:test";

import { healthLines, showProblems } from "../../haliday_show/app/halidayshow/static/js/showhealth.js";

const kinds = { pillars: { kind: "light", name: "Pillars" }, "@house": { kind: "house" }, "@group:x": { kind: "group" } };
const track = (t) => kinds[t.device] || { kind: "missing" };
const fits = { chase: { level: "no", reasons: ["One colour at a time."] }, fast: { level: "limited", reasons: ["Too fast."] } };
const fit = async (c) => fits[c.effect] || { level: "ok", reasons: [] };
const clip = (effect) => ({ effect, start: 0, end: 1 });

test("a healthy show has nothing to say", async () => {
  const show = { tracks: [{ device: "pillars", clips: [clip("solid")] }, { device: "@group:x", clips: [clip("chase")] }] };
  assert.deepEqual(await showProblems(show, { track, fit }), []);
});

test("clips that won't show, only partly show, and ones on a removed light", async () => {
  const show = { tracks: [
    { device: "pillars", clips: [clip("chase"), clip("chase"), clip("fast"), clip("solid")] },
    { device: "@house", clips: [clip("fast")] },
    { device: "gone", clips: [clip("solid")] },
    { device: "also-gone", clips: [] }] };
  const p = await showProblems(show, { track, fit });
  assert.deepEqual(p.map((x) => [x.level, x.text]), [
    ["fail", "2 clips won't show on Pillars. One colour at a time."],
    ["warn", "1 clip only partly shows on Pillars. Too fast."],
    ["warn", "1 clip only partly shows on the House lane. Too fast."],
    ["warn", "1 effect on a light you've removed, so it doesn't play."]]);
});

test("out of date or never saved: Fix saves it again", async () => {
  const [stale] = await showProblems({ tracks: [] }, { track, fit, current: false });
  assert.equal(stale.resave, true);
  assert.match(stale.text, /^Saved before a change/);
  const [unready] = await showProblems({ tracks: [] }, { track, fit, ready: false });
  assert.match(unready.text, /^Not ready to play yet/);
});

test("lines for a list of shows: problems first, the fine ones in one line", () => {
  const lines = healthLines([
    { id: "a", name: "Carol", problems: [{ level: "warn", text: "Saved before…", resave: true }] },
    { id: "b", name: "Frozen", problems: [] },
    { id: "c", name: "Jingle", problems: [{ level: "fail", text: "2 clips won't show on Pillars." }] }]);
  assert.deepEqual(lines.map((x) => [x.level, x.text, x.show]), [
    ["fail", "Jingle: 2 clips won't show on Pillars.", "c"],
    ["warn", "Carol: Saved before…", "a"],
    ["ok", "Frozen is fine.", undefined]]);
  assert.equal(lines[1].resave, true);
  assert.deepEqual(healthLines([{ id: "b", name: "Frozen", problems: [] }, { id: "d", name: "Eve", problems: [] }]),
    [{ level: "ok", text: "All 2 shows are fine." }]);
  assert.equal(healthLines([])[0].level, "info");
});
