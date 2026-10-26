import assert from "node:assert/strict";
import test from "node:test";
import { dayText, describe, waitText } from "../../haliday_show/app/halidayshow/static/public/public.js";

const st = (extra = {}) => ({
  open: true, choices: [{ kind: "show", id: "party", name: "Party", minutes: 3 },
    { kind: "playlist", id: "eve", name: "Christmas Eve", minutes: 12 }],
  now: null, waiting: 0, full: false, per_phone: 1, mine: [], ...extra,
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
  const { canStart, whereText } = await import("../../haliday_show/app/halidayshow/static/public/public.js");
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
