import assert from "node:assert/strict";
import test from "node:test";

import { EFFECTS, HOUSE, applyHouse, bake, composeLight, newClip, renderTrack } from "../../haliday_show/app/halidayshow/static/js/effects.js";

const px = (buf, i) => [...buf.subarray(i * 3, i * 3 + 3)];

test("every effect renders valid bytes across a clip", () => {
  for (const key of Object.keys(EFFECTS)) {
    const clip = newClip(key, 1, 3);
    for (let t = 1; t < 3; t += 0.1) {
      const out = renderTrack([clip], t, 12);
      assert.equal(out.length, 36);
      for (const v of out) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${key} produced ${v}`);
    }
  }
});

test("segments outside clips are black and later clips win", () => {
  const red = { ...newClip("solid", 0, 2), color: "#ff0000" };
  const blue = { ...newClip("solid", 1, 2), color: "#0000ff" };
  assert.deepEqual(px(renderTrack([red, blue], 0.5, 1), 0), [255, 0, 0]);
  assert.deepEqual(px(renderTrack([red, blue], 1.5, 1), 0), [0, 0, 255]);
  assert.deepEqual(px(renderTrack([red, blue], 2.5, 1), 0), [0, 0, 0]);
});

test("fade interpolates and wipe fills in order", () => {
  const fade = { ...newClip("fade", 0, 2), from: "#000000", to: "#ff0000" };
  assert.deepEqual(px(renderTrack([fade], 1, 1), 0), [128, 0, 0]);
  const wipe = { ...newClip("wipe", 0, 4), color: "#ffffff", background: "#000000" };
  const half = renderTrack([wipe], 2, 4);
  assert.deepEqual([px(half, 0), px(half, 1), px(half, 2), px(half, 3)],
    [[255, 255, 255], [255, 255, 255], [0, 0, 0], [0, 0, 0]]);
});

test("two and three colours split the light or alternate along it", () => {
  const colours = (buf, n) => Array.from({ length: n }, (_, i) => px(buf, i)[0]);
  const duo = { ...newClip("duo", 0, 1), color: "#010000", color2: "#020000" };
  assert.deepEqual(colours(renderTrack([duo], 0, 4), 4), [1, 1, 2, 2]);
  const trio = { ...newClip("trio", 0, 1), color: "#010000", color2: "#020000", color3: "#030000" };
  assert.deepEqual(colours(renderTrack([trio], 0, 7), 7), [1, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual(colours(renderTrack([{ ...trio, layout: "alternate", size: 2 }], 0, 7), 7), [1, 1, 2, 2, 3, 3, 1]);
});

test("two and three colours move along the light as a marquee", () => {
  const colours = (buf, n) => Array.from({ length: n }, (_, i) => px(buf, i)[0]);
  const duo = { ...newClip("duo", 0, 2), color: "#010000", color2: "#020000", layout: "alternate", speed: 1 };
  assert.deepEqual(colours(renderTrack([duo], 0, 4), 4), [1, 2, 1, 2]);
  assert.deepEqual(colours(renderTrack([duo], 1, 4), 4), [2, 1, 2, 1]);
});

test("pulse, gradient and colour cycle blend between their colours", () => {
  const pulse = { ...newClip("pulse", 0, 2), color: "#ff0000", background: "#000000", rate: 1 };
  assert.deepEqual(px(renderTrack([pulse], 0, 1), 0), [0, 0, 0]);
  assert.deepEqual(px(renderTrack([pulse], 0.5, 1), 0), [255, 0, 0]);
  const grad = { ...newClip("gradient", 0, 2), color: "#000000", color2: "#ff0000", count: "2" };
  const g = renderTrack([grad], 0, 3);
  assert.deepEqual([px(g, 0)[0], px(g, 1)[0], px(g, 2)[0]], [0, 128, 255]);
  const cycle = { ...newClip("cycle", 0, 4), color: "#010000", color2: "#020000", count: "2", blend: "step" };
  assert.deepEqual([0.5, 1.5, 2.5].map((t) => px(renderTrack([cycle], t, 1), 0)[0]), [1, 2, 1]);
});

test("comet has a fading tail and scanner bounces between the ends", () => {
  const comet = { ...newClip("comet", 0, 2), color: "#ff0000", background: "#000000", length: 2, speed: 0.25 };
  const c = renderTrack([comet], 1, 8); // head at segment 2
  assert.deepEqual([px(c, 2)[0], px(c, 1)[0], px(c, 0)[0], px(c, 3)[0]], [255, 128, 0, 0]);
  const scan = { ...newClip("scanner", 0, 5), color: "#ff0000", width: 1, speed: 0.5 };
  assert.equal(px(renderTrack([scan], 0, 5), 0)[0], 255);
  assert.equal(px(renderTrack([scan], 2, 5), 4)[0], 255);
  assert.equal(px(renderTrack([scan], 4, 5), 0)[0], 255);
});

test("lightning strikes at roughly its rate and is otherwise the background", () => {
  const clip = { ...newClip("lightning", 0, 1000), rate: 1 };
  let strikes = 0;
  for (let t = 0; t < 1000; t += 0.1) if (px(renderTrack([clip], t + 0.001, 1), 0)[0] > 200) strikes++;
  assert.ok(strikes > 800 && strikes < 1200, `${strikes} strikes in 1000 s`);
  assert.deepEqual(px(renderTrack([clip], 0.099, 1), 0).slice(0, 2), [0, 0]);
});

test("twinkle is deterministic so bakes are repeatable", () => {
  const clip = newClip("twinkle", 0, 10);
  assert.deepEqual(renderTrack([clip], 3.3, 20), renderTrack([clip], 3.3, 20));
});

test("bake writes the GVSF layout the player reads", () => {
  const show = { duration: 1, tracks: [
    { device: "a", clips: [{ ...newClip("solid", 0, 1), color: "#010203" }] },
    { device: "gone", clips: [] },
  ] };
  const blob = bake(show, { a: { segments: 2 } }, 10);
  assert.equal(new TextDecoder().decode(blob.subarray(0, 4)), "GVSF");
  const hlen = new DataView(blob.buffer).getUint32(5);
  const header = JSON.parse(new TextDecoder().decode(blob.subarray(9, 9 + hlen)));
  assert.deepEqual(header, { fps: 10, frames: 10, tracks: [{ device: "a", segments: 2 }] });
  assert.equal(blob.length, 9 + hlen + 10 * 6);
  assert.deepEqual([...blob.subarray(9 + hlen, 9 + hlen + 6)], [1, 2, 3, 1, 2, 3]);
});

test("every effect has a brightness slider that scales its output", () => {
  for (const key of Object.keys(EFFECTS)) {
    assert.equal(EFFECTS[key].params.filter((p) => p.key === "brightness").length, 1, key);
  }
  const clip = { ...newClip("solid", 0, 1), color: "#ff8000", brightness: 50 };
  assert.deepEqual(px(renderTrack([clip], 0.5, 1), 0), [128, 64, 0]);
  // An older rainbow clip saved with its own brightness keeps that level.
  const rainbow = { ...newClip("rainbow", 0, 1), speed: 0, brightness: 40 };
  assert.deepEqual(px(renderTrack([rainbow], 0, 4), 0), [102, 0, 0]);
});

test("House effects colour each segment by where it is on the house", () => {
  // Three segments at the left, middle and right of the house; one off the photo.
  const pos = [[0, 0.5], [0.5, 0.5], [1, 0.5], null];
  const at = (clip, time) => {
    const out = new Uint8Array(12).fill(9); // the light's own colour, 9 9 9
    return [0, 1, 2, 3].map((i) => px(applyHouse([clip], time, pos, out), i));
  };
  // A wipe from the left just past halfway: left and middle lit, right still background.
  const wipe = { ...newClip("housewipe", 0, 2), color: "#ff0000", soft: 0.01 };
  assert.deepEqual(at(wipe, 1.1), [[255, 0, 0], [255, 0, 0], [0, 0, 0], [9, 9, 9]]);
  // Wiping over the lights' own effects leaves them where the wipe hasn't reached.
  assert.deepEqual(at({ ...wipe, outside: "lights' own effects" }, 0.6)[2], [9, 9, 9]);
  // A sweep's band crosses from left to right, so the middle is lit mid-clip and the ends aren't.
  const sweep = { ...newClip("sweep", 0, 2), width: 0.2 };
  const mid = at(sweep, 1);
  assert.deepEqual(mid[1], [255, 255, 255]);
  assert.deepEqual(mid[0], [0, 0, 0]);
  assert.deepEqual(mid[2], [0, 0, 0]);
  // Right to left reaches the right end first.
  assert.ok(at({ ...sweep, direction: "right to left" }, 0.4)[2][0] > at(sweep, 0.4)[2][0]);
});

test("House effects only go on the House lane and show as a strip elsewhere", () => {
  for (const key of ["sweep", "housewipe", "wave"]) {
    assert.ok(EFFECTS[key].house, key);
    const buf = renderTrack([newClip(key, 0, 2)], 1, 10);
    assert.ok(buf.every((v) => v >= 0 && v <= 255), key);
  }
});

test("the bake lays the House lane over every light with a position", () => {
  const show = { duration: 1, tracks: [
    { device: HOUSE, clips: [{ ...newClip("housewipe", 0, 1), color: "#00ff00", soft: 0.01 }] },
    { device: "a", clips: [{ ...newClip("solid", 0, 1), color: "#0000ff" }] },
    { device: "b", clips: [{ ...newClip("solid", 0, 1), color: "#0000ff" }] },
  ] };
  const devices = { a: { segments: 2 }, b: { segments: 1 } };
  // a's first segment is at the far left, its second off the photo; b isn't traced.
  const blob = bake(show, devices, 10, { a: [[0, 0], null] });
  const hlen = new DataView(blob.buffer).getUint32(5);
  const header = JSON.parse(new TextDecoder().decode(blob.subarray(9, 9 + hlen)));
  assert.deepEqual(header.tracks.map((t) => t.device), ["a", "b"]);
  const frame5 = blob.subarray(9 + hlen + 5 * 9, 9 + hlen + 6 * 9);
  assert.deepEqual([...frame5], [0, 255, 0, 0, 0, 255, 0, 0, 255]);
});

test("presets only name settings their effect has, and keep the clip's colours", async () => {
  const { PRESETS, presetParams, matchesPreset } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  for (const [key, presets] of Object.entries(PRESETS)) {
    const keys = new Set(EFFECTS[key].params.map((p) => p.key));
    for (const preset of presets) for (const k of Object.keys(preset.params)) assert.ok(keys.has(k), `${key}: ${k}`);
  }
  const clip = { ...newClip("trio", 0, 2), color: "#123456" };
  const marquee = PRESETS.trio.find((p) => p.label === "Slow marquee");
  Object.assign(clip, presetParams(marquee, clip));
  assert.equal(clip.color, "#123456");
  assert.equal(clip.layout, "alternate");
  assert.ok(matchesPreset(marquee, clip));
  const fade = { ...newClip("fade", 0, 2), from: "#000000", to: "#ff0000" };
  Object.assign(fade, presetParams(PRESETS.fade.find((p) => p.label === "Fade out"), fade));
  assert.deepEqual([fade.from, fade.to], ["#ff0000", "#000000"]);
});

test("a light split into parts bakes as one light, with unused segments off", () => {
  const roof = { id: "roof", segments: 10, parts: [{ id: "a", from: 2, to: 4 }, { id: "b", from: 7, to: 8 }] };
  const devices = {
    roof,
    "roof#a": { id: "roof#a", parent: "roof", from: 2, to: 4, segments: 3 },
    "roof#b": { id: "roof#b", parent: "roof", from: 7, to: 8, segments: 2 },
  };
  const solid = (color, start = 0, end = 1) => ({ ...newClip("solid", start, end), color });
  const show = { duration: 1, tracks: [
    { device: "roof", clips: [solid("#ffffff")] }, // all parts at once
    { device: "roof#a", clips: [solid("#ff0000", 0.5, 1)] }, // wins on its part from 0.5 s
    { device: "roof#b", clips: [solid("#0000ff")] },
  ] };
  const blob = bake(show, devices, 10);
  const hlen = new DataView(blob.buffer).getUint32(5);
  const header = JSON.parse(new TextDecoder().decode(blob.subarray(9, 9 + hlen)));
  assert.deepEqual(header.tracks, [{ device: "roof", segments: 10 }]);
  const frameAt = (f) => {
    const frame = [...blob.subarray(9 + hlen + f * 30, 9 + hlen + (f + 1) * 30)];
    return (i) => frame.slice(i * 3, i * 3 + 3);
  };
  const white = [255, 255, 255], red = [255, 0, 0], blue = [0, 0, 255], off = [0, 0, 0];
  let seg = frameAt(0);
  assert.deepEqual([seg(0), seg(1), seg(3), seg(4), seg(5), seg(6), seg(7), seg(9)], [off, white, white, off, off, blue, blue, off]);
  seg = frameAt(6);
  assert.deepEqual([seg(0), seg(1), seg(2), seg(3), seg(4), seg(6), seg(9)], [off, red, red, red, off, blue, off]);
});

test("the whole of a split light runs across its parts joined together", () => {
  const roof = { id: "roof", segments: 6, parts: [{ id: "a", from: 1, to: 2 }, { id: "b", from: 5, to: 6 }] };
  const ramp = { ...newClip("gradient", 0, 1), color: "#ff0000", color2: "#0000ff", count: "2" };
  const out = composeLight(roof, (id) => (id === "roof" ? { clips: [ramp] } : undefined), 0);
  const rgb = (i) => [...out.slice(i * 3, i * 3 + 3)];
  assert.deepEqual([rgb(2), rgb(3)], [[0, 0, 0], [0, 0, 0]]);
  assert.deepEqual(rgb(0).slice(0, 1), [255]); // starts red
  assert.equal(rgb(5)[2] > rgb(5)[0], true); // ends blue, with no gap where 3 and 4 are skipped
});

test("a split light played as parts only ignores its own track", () => {
  const roof = { id: "roof", segments: 4, whole: false, parts: [{ id: "a", from: 1, to: 2 }] };
  const white = { ...newClip("solid", 0, 1), color: "#ffffff" };
  const out = composeLight(roof, (id) => (id === "roof" ? { clips: [white] } : undefined), 0);
  assert.deepEqual([...out], Array(12).fill(0));
});

test("a group lane runs a light effect along its lights as one strip, over their own effects", async () => {
  const { GROUP, planGroups } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const a = { id: "a", segments: 4 }, b = { id: "b", segments: 6, parts: [{ id: "p", from: 1, to: 3 }, { id: "q", from: 4, to: 6 }] };
  const red = { ...newClip("solid", 0, 10), color: "#ff0000" };
  const wipe = { ...newClip("wipe", 0, 10), color: "#00ff00", background: "#000000" };
  const tracks = new Map([["a", { clips: [red] }], [`${GROUP}g`, { clips: [wipe] }]]);
  const trackOf = (id) => tracks.get(id);
  const plans = planGroups([{ id: "g", members: ["a", "b#q"] }], [a, b], trackOf);
  assert.equal(plans[0].total, 7);
  // Half way through, the wipe has filled the first half of the 7-segment strip: a's 4 and nothing of b.
  const fa = composeLight(a, trackOf, 5, {}, [], undefined, plans);
  const fb = composeLight(b, trackOf, 5, {}, [], undefined, plans);
  const green = (f, i) => f[i * 3 + 1] > 200;
  assert.deepEqual([0, 1, 2].map((i) => green(fa, i)), [true, true, true]);
  assert.equal(fa[0], 0, "the group's clip wins over the light's own red while it runs");
  assert.ok(!green(fb, 0) && !green(fb, 2), "part p isn't in the group");
  // Before and after the group's clip, the light's own effect shows.
  const plans2 = planGroups([{ id: "g", members: ["a"] }], [a, b], (id) => (id === `${GROUP}g` ? { clips: [{ ...wipe, start: 6, end: 8 }] } : trackOf(id)));
  assert.equal(composeLight(a, trackOf, 2, {}, [], undefined, plans2)[0], 255);
});

test("House effects on a group lane are measured across just the group's lights", async () => {
  const { GROUP, planGroups } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const a = { id: "a", segments: 2 }, b = { id: "b", segments: 2 };
  // a sits on the left of the group, b on the right, both in the left half of the house.
  const positions = { a: [[0.1, 0.5], [0.15, 0.5]], b: [[0.35, 0.5], [0.4, 0.5]] };
  const fill = { ...newClip("housewipe", 0, 10), color: "#0000ff", background: "#000000", soft: 0 };
  const trackOf = (id) => (id === `${GROUP}g` ? { clips: [fill] } : null);
  const plans = planGroups([{ id: "g", members: ["a", "b"] }], [a, b], trackOf, positions);
  // Over the whole house the wipe would reach b by about 40%; across the group it's half way at 5 s.
  const fa = composeLight(a, trackOf, 5.5, positions, [], undefined, plans);
  const fb = composeLight(b, trackOf, 5.5, positions, [], undefined, plans);
  assert.ok(fa[2] > 200 && fa[5] > 200);
  assert.ok(fb[2] < 50, "b, on the group's right, isn't filled yet");
});

test("bake plays group lanes and leaves them out of the lights", async () => {
  const { GROUP } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const show = { duration: 1, tracks: [{ device: `${GROUP}g`, clips: [{ ...newClip("solid", 0, 1), color: "#00ff00" }] }, { device: "a", clips: [] }] };
  const out = bake(show, { a: { segments: 2 } }, 2, {}, [{ id: "g", members: ["a"] }]);
  const len = new DataView(out.buffer).getUint32(5);
  const header = JSON.parse(new TextDecoder().decode(out.subarray(9, 9 + len)));
  assert.deepEqual(header.tracks.map((t) => t.device), ["a"]);
  assert.equal(out[9 + len + 1], 255);
});

test("WLED-style shapes: heartbeat, twin scanner and sparkly tail", async () => {
  const { PRESETS, matchesPreset } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const at = (clip, t, n, i) => EFFECTS[clip.effect].render({ ...newClip(clip.effect, 0, 9), ...clip }, t, 9, n, i);
  // Heartbeat: full at the first beat, a softer second beat, dark in between and before the next.
  const beat = { effect: "pulse", color: "#ff0000", rate: 1, shape: "heartbeat" };
  assert.equal(Math.round(at(beat, 0, 1, 0)[0]), 255);
  const second = at(beat, 0.21, 1, 0)[0];
  assert.ok(second > 120 && second < 230, String(second));
  assert.ok(at(beat, 0.6, 1, 0)[0] < 5);
  // Twin scanner: mirrored, so the ends match.
  const twin = { effect: "scanner", eyes: "two", width: 2, speed: 0.3 };
  for (const t of [0, 0.4, 1.1]) for (let i = 0; i < 20; i++) assert.deepEqual(at(twin, t, 20, i).map(Math.round), at(twin, t, 20, 19 - i).map(Math.round));
  // Sparkly tail: the head stays full, the tail never brighter than a smooth one, and the same twice.
  const smooth = { effect: "comet", length: 6, speed: 0.1 }, sparkly = { ...smooth, trail: "sparkly" };
  for (let i = 0; i < 30; i++) {
    assert.ok(at(sparkly, 2, 30, i)[0] <= at(smooth, 2, 30, i)[0] + 1e-9);
    assert.deepEqual(at(sparkly, 2, 30, i), at(sparkly, 2, 30, i));
  }
  // A clip saved before Shape existed still counts as Steady beat.
  const old = { effect: "pulse", start: 0, end: 1, color: "#ff0000", background: "#000000", rate: 1.2, brightness: 100 };
  assert.ok(matchesPreset(PRESETS.pulse.find((p) => p.label === "Steady beat"), old));
  assert.ok(!matchesPreset(PRESETS.pulse.find((p) => p.label === "Heartbeat"), old));
});

test("festive effects: eyes come in pairs, drips stay on their icicle, snow moves", () => {
  const frame = (clip, t, n) => [...renderTrack([{ ...newClip(clip.effect, 0, 60), ...clip }], t, n)];
  const lit = (buf, n) => Array.from({ length: n }, (_, i) => buf[i * 3] + buf[i * 3 + 1] + buf[i * 3 + 2] > 30);
  // One pair of 1-segment eyes, 2 apart: whenever any segment is lit, exactly two are, 3 apart.
  for (let t = 0; t < 30; t += 0.37) {
    const on = lit(frame({ effect: "eyes", pairs: 1, size: 1, gap: 2 }, t, 40), 40).flatMap((v, i) => (v ? [i] : []));
    assert.ok(on.length === 0 || (on.length === 2 && on[1] - on[0] === 3), `${t}: ${on}`);
  }
  // Drips on 10-segment icicles: the first segment of each icicle swells on its own timetable.
  const tops = new Set();
  for (let t = 0; t < 20; t += 0.25) {
    const on = lit(frame({ effect: "drip", length: 10, rate: 0.5 }, t, 50), 50);
    tops.add([0, 10, 20, 30, 40].map((i) => on[i]).join());
  }
  assert.ok(tops.size > 3);
  // Snow: the bright (near) flakes at t are those of a second before, moved on by its speed.
  const bright = (buf) => Array.from({ length: 200 }, (_, i) => buf[i * 3] > 200);
  const a = bright(frame({ effect: "snow", density: 30, speed: 10, length: 1 }, 1, 200));
  const b = bright(frame({ effect: "snow", density: 30, speed: 10, length: 1 }, 2, 200));
  assert.ok(a.some(Boolean));
  for (let i = 0; i + 10 < 200; i++) if (a[i]) assert.ok(b[i + 10] || b[i + 9] || b[i + 11], String(i));
  // Fireworks and candles are the same every time they're rendered.
  for (const effect of ["fireworks", "candles", "eyes", "drip", "snow"]) {
    assert.deepEqual(frame({ effect }, 3.3, 60), frame({ effect }, 3.3, 60), effect);
  }
});

test("every effect has a heading in the effect window", async () => {
  const { EFFECT_GROUPS } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const keys = new Set(EFFECT_GROUPS.map(([g]) => g));
  for (const [key, fx] of Object.entries(EFFECTS)) {
    assert.ok(keys.has(fx.group), key);
    assert.equal(fx.group === "house", !!fx.house, key);
  }
});

test("colour lists: a palette fills the list, extra colours are hidden, calm effects stay in their colours", async () => {
  const { unusedColour } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const { applyPalette } = await import("../../haliday_show/app/halidayshow/static/js/palettes.js");
  const { BLOCK_EFFECTS } = await import("../../haliday_show/app/halidayshow/static/js/playlisteditor.js");
  const fairy = newClip("fairy", 0, 10);
  applyPalette(fairy, ["#111111", "#222222", "#333333"]);
  assert.equal(fairy.count, "3");
  assert.deepEqual([fairy.color, fairy.color2, fairy.color3], ["#111111", "#222222", "#333333"]);
  assert.ok(!unusedColour("fairy", "color3", fairy) && unusedColour("fairy", "color4", fairy));
  assert.ok(!unusedColour("cycle", "color4", { count: "2" })); // older effects show every box, as before
  applyPalette(fairy, Array(12).fill("#123456"));
  assert.equal(fairy.count, "8");
  // Fairy lights in turn: segment i takes colour i mod count (when lit).
  const lit = { ...newClip("fairy", 0, 10), count: "2", color: "#ff0000", color2: "#00ff00", density: 100 };
  const f = renderTrack([lit], 5, 4);
  assert.deepEqual([...f], [255, 0, 0, 0, 255, 0, 255, 0, 0, 0, 255, 0]);
  // Ocean only ever shows blends of its own colours: here two greys, so r = g = b.
  const sea = { ...newClip("ocean", 0, 10), count: "2", color: "#000000", color2: "#ffffff" };
  for (const t of [0, 1.7, 4.2]) {
    const o = renderTrack([sea], t, 30);
    for (let i = 0; i < 30; i++) assert.ok(o[i * 3] === o[i * 3 + 1] && o[i * 3 + 1] === o[i * 3 + 2]);
  }
  // Sunrise: dark at the start, daylight at the end; Sunset the other way round.
  const sun = { ...newClip("sunrise", 0, 60), spread: 0 };
  assert.deepEqual([...renderTrack([sun], 0, 1)], [0, 0, 0]);
  assert.deepEqual([...renderTrack([sun], 59.99, 1)].map((v) => v > 200), [true, true, true]);
  assert.deepEqual([...renderTrack([{ ...sun, way: "sunset" }], 59.99, 1)].map((v) => v < 5), [true, true, true]);
  // Effects that play once across their length aren't offered as looping blocks.
  for (const k of ["fade", "wipe", "sunrise"]) assert.ok(!BLOCK_EFFECTS.includes(k), k);
  for (const k of ["fairy", "ocean", "aurora", "flow"]) assert.ok(BLOCK_EFFECTS.includes(k), k);
});

test("colour lists in scenes: changing effect carries the colours in use and how many", async () => {
  const { changeEffect, sceneColours } = await import("../../haliday_show/app/halidayshow/static/js/housescenes.js");
  const { usedColourKeys } = await import("../../haliday_show/app/halidayshow/static/js/palettes.js");
  assert.deepEqual(usedColourKeys("fairy", { count: "3" }), ["color", "color2", "color3"]);
  assert.deepEqual(usedColourKeys("cycle", { count: "2" }), ["color", "color2", "color3", "color4"]);
  const trio = { effect: "trio", params: { color: "#111111", color2: "#222222", color3: "#333333" } };
  const fairy = changeEffect(trio, "fairy");
  assert.equal(fairy.params.count, "3");
  assert.deepEqual([fairy.params.color, fairy.params.color3], ["#111111", "#333333"]);
  // A two-colour fairy look doesn't pass on its hidden third colour.
  const back = changeEffect({ effect: "fairy", params: { count: "2", color: "#111111", color2: "#222222", color3: "#999999" } }, "trio");
  assert.equal(back.params.color3, undefined);
  assert.deepEqual(sceneColours({ all: { effect: "fairy", params: { count: "2", color: "#111111", color2: "#222222", color3: "#999999" } } }, []),
    ["#111111", "#222222"]);
});

test("movement effects: theatre spacing, fill level, stacking blocks, and early events", () => {
  const frame = (clip, t, n) => [...renderTrack([{ ...newClip(clip.effect, 0, 10), ...clip }], t, n)];
  const on = (buf, n) => Array.from({ length: n }, (_, i) => buf[i * 3] + buf[i * 3 + 1] + buf[i * 3 + 2] > 0);
  // Theatre chase: one lit in every 3, stepping along.
  const a = on(frame({ effect: "theatre", every: 3, speed: 1 }, 0.5, 9), 9);
  assert.deepEqual(a, [true, false, false, true, false, false, true, false, false]);
  assert.deepEqual(on(frame({ effect: "theatre", every: 3, speed: 1 }, 1.5, 9), 9), [false, true, false, false, true, false, false, true, false]);
  // Fill to a level: half the light lit halfway through a 0 to 100% clip.
  const half = on(frame({ effect: "level", from: 0, to: 100, soft: 0 }, 5, 10), 10);
  assert.equal(half.filter(Boolean).length, 5);
  assert.ok(half[0] && !half[9]);
  // Stacking blocks: 5 blocks of 2 at 5 a second take a second; just before then, 4 have landed.
  const fall = 1;
  const full = on(frame({ effect: "tetris", size: 2, rate: 5 }, fall - 0.01, 10), 10);
  assert.ok(full.slice(0, 8).every(Boolean), String(full));
  // Effects built on random events render from the very start of a clip.
  for (const effect of ["bounce", "ripple", "fireworks", "drip", "juggle", "dissolve", "lighthouse"]) {
    for (const t of [0, 0.01, 0.5]) frame({ effect, style: "popcorn" }, t, 30);
  }
});

test("xLights-style effects: morph, shockwave, curtain and pinwheel", () => {
  const at = (key, t, u, v, extra = {}) => EFFECTS[key].renderAt({ ...newClip(key, 0, 4), ...extra }, t, 4, u, v);
  // Shockwave: the ring passes the centre first, then further out.
  const lum = (c) => (c ? c[0] : 0);
  assert.ok(lum(at("shockwave", 0.05, 0.5, 0.5)) > lum(at("shockwave", 0.05, 0.9, 0.5)));
  assert.ok(lum(at("shockwave", 2.5, 0.95, 0.5)) > lum(at("shockwave", 2.5, 0.5, 0.5)));
  // Curtain opening: closed across the house at the start, open in the middle at the end.
  assert.ok(lum(at("curtain", 0, 0.4, 0.5)) > 100);
  assert.ok(lum(at("curtain", 3.99, 0.5, 0.5)) < 5);
  assert.ok(lum(at("curtain", 3.99, 0.4, 0.5, { way: "closing" })) > 100);
  // Pinwheel with even arms: opposite points are in step (arm or gap together).
  for (const [u, v] of [[0.8, 0.5], [0.6, 0.9], [0.3, 0.2]]) {
    assert.equal(lum(at("pinwheel", 1.3, u, v, { arms: 4 })) > 128, lum(at("pinwheel", 1.3, 1 - u, 1 - v, { arms: 4 })) > 128);
  }
  // Morph: halfway through, the head is at the far end and the tail just leaving the start.
  const morph = [...renderTrack([newClip("morph", 0, 10)], 5, 10)];
  assert.ok(morph[9 * 3] > 200 && morph[0] < 100);
});

test("transitions: fade in from dark, crossfade between clips back to back, wipe and dissolve", async () => {
  const { transitionAt, laneCover } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const red = { ...newClip("solid", 0, 4), color: "#ff0000" }, blue = { ...newClip("solid", 4, 8), color: "#0000ff" };
  // No transitions: as before.
  assert.deepEqual([...renderTrack([red, blue], 4.1, 1)], [0, 0, 255]);
  // Fade in over 2 s from dark: halfway at 1 s.
  const fadeIn = { ...red, transIn: "fade", transInSecs: 2 };
  assert.deepEqual([...renderTrack([fadeIn], 1, 1)], [128, 0, 0]);
  // Back to back, the second's In crossfades from the first: half red, half blue, no dark dip.
  const cross = [red, { ...blue, transIn: "fade", transInSecs: 2 }];
  assert.deepEqual([...renderTrack(cross, 5, 1)], [128, 0, 128]);
  // Only an Out on the first: it crossfades into the second before the second starts.
  const out = [{ ...red, transOut: "fade", transOutSecs: 2 }, blue];
  assert.deepEqual([...renderTrack(out, 3, 1)], [128, 0, 128]);
  // ...but not when the second has its own In (that In is the crossfade).
  assert.equal(transitionAt([{ ...red, transOut: "fade", transOutSecs: 2 }, cross[1]], { ...red, transOut: "fade", transOutSecs: 2 }, 3), null);
  // Out to dark with nothing after.
  assert.deepEqual([...renderTrack([{ ...red, transOut: "fade", transOutSecs: 2 }], 3, 1)], [128, 0, 0]);
  // Wipe in: the start of the light first.
  const wipe = renderTrack([{ ...red, transIn: "wipe", transInSecs: 2 }], 1, 10);
  assert.ok(wipe[0] === 255 && wipe[27] === 0);
  // Dissolve in: some segments fully on, some off, halfway through.
  const dis = renderTrack([{ ...red, transIn: "dissolve", transInSecs: 2 }], 1, 40);
  const on = Array.from({ length: 40 }, (_, i) => dis[i * 3]);
  assert.ok(on.filter((v) => v === 255).length > 5 && on.filter((v) => v === 0).length > 5);
  // In and Out longer than the clip share it.
  assert.ok(transitionAt([], { ...red, transIn: "fade", transInSecs: 10, transOut: "fade", transOutSecs: 10 }, 1.9).u < 1);
  // A lane clip fading in covers the lights underneath only partly.
  const cover = laneCover([fadeIn], 1, 3);
  assert.ok(cover && Math.abs(cover[0] - 0.5) < 0.01);
  assert.equal(laneCover([red], 1, 3), null);
});

test("a group lane clip fading in shows the light's own effect underneath", async () => {
  const { planGroups, GROUP } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const light = { id: "a", segments: 2 };
  const tracks = new Map([
    ["a", { device: "a", clips: [{ ...newClip("solid", 0, 4), color: "#0000ff" }] }],
    [GROUP + "g", { device: GROUP + "g", clips: [{ ...newClip("solid", 0, 4), color: "#ff0000", transIn: "fade", transInSecs: 2 }] }],
  ]);
  const plans = planGroups([{ id: "g", members: ["a"] }], [light], (id) => tracks.get(id));
  const f = [...composeLight(light, (id) => tracks.get(id), 1, {}, [], undefined, plans)];
  assert.deepEqual(f.slice(0, 3), [128, 0, 128]);
});

test("every effect gives real colours just outside its clip, for crossfades", async () => {
  const { clipPiece } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  for (const [key, fx] of Object.entries(EFFECTS)) {
    const p = { ...newClip(key, 2, 6) };
    for (const t of [-1, -0.01, 4.01, 5]) {
      for (let i = 0; i < 12; i++) {
        const c = fx.house ? (fx.renderAt(p, t, 4, i / 11, 0.5) || [0, 0, 0]) : fx.render(p, t, 4, 12, i);
        assert.ok(c.every(Number.isFinite), `${key} at ${t}`);
      }
    }
  }
  // Cutting a clip: each piece keeps only the transition on its uncut edge.
  const c = { ...newClip("solid", 0, 10), transIn: "fade", transInSecs: 1, transOut: "wipe", transOutSecs: 2 };
  const left = clipPiece(c, 0, 4), right = clipPiece(c, 6, 10);
  assert.deepEqual([left.transIn, left.transOut, right.transIn, right.transOut], ["fade", undefined, undefined, "wipe"]);
});

test("value curves: settings change over the clip, and speeding up never jumps back", async () => {
  const { curvedSettings } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  // Brightness from 100 to 0, steady: half way, half bright.
  const dim = { ...newClip("solid", 0, 10), color: "#ff0000", curves: { brightness: { to: 0, shape: "steady" } } };
  assert.deepEqual([...renderTrack([dim], 5, 1)], [128, 0, 0]);
  // Up and back: at the far value in the middle, back at the start value at the end.
  const [mid] = curvedSettings({ size: 2, curves: { size: { to: 10, shape: "up and back" } } }, 5, 10);
  const [end] = curvedSettings({ size: 2, curves: { size: { to: 10, shape: "up and back" } } }, 9.999, 10);
  assert.equal(mid.size, 10);
  assert.ok(Math.abs(end.size - 2) < 0.01);
  // A speed from 1 to 3 over 10 s: the clock runs by the running total (1*t + t*t/10), drawn at speed 1.
  const p = { speed: 1, curves: { speed: { to: 3, shape: "steady" } } };
  for (const t of [0, 2.5, 5, 10]) {
    const [q, at] = curvedSettings(p, t, 10);
    assert.equal(q.speed, 1);
    assert.ok(Math.abs(at - (t + (t * t) / 10)) < 1e-6, String(t));
  }
  let last = -1;
  for (let t = 0; t <= 10; t += 0.1) { const [, at] = curvedSettings({ ...p, curves: { speed: { to: 3, shape: "up and back" } } }, t, 10); assert.ok(at >= last); last = at; }
  // Without curves, nothing changes.
  const plain = { speed: 2 };
  assert.deepEqual(curvedSettings(plain, 3, 10), [plain, 3]);
});
