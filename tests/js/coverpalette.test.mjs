import assert from "node:assert/strict";
import test from "node:test";

import { colourful, coverPalette, forLights, songPaletteName, songPaletteNow } from "../../haliday_show/app/halidayshow/static/js/coverpalette.js";

// A cover made of blocks: [[r, g, b], share of the pixels]…
function cover(blocks, n = 4000) {
  const out = new Uint8ClampedArray(n * 4);
  let i = 0;
  for (const [[r, g, b], share] of blocks) {
    for (let k = 0; k < Math.round(n * share) && i < n; k++, i++) out.set([r, g, b, 255], i * 4);
  }
  return out;
}
const hue = (h) => {
  const [r, g, b] = [1, 3, 5].map((n) => parseInt(h.slice(n, n + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return -1;
  let x = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  x *= 60;
  return x < 0 ? x + 360 : x;
};

test("black, greys and whites aren't colours for lights", () => {
  assert.equal(colourful([0, 0, 0]), false);
  assert.equal(colourful([128, 128, 128]), false);
  assert.equal(colourful([250, 250, 245]), false);
  assert.equal(colourful([180, 30, 30]), true);
});

test("a dull colour is made vivid but keeps its hue", () => {
  const [r, g, b] = forLights([90, 40, 40]); // a dark, muted red
  assert.ok(r > 200 && g < 90 && b < 90);
});

test("a cover's main colours, biggest first, without the black background", () => {
  const p = coverPalette(cover([[[0, 0, 0], 0.5], [[200, 20, 30], 0.3], [[20, 120, 40], 0.15], [[240, 200, 40], 0.05]]));
  assert.equal(p.length, 3);
  assert.ok(hue(p[0]) < 15 || hue(p[0]) > 345, `red first, got ${p[0]}`);
  assert.ok(Math.abs(hue(p[1]) - 130) < 25, `green second, got ${p[1]}`);
  assert.ok(Math.abs(hue(p[2]) - 50) < 15, `yellow third, got ${p[2]}`);
});

test("shades of one colour count once", () => {
  const p = coverPalette(cover([[[200, 20, 30], 0.4], [[120, 10, 20], 0.3], [[30, 60, 200], 0.3]]));
  assert.equal(p.length, 2);
});

test("a black-and-white cover gives no palette", () => {
  assert.equal(coverPalette(cover([[[0, 0, 0], 0.6], [[255, 255, 255], 0.3], [[120, 120, 120], 0.1]])), null);
  assert.equal(coverPalette(new Uint8ClampedArray(0)), null);
});

test("never more than asked for", () => {
  const blocks = [0, 50, 100, 150, 200, 250, 300].map((h, k) => [[[255, 0, 0], [255, 200, 0], [0, 255, 0], [0, 255, 200], [0, 80, 255], [160, 0, 255], [255, 0, 160]][k], 1 / 7]);
  assert.ok(coverPalette(cover(blocks), { max: 4 }).length <= 4);
});

test("names come from the song and are made unique", () => {
  assert.equal(songPaletteName("Wham! - Last Christmas.mp3", []), "Wham! - Last Christmas");
  assert.equal(songPaletteName("jingle_bells.wav", ["jingle bells"]), "jingle bells 2");
});

test("a song's palette follows your palette of that name, else its own copy", () => {
  const saved = { name: "Jingle", colors: ["#ff0000"], from: "cover" };
  assert.deepEqual(songPaletteNow(saved, [{ name: "Jingle", colors: ["#00ff00"] }]).colors, ["#00ff00"]);
  assert.deepEqual(songPaletteNow(saved, []).colors, ["#ff0000"]);
  assert.equal(songPaletteNow(null, []), null);
});
