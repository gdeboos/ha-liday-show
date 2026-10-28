import assert from "node:assert/strict";
import test from "node:test";

import { bake, newClip, renderTrack, setMusicLevels } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import { levelCurve, levelsFit } from "../../haliday_show/app/halidayshow/static/js/musiclevel.js";

test("the loudness curve follows the song: quiet parts low, loud parts high", () => {
  const rate = 8000, samples = new Float32Array(rate * 4);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 3) * (i < rate * 2 ? 0.02 : 0.8);
  const l = levelCurve(samples, rate, "song.mp3");
  assert.equal(l.fps, 10);
  assert.equal(l.values.length, 40);
  assert.ok(l.values.every((v) => Number.isInteger(v) && v >= 0 && v <= 100));
  assert.ok(l.values[5] < 10 && l.values[35] > 90);
  const show = { loudness: l };
  assert.ok(levelsFit(show, "song.mp3", 4));
  assert.ok(!levelsFit(show, "other.mp3", 4));
  assert.ok(!levelsFit(show, "song.mp3", 30));
  assert.ok(!levelsFit({}, "song.mp3", 4));
});

test("Music level fills the light to the song's level at that moment", () => {
  const lit = (buf) => Array.from({ length: buf.length / 3 }, (_, i) => buf[i * 3] + buf[i * 3 + 1] > 0).filter(Boolean).length;
  setMusicLevels({ fps: 10, values: [0, 0, 50, 50, 100, 100] });
  try {
    const clip = { ...newClip("vumeter", 0, 1), peak: "off" };
    assert.equal(lit(renderTrack([clip], 0.05, 10)), 0);
    assert.equal(lit(renderTrack([clip], 0.25, 10)), 5);
    assert.equal(lit(renderTrack([clip], 0.45, 10)), 10);
    // The clip's place in the song counts, not the time into the clip.
    const later = { ...clip, start: 0.4, end: 1 };
    assert.equal(lit(renderTrack([later], 0.45, 10)), 10);
  } finally { setMusicLevels(null); }
});

test("a baked show uses its own saved loudness, and is dark without one", () => {
  const devices = { a: { id: "a", segments: 10 } };
  const show = { duration: 1, tracks: [{ device: "a", clips: [{ ...newClip("vumeter", 0, 1), peak: "off" }] }] };
  const frameAt = (blob, f) => [...blob.subarray(blob.length - 10 * 3 * (40 - f), blob.length - 10 * 3 * (39 - f))];
  const loud = bake({ ...show, loudness: { fps: 10, values: Array(10).fill(100) } }, devices);
  const quiet = bake(show, devices);
  assert.ok(frameAt(loud, 20).some((v) => v > 0));
  assert.ok(frameAt(quiet, 20).every((v) => v === 0));
});
