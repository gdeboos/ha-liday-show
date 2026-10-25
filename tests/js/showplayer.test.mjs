import assert from "node:assert/strict";
import test from "node:test";
import { plan, stillWanted } from "../../haliday_show/app/halidayshow/static/js/showplayer.js";

const song = { source: "media", path: "haliday_show/Thriller.mp3" };
const src = "api/audio/file?source=media&path=haliday_show%2FThriller.mp3";
const on = (started, extra = {}) => ({ playing: true, show: "thriller", song, started, position: 3.2, ...extra });

test("the Show player loads a song offered to it, then keeps the lights in step", () => {
  assert.deepEqual(plan({ playing: false }, null), { action: "wait" });
  assert.deepEqual(plan(on(1, { song: null }), null), { action: "wait" }); // the editor or a speaker
  assert.deepEqual(plan(on(1), null), { action: "load", started: 1, src, position: 3.2 });
  assert.deepEqual(plan(on(1), { started: 1, src }), { action: "sync" });
  assert.equal(plan(on(2, { show: "mash", song: { ...song, path: "m.mp3" } }), { started: 1, src }).action, "load");
  assert.deepEqual(plan({ playing: false }, { started: 1, src }), { action: "stop" });
  assert.deepEqual(plan(on(1, { song: null }), { started: 1, src }), { action: "stop" });
});

test("a playlist playing the same show again plays its song again", () => {
  assert.equal(plan(on(2), { started: 1, src }).action, "load");
});

test("a song that loaded after its show ended, or was replaced, isn't played", () => {
  const step = plan(on(1), null);
  assert.equal(stillWanted(on(1), step), true);
  assert.equal(stillWanted({ playing: false }, step), false);
  assert.equal(stillWanted(on(2), step), false);
  assert.equal(stillWanted(on(1, { song: null }), step), false); // the editor took over
});
