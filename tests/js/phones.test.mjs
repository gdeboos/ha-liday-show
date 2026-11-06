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
  const show = { audio: { path: "a.mp3" }, voice: { fps: 20, song: "a.mp3", values: [1], from: "song", seconds: 100 } };
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
