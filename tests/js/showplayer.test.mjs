import assert from "node:assert/strict";
import test from "node:test";
import { plan } from "../../haliday_show/app/halidayshow/static/js/showplayer.js";

const song = { source: "media", path: "haliday_show/Thriller.mp3" };
const src = "api/audio/file?source=media&path=haliday_show%2FThriller.mp3";

test("the Show player loads a song offered to it, then keeps the lights in step", () => {
  assert.deepEqual(plan({ playing: false }, null), { action: "wait" });
  assert.deepEqual(plan({ playing: true, show: "thriller", song: null }, null), { action: "wait" }); // the editor or a speaker
  assert.deepEqual(plan({ playing: true, show: "thriller", song, position: 3.2 }, null),
    { action: "load", show: "thriller", src, position: 3.2 });
  assert.deepEqual(plan({ playing: true, show: "thriller", song, position: 4 }, { show: "thriller", src }), { action: "sync" });
  assert.equal(plan({ playing: true, show: "mash", song: { ...song, path: "m.mp3" } }, { show: "thriller", src }).action, "load");
  assert.deepEqual(plan({ playing: false }, { show: "thriller", src }), { action: "stop" });
  assert.deepEqual(plan({ playing: true, show: "thriller", song: null }, { show: "thriller", src }), { action: "stop" });
});
