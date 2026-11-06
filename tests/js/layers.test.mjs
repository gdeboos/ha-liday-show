import assert from "node:assert/strict";
import test from "node:test";

import { DUCK_DB, anchorAt, duckEnvelope, limit, sourceKey, matchGain, mixLayers, placeClips, resultTime } from "../../haliday_show/app/halidayshow/static/js/layers.js";
import { cut, insert } from "../../haliday_show/app/halidayshow/static/js/music.js";

const A = { source: "media", path: "a.mp3" }, B = { source: "media", path: "b.mp3" };
const song = [{ src: "media:a.mp3", start: 0, end: 60 }];
const refs = { "media:a.mp3": A, "media:b.mp3": B };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} != ${b}`);

test("a clip pinned to a moment in the song moves with cuts, and goes with a cut that takes it out", () => {
  const anchor = { song: A, t: 30 };
  near(resultTime(song, 0, anchor), 30);
  const p = cut(song, 0, 10, 20);
  near(resultTime(p, 0, anchor), 20, "10 s earlier after cutting before it");
  assert.equal(resultTime(cut(song, 0, 25, 35), 0, anchor), null, "cut out");
  // In a spliced-in song too.
  const spliced = insert(song, 0, 5, [{ src: "media:b.mp3", start: 0, end: 10 }]);
  near(resultTime(spliced, 0, { song: B, t: 2 }), 7);
  near(resultTime(spliced, 0, anchor), 40);
});

test("a result time maps back to its moment in the song, and round-trips", () => {
  const p = cut(song, 0.5, 10, 20);
  for (const t of [3, 9.5, 12, 40]) {
    const a = anchorAt(p, 0.5, t, refs);
    near(resultTime(p, 0.5, a), t, `at ${t}`);
  }
  assert.equal(anchorAt(p, 0.5, 9999, refs), null);
  const spliced = insert(song, 0, 5, [{ src: "media:b.mp3", start: 0, end: 10 }]);
  assert.deepEqual(anchorAt(spliced, 0, 7, refs), { song: B, t: 2 });
});

test("clips are placed, and only those still in the song", () => {
  const layers = [{ name: "Bells", gain: 0, clips: [
    { song: B, start: 0, end: 2, anchor: { song: A, t: 5 } },
    { song: B, start: 0, end: 2, anchor: { song: A, t: 15 } },
  ] }];
  assert.deepEqual(placeClips(layers, cut(song, 0, 10, 20), 0), [{ layer: 0, clip: 0, at: 5, length: 2, speed: 1, semis: 0 }]);
});

test("mixing adds each clip at its place with its gain and fades, leaving the song alone", () => {
  const rate = 100;
  const main = [new Float32Array(1000)];
  const sources = { "media:b.mp3": [new Float32Array(300).fill(0.5)] };
  const layers = [{ name: "x", gain: -6.0206, clips: [{ song: B, start: 1, end: 3, anchor: { song: A, t: 2 }, fadeIn: 0.5, gain: 0 }] }];
  const out = mixLayers(main, layers, placeClips(layers, song, 0), sources, rate);
  assert.equal(main[0][250], 0, "the song's own audio isn't changed");
  near(out[0][199], 0, "nothing before the clip");
  near(out[0][200], 0, "fades in from silence");
  near(out[0][300], 0.25, "half volume (−6 dB) once faded in");
  near(out[0][399], 0.25);
  near(out[0][400], 0, "ends after its 2 s");
});

test("the limiter keeps a loud mix under the ceiling and leaves a quiet one alone", () => {
  const rate = 1000;
  const quiet = [Float32Array.from({ length: 2000 }, (_, i) => 0.5 * Math.sin(i / 5))];
  const before = Float32Array.from(quiet[0]);
  limit(quiet, rate);
  assert.deepEqual(quiet[0], before);
  const loud = [Float32Array.from({ length: 2000 }, (_, i) => (i > 1000 && i < 1050 ? 1.6 : 0.5) * Math.sin(i / 5))];
  limit(loud, rate);
  assert.ok(Math.max(...loud[0].map(Math.abs)) <= 0.98 + 1e-6);
  near(loud[0][100], 0.5 * Math.sin(100 / 5), "untouched well before the loud bit");
});

test("a new clip sits 6 LU under the song", () => {
  assert.equal(matchGain(-14, -20), 0);
  assert.equal(matchGain(-14, -8), -12);
  assert.equal(matchGain(-14, -60), 12, "at most 12 dB up");
  assert.equal(matchGain(-Infinity, -20), 0);
});

test("a clip placed right at the end of a piece or the song is still in the song", () => {
  const p = cut(song, 0, 10, 20); // pieces 0–10 and 20–60
  for (const t of [9.9996, 10, 49.9999, 50]) {
    const a = anchorAt(p, 0, t, refs);
    assert.ok(a, `at ${t}`);
    assert.notEqual(resultTime(p, 0, a), null, `placed at ${t}`);
  }
});

test("each layer says how far the song dips, and the deepest wins where they overlap", () => {
  const rate = 100, n = 1000;
  const sources = { "media:b.mp3": [new Float32Array(300).fill(0.5)] };
  const voice = (duckDb, t = 4) => ({ name: "Voice", gain: 0, duck: true, ...(duckDb ? { duckDb } : {}),
    clips: [{ song: B, start: 0, end: 2, anchor: { song: A, t } }] });
  const one = (L) => duckEnvelope([L], placeClips([L], song, 0), sources, n, rate);
  near(one(voice(null))[500], 10 ** (-8 / 20), "8 dB to start, as before");
  near(one(voice(20))[500], 10 ** (-20 / 20), "nearly silent");
  near(one(voice(3))[500], 10 ** (-3 / 20), "a little");
  const both = [voice(3), voice(16, 5)];
  const env = duckEnvelope(both, placeClips(both, song, 0), sources, n, rate);
  near(env[450], 10 ** (-3 / 20), "only the gentle one yet");
  near(env[620], 10 ** (-16 / 20), "the deeper one while both play");
});

test("a gentle dip glides at its own pace, whatever another layer does elsewhere", () => {
  const rate = 100, n = 2000;
  const sources = { "media:b.mp3": [new Float32Array(300).fill(0.5)] };
  const voice = (duckDb, t) => ({ name: "Voice", gain: 0, duck: true, duckDb, clips: [{ song: B, start: 0, end: 2, anchor: { song: A, t } }] });
  const alone = [voice(3, 4)], both = [voice(3, 4), voice(24, 14)];
  const a = duckEnvelope(alone, placeClips(alone, song, 0), sources, n, rate);
  const b = duckEnvelope(both, placeClips(both, song, 0), sources, n, rate);
  near(b[625], a[625], "coming back up after the gentle clip just as it would alone");
  assert.ok(a[625] < 1 && a[625] > 10 ** (-3 / 20));
});

test("a layer that quietens the song dips it while its clips play, smoothly, and only then", () => {
  const rate = 100, n = 1000;
  const sources = { "media:b.mp3": [new Float32Array(300).fill(0.5)] };
  const layer = (duck) => [{ name: "Voice", gain: 0, duck, clips: [{ song: B, start: 0, end: 2, anchor: { song: A, t: 4 } }] }];
  const placed = placeClips(layer(true), song, 0);
  assert.equal(duckEnvelope(layer(false), placed, sources, n, rate), null, "off by default");
  assert.equal(duckEnvelope(layer(true), placed, {}, n, rate), null, "a missing sample doesn't dip the song");
  const env = duckEnvelope(layer(true), placed, sources, n, rate);
  const dip = 10 ** (DUCK_DB / 20);
  near(env[100], 1, "untouched well before");
  near(env[400], dip, "down by the clip's start");
  near(env[599], dip, "down until its end");
  assert.ok(env[390] < 1 && env[390] > dip, "already going down just before");
  assert.ok(env[620] > dip && env[620] < 1, "coming back up after");
  near(env[900], 1, "back up well after");
  const main = [new Float32Array(n).fill(0.2)];
  const out = mixLayers(main, layer(true), placed, sources, rate);
  near(out[0][100], 0.2);
  near(out[0][500], 0.2 * dip + 0.5, "the song dipped, the clip at full volume");
});

test("a layer matching the song's tempo plays its clips faster or slower, from the stretched audio", () => {
  const layers = [{ name: "Loop", gain: 0, matchTempo: true, clips: [{ song: B, start: 1, end: 3, bpm: 100, anchor: { song: A, t: 2 } }] }];
  const [p] = placeClips(layers, song, 0, 125);
  assert.equal(p.speed, 1.25);
  near(p.length, 1.6, "2 s of it plays in 1.6 s");
  assert.equal(placeClips([{ ...layers[0], matchTempo: false }], song, 0, 125)[0].speed, 1);
  assert.equal(placeClips(layers, song, 0, null)[0].speed, 1, "no tempo for the song yet");
  // The stretched copy: its 0.8–2.4 s is the clip's 1–3 s.
  const rate = 100, key = sourceKey(layers[0].clips[0], 1.25);
  const sources = { "media:b.mp3": [new Float32Array(400)], [key]: [Float32Array.from({ length: 320 }, (_, i) => i)] };
  const out = mixLayers([new Float32Array(1000)], layers, [p], sources, rate);
  near(out[0][200], 80, "starts at 0.8 s of the stretched audio");
  near(out[0][359], 239);
  near(out[0][360], 0, "and ends 1.6 s later");
});

test("a layer's EQ shapes its clips and not the song", () => {
  const rate = 8000, n = rate * 3, tone = (f) => Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * f * i) / rate));
  const layers = [{ name: "x", gain: 0, eq: { bass: -24, mid: 0, treble: 0, changes: [] },
    clips: [{ song: B, start: 0, end: 2, anchor: { song: A, t: 0.5 } }] }];
  const sources = { "media:b.mp3": [tone(60)] };
  const placed = placeClips(layers, song, 0);
  const main = [tone(60)];
  const out = mixLayers(main, layers, placed, sources, rate, { pieces: song, crossfade: 0 });
  let peak = 0;
  for (let i = rate * 1.5; i < rate * 2; i++) peak = Math.max(peak, Math.abs(out[0][i] - main[0][i]));
  assert.ok(peak < 0.03, `the layer's bass is off: ${peak}`);
  near(out[0][100], main[0][100], "the song is untouched before it");
});

test("a made file's parts get each layer clip's matching part", async () => {
  const { clipPart } = await import("../../haliday_show/app/halidayshow/static/js/layers.js");
  const P = (song) => Object.fromEntries(["vocals", "drums", "bass", "rest", "music"].map((p) => [p, `.parts/${song}/${p}.wav`]));
  const songs = [{ source: "media", path: "carol.mp3", parts: P("carol") }, { source: "media", path: "bells.wav" }];
  const ref = (path) => ({ source: "media", path });
  // A whole song with parts: that part of it.
  assert.deepEqual(clipPart(ref("carol.mp3"), "drums", songs), ref(".parts/carol/drums.wav"));
  // Just its vocals: only the vocals part, not the music.
  assert.deepEqual(clipPart(ref(".parts/carol/vocals.wav"), "vocals", songs), ref(".parts/carol/vocals.wav"));
  assert.equal(clipPart(ref(".parts/carol/vocals.wav"), "music", songs), null);
  assert.equal(clipPart(ref(".parts/carol/vocals.wav"), "drums", songs), null);
  // Just its drums: the drums and the music.
  assert.deepEqual(clipPart(ref(".parts/carol/drums.wav"), "music", songs), ref(".parts/carol/drums.wav"));
  assert.equal(clipPart(ref(".parts/carol/drums.wav"), "rest", songs), null);
  // Its music: the music, and its drums, bass and rest to theirs, but no vocals.
  assert.deepEqual(clipPart(ref(".parts/carol/music.wav"), "music", songs), ref(".parts/carol/music.wav"));
  assert.deepEqual(clipPart(ref(".parts/carol/music.wav"), "bass", songs), ref(".parts/carol/bass.wav"));
  assert.equal(clipPart(ref(".parts/carol/music.wav"), "vocals", songs), null);
  // A sample, or a song not split: the rest of the music.
  assert.deepEqual(clipPart(ref("bells.wav"), "rest", songs), ref("bells.wav"));
  assert.deepEqual(clipPart(ref("bells.wav"), "music", songs), ref("bells.wav"));
  assert.equal(clipPart(ref("bells.wav"), "vocals", songs), null);
  assert.deepEqual(clipPart({ source: "samples", path: "ho.wav" }, "rest", songs), { source: "samples", path: "ho.wav" });
});

test("ducking can follow the clips' own audio while mixing in something else", () => {
  const rate = 100, n = 1000;
  const main = [new Float32Array(n).fill(0.5)];
  const layers = [{ name: "L", gain: 0, duck: true, clips: [{ song: B, start: 0, end: 2, anchor: { song: A, t: 3 }, gain: 0 }] }];
  const placed = placeClips(layers, song, 0);
  const own = { "media:b.mp3": [new Float32Array(400).fill(0.2)] };
  // This part has nothing of the clip, but the song still dips where the whole mix does.
  const out = mixLayers(main, layers, placed, {}, rate, { heard: own });
  assert.ok(out[0][400] < 0.3 && Math.abs(out[0][900] - 0.5) < 1e-6);
  assert.ok(Math.abs(mixLayers(main, layers, placed, {}, rate)[0][400] - 0.5) < 1e-6);
});

test("cutting a stretch out of a layer closes it up or leaves a gap, and nothing else moves", async () => {
  const { cutLayer, keepLayer, LAYER_XF } = await import("../../haliday_show/app/halidayshow/static/js/layers.js");
  const refs = { "media:a.mp3": A };
  const clip = (t, s0, s1) => ({ song: B, start: s0, end: s1, anchor: { song: A, t }, gain: 0, fadeIn: 0, fadeOut: 0 });
  // Clips at 0-10, 20-30 and 40-50 (each 10 s of b.mp3); the song's an untouched minute.
  const layers = [{ name: "L", gain: 0, clips: [clip(0, 0, 10), clip(20, 0, 10), clip(40, 0, 10)] }, { name: "M", gain: 0, clips: [clip(5, 0, 1)] }];
  const ctx = { pieces: song, crossfade: 0, refs };
  const at = (ls) => placeClips(ls, song, 0).filter((p) => p.layer === 0).map((p) => [p.at, ls[0].clips[p.clip].start, ls[0].clips[p.clip].end]);
  // A gap: 25-42 cut out of the layer; the middle clip loses its end, the last its start.
  const gap = cutLayer(layers, 0, 25, 42, { ...ctx, closeUp: false });
  assert.deepEqual(at(gap), [[0, 0, 10], [20, 0, 5], [42, 2, 10]]);
  assert.equal(gap[1], layers[1]); // the other layer's untouched
  // Closed up: what's after the cut moves 17 s earlier, overlapping the join by a short crossfade.
  const closed = cutLayer(layers, 0, 25, 42, { ...ctx, closeUp: true });
  assert.deepEqual(at(closed), [[0, 0, 10], [20, 0, 5 + LAYER_XF], [25, 2, 10]]);
  assert.equal(closed[0].clips[1].fadeOut, LAYER_XF);
  assert.equal(closed[0].clips[2].fadeIn, LAYER_XF);
  // A whole clip inside the cut goes; later clips close up.
  const whole = cutLayer(layers, 0, 15, 35, { ...ctx, closeUp: true });
  assert.deepEqual(at(whole), [[0, 0, 10], [20, 0, 10]]);
  // Keep only 5-45: trimmed to it, nothing moves.
  assert.deepEqual(at(keepLayer(layers, 0, 5, 45, ctx)), [[5, 5, 10], [20, 0, 10], [40, 0, 5]]);
});

test("cutting a layer follows tempo-matched clips and a song that's been cut", async () => {
  const { cutLayer } = await import("../../haliday_show/app/halidayshow/static/js/layers.js");
  const refs = { "media:a.mp3": A };
  // A 100 BPM clip on a layer matching a 120 BPM song plays 1.2 times as fast.
  const L = { name: "L", gain: 0, matchTempo: true, clips: [{ song: B, start: 0, end: 12, bpm: 100, anchor: { song: A, t: 10 }, gain: 0, fadeIn: 0, fadeOut: 0 }] };
  const ctx = { pieces: song, crossfade: 0, refs, tempo: 120 };
  const [p] = placeClips([L], song, 0, 120);
  assert.equal(p.speed, 1.2);
  assert.ok(Math.abs(p.length - 10) < 1e-9); // 12 s of the clip in 10 s
  // Cut 12-14 (2 s of result = 2.4 s of the clip) and close up.
  const [out] = cutLayer([L], 0, 12, 14, { ...ctx, closeUp: true });
  const placed = placeClips([out], song, 0, 120);
  assert.deepEqual(out.clips.map((c) => [c.start, c.end]), [[0, 2.46], [4.8, 12]]); // 2 s + the crossfade, then from 4.8 s
  assert.deepEqual(placed.map((q) => Math.round(q.at * 1000) / 1000), [10, 12]);
  // The song cut from 20 to 40 (two pieces of a.mp3): a clip at the song's 45 s is at 25 s; cutting 22-24
  // of the layer closes it up to start at 22, pinned back to the song's 42 s.
  const pieces = [{ src: "media:a.mp3", start: 0, end: 20 }, { src: "media:a.mp3", start: 40, end: 60 }];
  const M = { name: "M", gain: 0, clips: [{ song: B, start: 0, end: 5, anchor: { song: A, t: 45 }, gain: 0, fadeIn: 0, fadeOut: 0 }] };
  const [moved] = cutLayer([M], 0, 21, 23, { pieces, crossfade: 0, refs, closeUp: true });
  assert.deepEqual(moved.clips[0].anchor, { song: A, t: 43 });
  assert.deepEqual(placeClips([moved], pieces, 0).map((q) => q.at), [23]);
});

test("splicing a song into a layer moves the rest of that layer on, and nothing else", async () => {
  const { insertIntoLayer } = await import("../../haliday_show/app/halidayshow/static/js/layers.js");
  const refs = { "media:a.mp3": A };
  const clip = (t, s0, s1) => ({ song: B, start: s0, end: s1, anchor: { song: A, t }, gain: 0, fadeIn: 0, fadeOut: 0 });
  const layers = [{ name: "L", gain: 0, clips: [clip(0, 0, 10), clip(20, 0, 10), clip(52, 0, 6)] }, { name: "M", gain: 0, clips: [clip(30, 0, 1)] }];
  const add = { song: { source: "media", path: "c.mp3" }, start: 0, end: 4, gain: 0, fadeIn: 0, fadeOut: 0 };
  // 4 s spliced in at 5: the first clip's split there, everything after moves 4 s on; the last would
  // now run from 56, so it's kept, and the clip at 52 + 4 = 56 still fits a 60 s song.
  const { layers: out, dropped } = insertIntoLayer(layers, 0, 5, add, { pieces: song, crossfade: 0, refs });
  const at = placeClips(out, song, 0).filter((p) => p.layer === 0)
    .map((p) => [p.at, out[0].clips[p.clip].song.path, out[0].clips[p.clip].start, out[0].clips[p.clip].end]).sort((x, y) => x[0] - y[0]);
  assert.deepEqual(at, [[0, "b.mp3", 0, 5], [5, "c.mp3", 0, 4], [9, "b.mp3", 5, 10], [24, "b.mp3", 0, 10], [56, "b.mp3", 0, 6]]);
  assert.equal(dropped, 0);
  assert.equal(out[1], layers[1]);
  // 8 s more and the last clip would start past the song's end: it's left out.
  assert.equal(insertIntoLayer(layers, 0, 5, { ...add, end: 9 }, { pieces: song, crossfade: 0, refs }).dropped, 1);
});

test("loopLayer repeats a stretch of one layer and moves the rest on", async () => {
  const { loopLayer } = await import("../../haliday_show/app/halidayshow/static/js/layers.js");
  const refs = { "media:a.mp3": A };
  const clip = (t, s0, s1) => ({ song: B, start: s0, end: s1, anchor: { song: A, t }, gain: 0, fadeIn: 0, fadeOut: 0 });
  const layers = [{ name: "L", gain: 0, clips: [clip(0, 0, 10), clip(20, 0, 10)] }, { name: "M", gain: 0, clips: [clip(30, 0, 1)] }];
  // 4 to 12 twice: the first clip's 4 to 10 plays again from 12, the second clip moves 8 s on.
  const { layers: out, dropped } = loopLayer(layers, 0, 4, 12, 2, { pieces: song, crossfade: 0, refs });
  const at = placeClips(out, song, 0).filter((p) => p.layer === 0)
    .map((p) => [p.at, out[0].clips[p.clip].start, out[0].clips[p.clip].end]).sort((x, y) => x[0] - y[0]);
  assert.deepEqual(at, [[0, 0, 10], [12, 4, 10], [28, 0, 10]]);
  assert.equal(dropped, 0);
  assert.equal(out[1], layers[1]);
  // A clip across the end is split there; four times over, the copies past the song's end are left out.
  const r = loopLayer(layers, 0, 18, 25, 4, { pieces: song, crossfade: 0, refs });
  const at2 = placeClips(r.layers, song, 0).filter((p) => p.layer === 0)
    .map((p) => [p.at, r.layers[0].clips[p.clip].start, r.layers[0].clips[p.clip].end]).sort((x, y) => x[0] - y[0]);
  assert.deepEqual(at2, [[0, 0, 10], [20, 0, 5], [27, 0, 5], [34, 0, 5], [41, 0, 5], [46, 5, 10]]);
  assert.equal(r.dropped, 0);
  assert.equal(loopLayer(layers, 0, 18, 25, 8, { pieces: song, crossfade: 0, refs }).dropped > 0, true);
});
