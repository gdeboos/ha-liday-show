import test from "node:test";
import assert from "node:assert/strict";
import { isPorted, wledFrame } from "../../haliday_show/app/halidayshow/static/js/wled-effects/index.js";
import { MODES } from "../../haliday_show/app/halidayshow/static/js/wled-effects/effects.js";
import {
  beatsin8_t, ColorFromPalette, gamma32, gradientPalette, random8, setSeed, sin16_t, sin8_t,
} from "../../haliday_show/app/halidayshow/static/js/wled-effects/engine.js";
import { GRADIENTS } from "../../haliday_show/app/halidayshow/static/js/wled-effects/palettes.js";

const look = (fx, more = {}) => ({ fx, speed: 128, intensity: 128, palette: 0, color: "#ff0000", color2: "#000000", color3: "#0000ff", ...more });
const frames = (p, n, seconds, step = 0.05) => {
  const out = [];
  for (let t = 0; t < seconds; t += step) out.push(Array.from(wledFrame(p, t, n)));
  return out;
};

test("WLED's maths matches its C code at known points", () => {
  assert.equal(sin16_t(0), 0);
  assert.equal(sin16_t(0x4000), 32766); // the C version truncates too
  assert.equal(sin16_t(0xC000), -32766);
  assert.equal(sin8_t(0), 128);
  assert.equal(sin8_t(64), 255);
  setSeed(1337);
  assert.equal(random8(), (((1337 * 2053 + 13849) & 0xFF) + (((1337 * 2053 + 13849) & 0xFFFF) >> 8)) & 0xFF);
  // A range with a negative lowest wraps as WLED's uint8_t does (Plasma uses -64..64).
  for (let t = 0; t < 10000; t += 137) assert.ok(beatsin8_t(6, -64, 64) <= 255);
});

test("palettes come out as FastLED builds them", () => {
  assert.equal(GRADIENTS.length, 58);
  const fire = gradientPalette(GRADIENTS[35 - 13]);
  assert.equal(fire.length, 16);
  assert.deepEqual(fire[0], [0, 0, 0]); // WLED's "Fire" starts black
  assert.deepEqual(ColorFromPalette([[255, 0, 0], ...Array(15).fill([0, 0, 255])], 0), [255, 0, 0]);
});

test("a solid colour previews as the colour picked, and gradient palettes as WLED sends them", () => {
  assert.deepEqual(Array.from(wledFrame(look(0, { color: "#ff8000" }), 1, 3)), [255, 128, 0, 255, 128, 0, 255, 128, 0]);
  assert.notEqual(gamma32(0xFF8000), 0xFF8000); // what the WLED itself would send for that colour
  // Rainbow on WLED's "Fire" palette at speed 0: the palette's own values, not brightened.
  const fire = gradientPalette(GRADIENTS[35 - 13]);
  const f = Array.from(wledFrame(look(9, { palette: 35, speed: 0 }), 0, 16));
  assert.deepEqual(f.slice(0, 3), ColorFromPalette(fire, 0, 255, true));
});

test("every ported effect runs, moves and stays in range", () => {
  const still = [0, 65, 83, 84, 85]; // Solid, Palette (unrotated), Solid Pattern, Solid Pattern Tri, Spots
  for (const fx of Object.keys(MODES).map(Number)) {
    for (const palette of [0, 11]) { // on Default, the noise effects are one colour, as on the WLED
      const run = frames(look(fx, { palette }), 40, 20, 0.1); // Traffic Light changes every 13 s at this speed
      for (const f of run) assert.ok(f.every((v) => Number.isInteger(v) && v >= 0 && v <= 255), `effect ${fx}`);
      const moving = new Set(run.map((f) => f.join())).size;
      if (palette === 11 && !still.includes(fx)) assert.ok(moving > 1, `effect ${fx} should move`);
    }
  }
});

test("Perlin noise matches FastLED's, as the WLED computes it", async () => {
  const { inoise8, inoise16 } = await import("../../haliday_show/app/halidayshow/static/js/wled-effects/noise.js");
  // x, y, z, then inoise16(x, y, z), (x, y), (x), inoise8(x, y, z), (x, y), (x): from FastLED 3.6's noise.cpp built in C
  const known = [
    [1103527590, 2524885223, 662824084, 45454, 36810, 34444, 112, 144, 170],
    [3295386429, 4182499122, 2516284547, 38675, 36944, 31204, 56, 110, 84],
    [3655513600, 2633739833, 3210001534, 48470, 31206, 38510, 126, 144, 128],
    [267834847, 180171308, 836760821, 30265, 23422, 29516, 108, 124, 144],
    [595337866, 2937909499, 2111915288, 45194, 31649, 25064, 130, 192, 128],
    [3297241969, 3791773014, 3535774167, 38608, 40260, 31238, 198, 172, 116],
    [3794901700, 3823029677, 3914758370, 16819, 28945, 31908, 154, 66, 170],
    [2473755763, 1343201072, 675780521, 25427, 18329, 25618, 138, 206, 30],
    [744964398, 1969681615, 1116175964, 47308, 21454, 16928, 142, 144, 176],
    [3008955749, 1303003706, 3834121963, 41526, 42280, 35306, 212, 58, 164],
    [4147913800, 4015624929, 4008331270, 28618, 18450, 35744, 128, 166, 96],
    [1448521415, 3776134388, 3397090333, 50196, 32227, 47424, 162, 118, 146]
  ];
  for (const [x, y, z, ...want] of known) {
    assert.deepEqual([inoise16(x, y, z), inoise16(x, y), inoise16(x), inoise8(x, y, z), inoise8(x, y), inoise8(x)], want);
  }
});

test("effects that set their own pace are drawn when WLED would draw them", () => {
  // ICU looks about, then holds its gaze for 1-3 seconds (it asks WLED to wait before drawing it again).
  const run = frames(look(58), 30, 12, 0.05);
  let longest = 0, still = 0;
  for (let k = 1; k < run.length; k++) {
    still = run[k].join() === run[k - 1].join() ? still + 1 : 0;
    longest = Math.max(longest, still);
  }
  assert.ok(longest * 50 >= 900, `ICU held still for ${longest * 50} ms at most`);
  assert.equal(isPorted(58), true);
});

test("the same moment always looks the same, going back in time included", () => {
  const p = look(66); // Fire 2012: random and stateful
  const a = Array.from(wledFrame(p, 3, 30));
  wledFrame(p, 5, 30);
  assert.deepEqual(Array.from(wledFrame(p, 3, 30)), a);
  // Far ahead (scrubbing a long scene) is quick, and still lit.
  const far = Array.from(wledFrame(p, 600, 30));
  assert.ok(far.some((v) => v > 0));
});

test("effects not ported yet drift through their colours", () => {
  assert.equal(isPorted(0), true);
  assert.equal(isPorted(150), false);
  const run = frames(look(150, { color: "#ff0000", color2: "#00ff00" }), 20, 4, 0.5);
  assert.ok(new Set(run.map((f) => f.join())).size > 1);
});

test("the preview uses each effect's own extras, as the WLED loads them (fxdef)", async () => {
  const { Segment } = await import("../../haliday_show/app/halidayshow/static/js/wled-effects/engine.js");
  const scanner = new Segment(10, { mode: 40 });
  assert.equal(scanner.custom1, 0); // no pause at the ends
  const palette = new Segment(10, { mode: 65 });
  assert.deepEqual([palette.custom1, palette.check1, palette.check2, palette.check3], [0, true, false, true]);
  const plain = new Segment(10, { mode: 2 });
  assert.deepEqual([plain.custom1, plain.custom2, plain.custom3, plain.check1], [128, 128, 16, false]);
  // Palette now shows its colours along the light, moving.
  const p = look(65, { palette: 11 });
  const f = Array.from(wledFrame(p, 1, 20));
  assert.ok(new Set([0, 5, 10, 15].map((i) => f.slice(i * 3, i * 3 + 3).join())).size > 1);
  assert.notDeepEqual(Array.from(wledFrame(p, 4, 20)), f);
});
