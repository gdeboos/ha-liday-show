import test from "node:test";
import assert from "node:assert/strict";
import { nowOn } from "../../haliday_show/app/halidayshow/static/js/nowbar.js";

test("nothing on", () => {
  assert.equal(nowOn({ playing: false, show: null, scene: null, playlist: null }), null);
  assert.equal(nowOn(null), null);
});

test("a show, with the scene that comes back after it", () => {
  const on = nowOn({ playing: true, show: "xmas", name: "Xmas", position: 12, duration: 180, media_player: "media_player.garden",
    scene: { id: "warm", name: "Warm white", playing: false }, playlist: null });
  assert.equal(on.kind, "show");
  assert.equal(on.title, "Xmas");
  assert.equal(on.scene, "Warm white");
  assert.equal(on.mediaPlayer, "media_player.garden");
  assert.deepEqual(on.actions.map((a) => a.act), ["preview", "restart", "stop"]);
});

test("a playlist says what's playing in it", () => {
  const on = nowOn({ playing: true, show: "xmas", name: "Xmas", position: 1, duration: 9,
    playlist: { id: "eve", name: "Christmas Eve", finishing: false }, scene: null });
  assert.equal(on.kind, "playlist");
  assert.equal(on.title, "Christmas Eve");
  assert.equal(on.detail, "now: Xmas");
  assert.equal(on.id, "eve");
});

test("a scene can be turned off", () => {
  const on = nowOn({ playing: true, show: null, name: "Warm white", scene: { id: "warm", name: "Warm white", playing: true }, playlist: null });
  assert.equal(on.kind, "scene");
  assert.deepEqual(on.actions.map((a) => a.act), ["preview", "stop-scene"]);
});
