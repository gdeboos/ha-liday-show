import assert from "node:assert/strict";
import test from "node:test";

import { EFFECTS, LIVE_LEVELS, bake, bakeLive, newClip, renderTrack, setLiveSource } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import { BLOCK_EFFECTS } from "../../haliday_show/app/halidayshow/static/js/playlisteditor.js";
import { LIVE_EFFECTS } from "../../haliday_show/app/halidayshow/static/js/housescenes.js";
import { effectsForAI } from "../../haliday_show/app/halidayshow/static/js/aiclips.js";

const meter = (extra = {}) => ({ ...newClip("levelmeter", 0, 8), color: "#00ff00", color2: "#ff0000", count: "2", ...extra });
const lit = (frame, n) => [...Array(n).keys()].filter((i) => frame[i * 3] + frame[i * 3 + 1] + frame[i * 3 + 2] > 0);

test("the Level meter fills with the level it follows, from where it's told", () => {
  setLiveSource(() => ({ loudness: 50, bass: 100, mid: 0, treble: 0 }));
  try {
    assert.equal(lit(renderTrack([meter()], 1, 10), 10).length, 5);
    assert.equal(lit(renderTrack([meter({ follows: "bass" })], 1, 10), 10).length, 10);
    assert.equal(lit(renderTrack([meter({ follows: "mid" })], 1, 10), 10).length, 0);
    const middle = lit(renderTrack([meter({ direction: "from the middle" })], 1, 10), 10);
    assert.ok(middle.includes(4) && middle.includes(5) && !middle.includes(0)); // out from the middle
    const ends = lit(renderTrack([meter({ direction: "from both ends" })], 1, 10), 10);
    assert.ok(ends.includes(0) && ends.includes(9) && !ends.includes(5));
  } finally { setLiveSource(null); }
});

test("with no music it breathes gently in its colours, every light lit, and that's what the scene bakes", () => {
  const a = renderTrack([meter()], 0, 10), b = renderTrack([meter()], 2, 10);
  assert.equal(lit(b, 10).length, 10);
  assert.ok(Math.max(...b) > Math.max(...a)); // brighter halfway through its breath
  assert.ok(Math.max(...b) < 100); // and gentle
  setLiveSource(() => ({ loudness: 100 }));
  try {
    const baked = bake({ duration: 1, tracks: [{ device: "w", clips: [meter()] }] }, { w: { segments: 10 } }, 10);
    const head = new DataView(baked.buffer).getUint32(5);
    assert.ok(Math.max(...baked.subarray(9 + head, 9 + head + 30)) < 100); // the idle look, whatever the preview hears
  } finally { setLiveSource(null); }
});

test("a scene's live lights baked at every level, for the player to pick from", () => {
  const devices = { w: { segments: 10 }, m: { segments: 8, matrix: { w: 4, h: 2, start: "top left", order: "rows", zigzag: true } },
    s: { segments: 10 }, p: { segments: 10, parts: [{ id: "a", from: 1, to: 5 }] } };
  const show = { duration: 1, tracks: [{ device: "w", clips: [meter({ follows: "bass" })] }, { device: "s", clips: [newClip("solid", 0, 1)] },
    { device: "m", clips: [meter()] }, { device: "p", clips: [meter()] }] };
  const blob = bakeLive(show, devices);
  const hl = new DataView(blob.buffer).getUint32(5);
  const header = JSON.parse(new TextDecoder().decode(blob.subarray(9, 9 + hl)));
  assert.deepEqual(header.tracks, [{ device: "w", segments: 10, kind: "level", follows: "bass" },
    { device: "m", segments: 8, kind: "level", follows: "loudness" }]); // not the solid one, nor a light with parts
  assert.equal(header.frames, LIVE_LEVELS);
  const stride = 18 * 3, frame = (k) => blob.subarray(9 + hl + k * stride, 9 + hl + (k + 1) * stride);
  assert.equal(lit(frame(0), 10).length, 0); // 0 %: dark
  assert.equal(lit(frame(10), 10).length, 5); // 50 %
  assert.equal(lit(frame(20), 10).length, 10); // 100 %
  assert.equal(bakeLive({ tracks: [{ device: "s", clips: [newClip("solid", 0, 1)] }] }, devices), null);
});

test("live effects stay in scenes", () => {
  assert.ok(LIVE_EFFECTS.includes("levelmeter"));
  assert.ok(!BLOCK_EFFECTS.includes("levelmeter"));
  assert.ok(!effectsForAI().some((e) => e.key === "levelmeter"));
  assert.ok(EFFECTS.levelmeter.wholeLoop && EFFECTS.levelmeter.sceneOnly);
});
