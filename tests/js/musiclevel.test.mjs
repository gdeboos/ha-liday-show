import assert from "node:assert/strict";
import test from "node:test";

import { MADE_UP, bake, newClip, renderTrack, setMusicLevels, withMusicLevels } from "../../haliday_show/app/halidayshow/static/js/effects.js";
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

test("undo keeps the song's measured loudness", async () => {
  const { keepLevels } = await import("../../haliday_show/app/halidayshow/static/js/musiclevel.js");
  const loud = { fps: 10, song: "a.mp3", values: [1, 2] };
  const now = { audio: { path: "a.mp3" }, loudness: loud, tracks: [] };
  // Back to before it was measured: it keeps the measurement.
  assert.equal(keepLevels(now, { audio: { path: "a.mp3" }, tracks: [] }).loudness, loud);
  // Back to another song: that song's own (or none), never this one's.
  assert.equal(keepLevels(now, { audio: { path: "b.mp3" }, tracks: [] }).loudness, undefined);
  const other = { fps: 10, song: "b.mp3", values: [3] };
  assert.equal(keepLevels(now, { audio: { path: "b.mp3" }, loudness: other }).loudness, other);
  assert.equal(keepLevels(now, { audio: null }).loudness, undefined);
});

test("previews with no song behind them show a made-up level, then the open show's comes back", () => {
  const lit = (buf) => Array.from({ length: buf.length / 3 }, (_, i) => buf[i * 3] + buf[i * 3 + 1] > 0).filter(Boolean).length;
  const clip = { ...newClip("vumeter", 0, 10), peak: "off" };
  setMusicLevels(null); // an open show without a song: silent
  try {
    assert.equal(lit(renderTrack([clip], 1, 20)), 0);
    const moving = [0.3, 1.1, 2.7, 4.2].map((t) => withMusicLevels(MADE_UP, () => lit(renderTrack([clip], t, 20))));
    assert.ok(moving.some((n) => n > 0) && new Set(moving).size > 1);
    assert.equal(withMusicLevels({ fps: 10, values: Array(100).fill(100) }, () => lit(renderTrack([clip], 1, 20))), 20);
    assert.equal(lit(renderTrack([clip], 1, 20)), 0); // put back
  } finally { setMusicLevels(null); }
});

test("Music level can follow one of the song's parts, and falls back to the whole song without it", async () => {
  const { partsToMeasure, keepLevels } = await import("../../haliday_show/app/halidayshow/static/js/musiclevel.js");
  const lit = (buf) => Array.from({ length: buf.length / 3 }, (_, i) => buf[i * 3] + buf[i * 3 + 1] > 0).filter(Boolean).length;
  setMusicLevels({ fps: 10, values: [100, 100, 100], parts: { bass: [0, 0, 0], drums: [50, 50, 50] } });
  try {
    const clip = { ...newClip("vumeter", 0, 1), peak: "off" };
    assert.equal(clip.stem, "the whole song");
    assert.equal(lit(renderTrack([clip], 0.05, 10)), 10);
    assert.equal(lit(renderTrack([{ ...clip, stem: "bass" }], 0.05, 10)), 0);
    assert.equal(lit(renderTrack([{ ...clip, stem: "drums" }], 0.05, 10)), 5);
    // Not measured: the whole song.
    assert.equal(lit(renderTrack([{ ...clip, stem: "vocals" }], 0.05, 10)), 10);
  } finally { setMusicLevels(null); }
  const loud = { fps: 10, values: [1], song: "s.mp3", parts: { vocals: [1] } };
  assert.deepEqual(partsToMeasure(loud, { vocals: "v.mp3", drums: "d.mp3" }), ["drums"]);
  assert.deepEqual(partsToMeasure(loud, {}), []);
  assert.deepEqual(partsToMeasure(null, { drums: "d.mp3" }), []);
  // Undo keeps measured parts.
  const after = keepLevels({ loudness: loud }, { audio: { path: "s.mp3" }, loudness: { fps: 10, values: [1], song: "s.mp3" } });
  assert.deepEqual(after.loudness.parts, { vocals: [1] });
});
