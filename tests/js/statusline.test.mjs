import { test } from "node:test";
import assert from "node:assert/strict";
import { StatusLine, clock, LIT_MS, HINT_MS } from "../../haliday_show/app/halidayshow/static/js/statusline.js";

// Just enough of the DOM for the status line: elements with children, attributes and clicks.
class El {
  constructor(tag) { Object.assign(this, { tag, children: [], attrs: {}, className: "", title: "", listeners: {}, own: "" }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
  addEventListener(e, f) { this.listeners[e] = f; }
  click() { this.listeners.click?.(); }
  set textContent(t) { this.own = t; this.children = []; }
  get textContent() { return [this.own, ...this.children.map((c) => c.textContent)].filter(Boolean).join(" "); }
  find(pred) { return pred(this) ? this : this.children.map((c) => c.find?.(pred)).find(Boolean) || null; }
}
const doc = { createElement: (tag) => new El(tag) };

function setup() {
  const el = new El("span");
  const timers = [];
  const line = new StatusLine(el, { now: () => new Date(2026, 9, 26, 8, 14), later: (fn, ms) => timers.push({ fn, ms }), doc });
  const run = () => { while (timers.length) timers.shift().fn(); };
  const button = () => el.find((e) => e.tag === "button");
  return { el, line, run, timers, button };
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

test("a failure stays until pressed, and nothing else covers it", () => {
  const { el, line, run, button } = setup();
  line.show("Couldn't save playlists: offline", "error", "playlists");
  line.show("Loading song…");
  line.show("Choose a song first", "hint");
  line.show("Presets saved", "saved", "presets");
  run();
  assert.equal(el.className, "status error");
  assert.match(el.textContent, /Couldn't save playlists/);
  assert.equal(button().getAttribute("aria-label"), "Couldn't save playlists: offline. Press to dismiss.");
  button().click();
  assert.equal(el.className, "status settled", "the save meanwhile still counts");
  assert.equal(button(), null);
});

test("a failure ending in a full stop doesn't get two", () => {
  const { line, button } = setup();
  line.show("Pick it again under Song.", "error");
  assert.equal(button().getAttribute("aria-label"), "Pick it again under Song. Press to dismiss.");
});

test("a failure goes once the same thing works again", () => {
  const { el, line } = setup();
  line.show("Couldn't save palettes: offline", "error", "palettes");
  line.show("Palettes saved", "saved", "palettes");
  assert.equal(el.className, "status saved");
  line.show("Couldn't load the song: the file has gone", "error", "song");
  line.show("", "info", "song");
  assert.equal(el.className, "status settled");
});

test("clearing without the failure's topic leaves it showing", () => {
  const { el, line } = setup();
  line.show("Couldn't save palettes: offline", "error", "palettes");
  line.show("");
  line.show("", "info", "song");
  assert.equal(el.className, "status error");
});

test("hints show in their own style, then fade", () => {
  const { el, line, run, timers } = setup();
  line.show("Give each palette its own name", "hint");
  assert.equal(el.className, "status hint");
  assert.equal(timers.at(-1).ms, HINT_MS);
  run();
  assert.equal(el.className, "status");
  assert.equal(el.textContent, "");
});

test("the polite and alert regions stay put while messages change", () => {
  const { el, line } = setup();
  const [live, alert] = el.children;
  line.show("Couldn't save: offline", "error");
  line.dismiss();
  line.show("Show saved", "saved");
  assert.deepEqual(el.children, [live, alert]);
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(alert.getAttribute("role"), "alert");
});

test("times are shown as hours and minutes", () => {
  assert.equal(clock(new Date(2026, 0, 1, 7, 5)), "07:05");
});
