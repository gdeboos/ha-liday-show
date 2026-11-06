import assert from "node:assert/strict";
import test from "node:test";

import { bake, newClip } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import { PHONES, colourAt, hasPhonesLane, mainColour, phoneCount, phonesJoin } from "../../haliday_show/app/halidayshow/static/js/phones.js";

const headerOf = (blob) => {
  const hlen = new DataView(blob.buffer).getUint32(5);
  return JSON.parse(new TextDecoder().decode(blob.subarray(9, 9 + hlen)));
};

test("the house's main colour: lit bulbs averaged, as bright as the brightest", () => {
  assert.deepEqual(mainColour([new Uint8Array([0, 0, 0, 0, 0, 0])]), [0, 0, 0]);
  // One bright red prop on a dark house: the phones are bright red.
  assert.deepEqual(mainColour([new Uint8Array([255, 0, 0]), new Uint8Array([0, 0, 0, 2, 2, 2])]), [255, 0, 0]);
  // Red and green half each: yellow, at the brightest bulb's level.
  assert.deepEqual(mainColour([new Uint8Array([200, 0, 0, 0, 200, 0])]), [200, 200, 0]);
  // A fade on every light fades the phones.
  assert.deepEqual(mainColour([new Uint8Array([0, 0, 50, 0, 0, 50])]), [0, 0, 50]);
});

test("each bake carries a colour for phones ten times a second", () => {
  const show = { duration: 2, tracks: [{ device: "a", clips: [{ ...newClip("solid", 0, 1), color: "#ff0000" }] }] };
  const h = headerOf(bake(show, { a: { segments: 3 } }, 40));
  assert.equal(h.phones.fps, 10);
  assert.equal(h.phones.colours.length, phoneCount(80, 40) * 6);
  assert.deepEqual(colourAt(h.phones.colours, 0.5), [255, 0, 0]);
  assert.deepEqual(colourAt(h.phones.colours, 1.5), [0, 0, 0]); // the clip has ended
  assert.deepEqual(colourAt(h.phones.colours, 9), [0, 0, 0]); // past the end
  assert.equal(h.frames, 80);
});

test("a Phones lane replaces the house colour, dark in its gaps, and is never a light", () => {
  const show = { duration: 2, tracks: [
    { device: "a", clips: [{ ...newClip("solid", 0, 2), color: "#ff0000" }] },
    { device: PHONES, clips: [{ ...newClip("solid", 1, 2), color: "#0000ff" }] },
  ] };
  assert.ok(hasPhonesLane(show));
  const h = headerOf(bake(show, { a: { segments: 3 }, [PHONES]: { segments: 1, phones: true } }, 40));
  assert.deepEqual(h.tracks, [{ device: "a", segments: 3 }]);
  assert.deepEqual(colourAt(h.phones.colours, 0.5), [0, 0, 0]);
  assert.deepEqual(colourAt(h.phones.colours, 1.5), [0, 0, 255]);
});

test("phones join a show while the switch is on, unless it stays out", () => {
  assert.equal(phonesJoin({}, false), false);
  assert.equal(phonesJoin({}, true), true);
  assert.equal(phonesJoin({ phones: false }, true), false);
});

test("House colour on a Phones lane shows the house's main colour, only there", async () => {
  const { EFFECTS } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const { laneTakes } = await import("../../haliday_show/app/halidayshow/static/js/matrix.js");
  const show = { duration: 2, tracks: [
    { device: "a", clips: [{ ...newClip("solid", 0, 2), color: "#00ff00" }] },
    { device: PHONES, clips: [newClip("housecolour", 0, 1), { ...newClip("solid", 1, 2), color: "#0000ff" }] },
  ] };
  const h = headerOf(bake(show, { a: { segments: 3 }, [PHONES]: { segments: 1, phones: true } }, 40));
  assert.deepEqual(colourAt(h.phones.colours, 0.5), [0, 255, 0]); // the house's colour
  assert.deepEqual(colourAt(h.phones.colours, 1.5), [0, 0, 255]); // designed by hand
  assert.ok(laneTakes("housecolour", EFFECTS.housecolour, "phones"));
  for (const lane of ["light", "group", "house", "matrix"]) assert.ok(!laneTakes("housecolour", EFFECTS.housecolour, lane));
  // A phone's screen is a matrix: light and matrix effects, Plasma and Spiral, but no whole-loop ones.
  assert.ok(laneTakes("solid", EFFECTS.solid, "phones") && laneTakes("plasma", EFFECTS.plasma, "phones"));
  assert.ok(laneTakes("fire2d", EFFECTS.fire2d, "phones") && laneTakes("picture", EFFECTS.picture, "phones"));
  assert.ok(!laneTakes("wled", EFFECTS.wled, "phones") && !laneTakes("sweep", EFFECTS.sweep, "phones"));
  // Phones draw the lane themselves, so the house's own colour comes too.
  assert.deepEqual(colourAt(h.phones.house, 1.5), [0, 255, 0]);
});


test("a phone's screen is the lane drawn as an upright matrix", async () => {
  const { phoneScreen } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const { PHONE_GRID } = await import("../../haliday_show/app/halidayshow/static/js/phones.js");
  const n = PHONE_GRID.w * PHONE_GRID.h;
  const red = phoneScreen([{ ...newClip("solid", 0, 1), color: "#ff0000" }], 0.5);
  assert.equal(red.length, n * 3);
  assert.deepEqual([...red.subarray(0, 3)], [255, 0, 0]);
  assert.deepEqual([...phoneScreen([newClip("housecolour", 0, 1)], 0.5, [1, 2, 200]).subarray(0, 3)], [1, 2, 200]);
  assert.deepEqual([...phoneScreen([{ ...newClip("solid", 0, 1), color: "#ff0000" }], 0.5, null, 0.5).subarray(0, 3)], [128, 0, 0]);
  assert.ok(phoneScreen([], 0.5).every((v) => v === 0)); // dark in the gaps
});

test("singing faces: each character draws, and the mouth follows the singer", async () => {
  const { CHARACTERS, faceColour, mouthFor } = await import("../../haliday_show/app/halidayshow/static/js/faces.js");
  const { EFFECTS, withVoiceLevels } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const { voiceBand } = await import("../../haliday_show/app/halidayshow/static/js/musiclevel.js");
  assert.equal(mouthFor(0), 0);
  assert.equal(mouthFor(1), 1);
  for (const c of CHARACTERS) {
    assert.ok(faceColour(c, 0.5, 0.5, 0), `${c} has a face in the middle`);
    assert.equal(faceColour(c, 0.01, 0.99, 0), null, `${c} leaves the corner for the background`);
  }
  // The snowman's mouth: shut, the middle of it is snow; open, it's dark.
  assert.deepEqual(faceColour("snowman", 0.5, 0.77, 0), faceColour("snowman", 0.5, 0.8, 0));
  assert.notDeepEqual(faceColour("snowman", 0.5, 0.77, 1), faceColour("snowman", 0.5, 0.77, 0));
  // Drawn on a phone's screen, louder singing opens the mouth wider (more dark dots).
  const { phoneScreen } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const clip = { ...newClip("singingface", 0, 4), character: "ghost", background: "#000000" };
  const dark = (level) => withVoiceLevels({ fps: 10, values: Array(40).fill(level) }, () => {
    const f = phoneScreen([clip], 1);
    let n = 0;
    for (let i = 0; i < f.length; i += 3) if (f[i] < 60 && f[i + 1] < 60 && f[i + 2] < 60) n++;
    return n;
  });
  assert.ok(dark(100) > dark(0) + 20);
  assert.ok(EFFECTS.singingface.grid);
  // The voice range keeps a singer and drops the bass.
  const r = 8000, bass = Float32Array.from({ length: r }, (_, i) => Math.sin(2 * Math.PI * 60 * i / r));
  const voice = Float32Array.from({ length: r }, (_, i) => Math.sin(2 * Math.PI * 1000 * i / r));
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  assert.ok(rms(voiceBand(voice, r)) > 10 * rms(voiceBand(bass, r)));
});

test("the singer's level: where the vocals are, when to measure again, and kept on undo", async () => {
  const { keepLevels, vocalsPlaces, voiceFits } = await import("../../haliday_show/app/halidayshow/static/js/musiclevel.js");
  assert.deepEqual(vocalsPlaces({ source: "media", path: "Xmas/Jingle: Bells.mp3" }, "Jingle: Bells (vocals).wav"), [
    { source: "media", path: "haliday_show/Jingle_ Bells (vocals).wav" },
    { source: "media", path: "Xmas/Jingle: Bells (vocals).wav" }]);
  const show = { audio: { path: "a.mp3" }, voice: { fps: 20, song: "a.mp3", values: [1], shapes: "m", from: "song", seconds: 100 } };
  assert.ok(voiceFits(show, "a.mp3", 100.2));
  assert.ok(!voiceFits(show, "a.mp3", 100.2, true)); // vocals split since: measure them
  assert.ok(!voiceFits(show, "a.mp3", 130)); // another file under the same name
  assert.ok(!voiceFits(show, "b.mp3", 100));
  assert.deepEqual(keepLevels(show, { audio: { path: "a.mp3" } }).voice, show.voice);
});

test("a Singing face later in the show follows the singer at that point in the song", async () => {
  const { phoneScreen, withVoiceLevels } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  // Quiet for the first 10 s, singing after.
  const voice = { fps: 10, values: [...Array(100).fill(0), ...Array(100).fill(100)] };
  const clip = { ...newClip("singingface", 12, 18), character: "ghost" };
  const dark = (time) => withVoiceLevels(voice, () => {
    const f = phoneScreen([clip], time);
    let n = 0;
    for (let i = 0; i < f.length; i += 3) if (f[i] < 60 && f[i + 1] < 60 && f[i + 2] < 60) n++;
    return n;
  });
  const shut = withVoiceLevels({ fps: 10, values: Array(200).fill(0) }, () => {
    const f = phoneScreen([clip], 13);
    let n = 0;
    for (let i = 0; i < f.length; i += 3) if (f[i] < 60 && f[i + 1] < 60 && f[i + 2] < 60) n++;
    return n;
  });
  assert.ok(dark(13) > shut + 20); // 13 s into the song: singing, so the mouth is open
});

test("mouth shapes from the voice, blinks and glances", async () => {
  const { voiceShapes } = await import("../../haliday_show/app/halidayshow/static/js/musiclevel.js");
  const { blinkAt, faceColour, lookAt } = await import("../../haliday_show/app/halidayshow/static/js/faces.js");
  const r = 16000, tone = (hz) => Float32Array.from({ length: r }, (_, i) => Math.sin(2 * Math.PI * hz * i / r));
  const shape = (hz) => voiceShapes(tone(hz), r, 20, Array(20).fill(80))[10];
  assert.equal(shape(300), "o"); // all low
  assert.equal(shape(800), "a"); // a high first formant
  assert.equal(shape(2500), "e"); // a high second formant
  assert.equal(voiceShapes(tone(800), r, 20, Array(20).fill(5))[10], "m"); // quiet: closed
  // An "oo" is narrower than an "ee", and "mm" is shut whatever the level.
  const wide = (shape) => { let n = 0; for (let u = 0; u <= 1; u += 0.01) if (faceColour("snowman", u, 0.72, { mouth: 1, shape }) && faceColour("snowman", u, 0.72, { mouth: 1, shape })[0] < 100) n++; return n; };
  assert.ok(wide("o") < wide("e"));
  assert.deepEqual(faceColour("snowman", 0.5, 0.78, { mouth: 1, shape: "m" }), faceColour("snowman", 0.5, 0.78, { mouth: 0 }));
  // A blink in every four seconds, and the eyes mostly ahead.
  const blinks = Array.from({ length: 400 }, (_, k) => blinkAt(k / 100)).filter((b) => b > 0.5).length;
  assert.ok(blinks > 0 && blinks < 20);
  assert.ok([-1, 0, 1].includes(lookAt(7.3)));
});

test("a quiet moment straight after a word, or quiet singing at high sensitivity, still shows an open mouth", async () => {
  const { phoneScreen, withVoiceLevels } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const dark = (voice, time, extra = {}) => withVoiceLevels(voice, () => {
    const f = phoneScreen([{ ...newClip("singingface", 0, 4), character: "ghost", life: "off", ...extra }], time);
    let n = 0;
    for (let i = 0; i < f.length; i += 3) if (f[i] < 60 && f[i + 1] < 60 && f[i + 2] < 60) n++;
    return n;
  });
  // Loud until 1 s (an "ah"), then quiet ("m"): 50 ms later the mouth is still open.
  const word = { fps: 20, values: [...Array(20).fill(100), ...Array(20).fill(0)], shapes: "a".repeat(20) + "m".repeat(20) };
  const shut = { fps: 20, values: Array(40).fill(0), shapes: "m".repeat(40) };
  assert.ok(dark(word, 1.05) > dark(shut, 1.05) + 20);
  // Quiet singing (level 10, marked "m"), at full sensitivity: open.
  const quiet = { fps: 20, values: Array(40).fill(10), shapes: "m".repeat(40) };
  assert.ok(dark(quiet, 1, { sensitivity: 100 }) > dark(shut, 1, { sensitivity: 100 }));
});

test("on a phone a Singing face is drawn finer, and everything else in blocks exactly as before", async () => {
  const { phoneView, phoneScreen, withVoiceLevels } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const { PHONE_GRID, PHONE_SHARP } = await import("../../haliday_show/app/halidayshow/static/js/phones.js");
  const fire = { ...newClip("fire2d", 0, 4) };
  const plain = phoneView([fire], 1);
  assert.deepEqual([plain.w, plain.h], [PHONE_GRID.w, PHONE_GRID.h]);
  const face = { ...newClip("singingface", 2, 4), character: "elf" };
  const fine = phoneView([fire, face], 1); // the fire is playing, the face is still to come
  assert.deepEqual([fine.w, fine.h], [PHONE_GRID.w * PHONE_SHARP, PHONE_GRID.h * PHONE_SHARP]);
  const coarse = phoneScreen([fire, face], 1);
  for (const [x, y] of [[0, 0], [20, 90], [53, 95], [27, 60]]) {
    for (const [dx, dy] of [[0, 0], [PHONE_SHARP - 1, PHONE_SHARP - 1]]) {
      const o = ((y * PHONE_SHARP + dy) * fine.w + x * PHONE_SHARP + dx) * 3, c = (y * PHONE_GRID.w + x) * 3;
      assert.deepEqual([...fine.frame.subarray(o, o + 3)], [...coarse.subarray(c, c + 3)]);
    }
  }
  // The face itself is drawn dot by dot: some of its 4 x 4 blocks aren't one colour.
  const voice = { fps: 10, values: Array(40).fill(80) };
  const sharp = withVoiceLevels(voice, () => phoneView([face], 3));
  let mixedBlocks = 0;
  for (let by = 0; by < PHONE_GRID.h; by++) for (let bx = 0; bx < PHONE_GRID.w; bx++) {
    const seen = new Set();
    for (let dy = 0; dy < PHONE_SHARP; dy++) for (let dx = 0; dx < PHONE_SHARP; dx++) {
      const o = ((by * PHONE_SHARP + dy) * sharp.w + bx * PHONE_SHARP + dx) * 3;
      seen.add(`${sharp.frame[o]},${sharp.frame[o + 1]},${sharp.frame[o + 2]}`);
    }
    if (seen.size > 1) mixedBlocks++;
  }
  assert.ok(mixedBlocks > 100);
  // Quick enough for a phone to draw many times a second.
  const t0 = performance.now();
  for (let k = 0; k < 10; k++) withVoiceLevels(voice, () => phoneView([face], 3 + k / 10));
  assert.ok((performance.now() - t0) / 10 < 60, "a frame in well under 60 ms");
});
