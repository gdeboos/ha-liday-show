import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as page from "../../haliday_show/app/halidayshow/static/public/public.js";

// The words the page starts with, as HA-liday Show sends them.
const W = Object.fromEntries(JSON.parse(readFileSync(new URL(
  "../../haliday_show/app/halidayshow/static/public/words.json", import.meta.url))).groups
  .flatMap((g) => g.words).map((x) => [x.key, x.text]));
const { dayText, describe } = page;
const waitText = (r) => page.waitText(r, W);

const st = (extra = {}) => ({
  open: true, choices: [{ kind: "show", id: "party", name: "Party", minutes: 3 },
    { kind: "playlist", id: "eve", name: "Christmas Eve", minutes: 12 }],
  now: null, waiting: 0, full: false, per_phone: 1, mine: [], words: W, ...extra,
});

test("visitors are told where they are in the queue", () => {
  assert.equal(waitText({ playing: true }), "Playing now. Enjoy the show!");
  assert.equal(waitText({ place: 1, wait: 5 }), "Starting in a moment…");
  assert.equal(waitText({ place: 1, wait: 130 }), "You're next, starting in about 2 minutes.");
  assert.equal(waitText({ place: 3, wait: 60 }), "You're 3rd in the queue, starting in about 1 minute.");
  assert.equal(waitText({ place: 11, wait: 600 }), "You're 11th in the queue, starting in about 10 minutes.");
});

test("the page is closed when visitors are switched off", () => {
  assert.equal(describe(st({ open: false })).closed, true);
});

test("a phone with a show waiting can't pick another, and a full queue says so", () => {
  const mine = [{ id: "r1", name: "Party", place: 1, wait: 100 }];
  const view = describe(st({ mine, now: { name: "Frozen" }, waiting: 1 }));
  assert.equal(view.block, "You can pick another show once yours starts.");
  assert.equal(view.mine[0].cancel, true);
  assert.equal(view.now, "On now: Frozen · 1 waiting");
  assert.equal(describe(st({ full: true })).block, "The queue is full. Try again in a few minutes.");
  // Once yours is playing you can queue the next one.
  assert.equal(describe(st({ mine: [{ id: "r1", name: "Party", playing: true }], now: { name: "Party" } })).block, "");
});

test("each choice says how long it lasts", () => {
  const [show, list] = describe(st()).choices;
  assert.equal(show.detail, "About 3 minutes");
  assert.equal(list.detail, "Playlist · about 12 minutes");
  assert.equal(describe(st()).now, "Nothing's on right now. Pick a show to start it.");
});

test("later shows are listed with the day they start, and an empty page says when it opens", () => {
  assert.equal(dayText("2026-12-01"), "1 December");
  const soon = [{ kind: "show", id: "snow", name: "Let It Snow", starts: "2026-12-01" },
    { kind: "playlist", id: "eve", name: "Christmas Eve", starts: "2026-12-24" }];
  let view = describe(st({ soon }));
  assert.equal(view.coming, "");
  assert.deepEqual(view.soon.map((c) => c.detail), ["From 1 December", "Playlist · from 24 December"]);
  view = describe(st({ choices: [], soon }));
  assert.equal(view.coming, "Coming soon on 1 December");
});

test("the code comes from the QR code's link and is kept for next time", async () => {
  const { codeFrom, locationProblem } = await import("../../haliday_show/app/halidayshow/static/public/public.js");
  assert.equal(codeFrom("?c=abc23456", ""), "abc23456");
  assert.equal(codeFrom("", "abc23456"), "abc23456");
  assert.equal(codeFrom("?c=new98765", "abc23456"), "new98765");
  assert.equal(codeFrom("?c=<script>", "abc23456"), "abc23456");
  assert.equal(locationProblem({ code: 1 }), "denied");
  assert.equal(locationProblem({ code: 3 }), "slow");
  assert.equal(locationProblem({ code: 2 }), "unknown");
});

test("Start only shows to phones by the lights, and the page says why not", async () => {
  const { canStart } = page;
  const whereText = (x) => page.whereText(x, W);
  assert.equal(canStart(false, { state: "idle" }), true); // your own Wi-Fi
  assert.equal(canStart(true, { state: "checking" }), false);
  assert.equal(canStart(true, { state: "far" }), false);
  assert.equal(canStart(true, { state: "near" }), true);
  const far = whereText({ state: "far", text: "You're too far away to start a show. Come and see the lights!" });
  assert.equal(far.text, "You're too far away to start a show. Come and see the lights!");
  assert.equal(whereText({ state: "denied" }).retry, true);
  assert.match(whereText({ state: "checking" }).text, /may ask to share your location/);
  assert.equal(whereText({ state: "near" }).text, "");
});

test("the footer link says your words, or the site's name", async () => {
  const { linkText } = await import("../../haliday_show/app/halidayshow/static/public/public.js");
  assert.equal(linkText({ link: "" }), "");
  assert.equal(linkText({ link: "https://www.justgiving.com/page/x", link_text: "" }), "justgiving.com");
  assert.equal(linkText({ link: "https://example.org", link_text: "Donate to the hospice" }), "Donate to the hospice");
});

test("outside opening hours visitors are told when to come back", async () => {
  const { clockText } = page;
  const comeBackText = (h) => page.comeBackText(h, W);
  assert.equal(clockText("17:00"), "5pm");
  assert.equal(clockText("16:32"), "4:32pm");
  assert.equal(clockText("09:05"), "9:05am");
  assert.equal(clockText("00:00"), "12am");
  assert.equal(comeBackText({ open: true }), "");
  const now = "2026-10-26T09:30"; // a Monday
  assert.equal(comeBackText({ open: false, now, next: "2026-10-26T17:00" }), "Shows start at 5pm. Come back then!");
  assert.equal(comeBackText({ open: false, now, next: "2026-10-27T16:32" }), "Shows start tomorrow at 4:32pm. Come back then!");
  assert.equal(comeBackText({ open: false, now, next: "2026-10-31T17:00" }), "Shows start on Saturday at 5pm. Come back then!");
  assert.equal(comeBackText({ open: false, now, next: "2026-12-01T17:00" }), "Shows start on 1 December at 5pm. Come back then!");
  assert.match(comeBackText({ open: false, now, next: null }), /not open at the moment/);
});

test("your own words, the length switch and the flashing lights warning", () => {
  const mine = { ...W, start: "Go!", length: "{minutes} long", idle: "All quiet" };
  const view = describe(st({ words: mine }));
  assert.equal(view.now, "All quiet");
  assert.equal(view.choices[0].detail, "3 minutes long");
  assert.equal(describe(st({ look: { show_length: false } })).choices[0].detail, "");
  assert.equal(page.fill("On now: {name} · {count} waiting", { name: "Party", count: 2 }), "On now: Party · 2 waiting");
  assert.equal(page.fill("Keep {unknown}", {}), "Keep {unknown}");
  assert.equal(describe(st({ now: { name: "Party" }, waiting: 2 })).now, "On now: Party · 2 waiting");
  assert.equal(page.warningShown({ warning: "off" }), false);
  assert.equal(page.warningShown({ warning: "note" }), true);
  assert.equal(page.mustAccept({ warning: "note" }, false), false);
  assert.equal(page.mustAccept({ warning: "accept" }, false), true);
  assert.equal(page.mustAccept({ warning: "accept" }, true), false);
});

test("a page left open loads again once after HA-liday Show restarts", () => {
  assert.equal(page.shouldReload("aaaa", "aaaa", ""), false);
  assert.equal(page.shouldReload("aaaa", "bbbb", ""), true);
  assert.equal(page.shouldReload("aaaa", "bbbb", "bbbb"), false); // already tried for this restart
  assert.equal(page.shouldReload("", "bbbb", ""), false);
  assert.equal(page.shouldReload("aaaa", undefined, ""), false); // an older server says nothing
});

test("music ahead / behind reads in plain words", () => {
  assert.deepEqual(page.nudgeWord(0), { key: "nudge_none", seconds: "0" });
  assert.deepEqual(page.nudgeWord(0.2), { key: "nudge_earlier_by", seconds: "0.2" });
  assert.deepEqual(page.nudgeWord(-0.15), { key: "nudge_later_by", seconds: "0.15" });
  assert.deepEqual(page.nudgeWord(1), { key: "nudge_earlier_by", seconds: "1.0" });
});

test("five quick taps on the title open the admin PIN box; a pause starts again", () => {
  let t = { times: [] };
  for (const at of [0, 300, 600, 900]) {
    t = page.tapsDone(t.times, at);
    assert.equal(t.done, false);
  }
  t = page.tapsDone(t.times, 1200);
  assert.equal(t.done, true);
  assert.deepEqual(t.times, []);
  t = { times: [] };
  for (const at of [0, 300, 600, 2000, 2300, 2600, 2900]) t = page.tapsDone(t.times, at);
  assert.equal(t.done, false);
  assert.equal(page.tapsDone(t.times, 3200).done, true);
});


test("the queue shows the first few, always yours, and opens to show all", () => {
  const queue = ["A", "B", "C", "D", "E"].map((name, k) => ({ name, wait: 60 * (k + 1), yours: name === "E", ...(name === "E" ? { id: "e1" } : {}) }));
  const shut = page.queueView({ queue }, W);
  assert.equal(shut.head, "Up next");
  assert.deepEqual(shut.rows.map((r) => r.name), ["A", "B", "C", "E"]);
  assert.equal(shut.rows[3].when, "Yours · in 5 minutes");
  assert.equal(shut.rows[3].id, "e1");
  assert.equal(shut.rows[0].when, "in 1 minute");
  assert.equal(shut.more, "Show all 5");
  const open = page.queueView({ queue }, W, true);
  assert.equal(open.rows.length, 5);
  assert.equal(open.more, "Show fewer");
  assert.deepEqual(page.queueView({ queue: [] }, W), { head: "", rows: [], more: "" });
});

test("headings come in the order they first appear", () => {
  assert.deepEqual(page.headingsOf([{ group: "Bands" }, { group: "" }, { group: "Movies" }, { group: "Bands" }]), ["Bands", "Movies"]);
});

test("the progress bar moves on between answers and stops at the end", () => {
  assert.equal(page.progressOf(null, 0), null);
  assert.equal(page.progressOf({ name: "Scene" }, 0), null);
  assert.equal(page.progressOf({ position: 10, duration: 40 }, 10000), 0.5);
  assert.equal(page.progressOf({ position: 39, duration: 40 }, 5000), 1);
});

test("the button says Queue when a pick would wait, Start when it would play now", () => {
  assert.equal(page.startWord({ now: null, queue: [] }), "start");
  assert.equal(page.startWord({ now: { name: "Party" }, queue: [] }), "queue_btn");
  assert.equal(page.startWord({ now: null, queue: [{ name: "Party" }] }), "queue_btn");
});

test("a press on a show with no speaker also starts listening, once", () => {
  const st = { listen: { pin: false } };
  assert.equal(page.listensToo({ speaker: false }, st, false), true);
  assert.equal(page.listensToo({ speaker: false }, st, true), false);
  assert.equal(page.listensToo({ speaker: true }, st, false), false);
  assert.equal(page.listensToo({ speaker: false }, { listen: null }, false), false);
});

test("the Install button isn't offered inside the installed app", () => {
  const win = (standalone, iosStandalone) => ({ matchMedia: () => ({ matches: standalone }), navigator: { standalone: iosStandalone } });
  assert.equal(page.runningAsApp(win(false, false)), false);
  assert.equal(page.runningAsApp(win(true, false)), true);
  assert.equal(page.runningAsApp(win(false, true)), true);
});

test("an accepted warning is remembered until its words change", () => {
  assert.equal(page.warningAccepted("", "⚠ Flashing lights"), false);
  assert.equal(page.warningAccepted("⚠ Flashing lights", "⚠ Flashing lights"), true);
  assert.equal(page.warningAccepted("⚠ Flashing lights", "⚠ Strobes and flashing lights"), false);
});
