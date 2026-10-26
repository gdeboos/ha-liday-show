import assert from "node:assert/strict";
import test from "node:test";
import { describe, waitText } from "../../haliday_show/app/halidayshow/static/public/public.js";

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
