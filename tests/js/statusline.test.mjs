import { test } from "node:test";
import assert from "node:assert/strict";
import { StatusLine, clock, LIT_MS } from "../../haliday_show/app/halidayshow/static/js/statusline.js";

// A stand-in element and clock: timers run when we say.
function setup() {
  const el = { className: "", textContent: "", tabIndex: -1, title: "", setAttribute() {} };
  const timers = [];
  let now = new Date(2026, 9, 26, 8, 14);
  const line = new StatusLine(el, { now: () => now, later: (fn, ms) => timers.push({ fn, ms }) });
  const run = () => { while (timers.length) timers.shift().fn(); };
  return { el, line, run, setNow: (d) => { now = d; }, timers };
}

test("a save lights up, then settles to the time it saved", () => {
  const { el, line, run, timers } = setup();
  line.show("Playlists saved", "saved");
  assert.equal(el.className, "status saved");
  assert.match(el.textContent, /✓ Playlists saved just now/);
  assert.equal(timers[0].ms, LIT_MS);
  run();
  assert.equal(el.className, "status settled");
  assert.match(el.textContent, /Saved · 08:14/);
});

test("an error stays until dismissed, and nothing covers it", () => {
  const { el, line, run } = setup();
  line.show("Couldn't save playlists: offline", "error");
  line.show("Loading song…");
  line.show("Presets saved", "saved");
  run();
  assert.equal(el.className, "status error");
  assert.match(el.textContent, /⚠ Couldn't save playlists/);
  assert.equal(el.tabIndex, 0);
  line.dismiss();
  assert.equal(el.className, "status settled", "the save meanwhile still counts");
});

test("plain messages fade back to the last save, or to nothing", () => {
  const { el, line, run } = setup();
  line.show("Loading song…");
  assert.equal(el.className, "status info");
  line.show("");
  assert.equal(el.className, "status");
  assert.equal(el.textContent, "");
  line.show("Testing Roof for 20 seconds");
  run();
  assert.equal(el.textContent, "");
});

test("times are shown as hours and minutes", () => {
  assert.equal(clock(new Date(2026, 0, 1, 7, 5)), "07:05");
});
