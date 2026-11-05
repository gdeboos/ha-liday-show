import assert from "node:assert/strict";
import test from "node:test";

import { SHAPES, barParts, fileName, ivfFrame, ivfHeader, titleAlpha, videoLayout } from "../../haliday_show/app/halidayshow/static/js/video.js";

const inside = (r, W, H) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;

test("landscape: the photo as big as fits above the bar", () => {
  const { width, height } = SHAPES.landscape;
  const l = videoLayout(width, height, 4 / 3);
  assert.ok(inside(l.photo, width, height) && inside(l.bar, width, height));
  assert.ok(l.photo.y + l.photo.h <= l.bar.y, "the photo stays above the bar");
  assert.ok(Math.abs(l.photo.w / l.photo.h - 4 / 3) < 0.01);
  assert.ok(Math.abs(l.photo.x + l.photo.w / 2 - width / 2) <= 1); // centred
});

test("upright: title above, photo in the middle, bar under it", () => {
  const { width, height } = SHAPES.upright;
  const l = videoLayout(width, height, 16 / 9);
  assert.equal(l.photo.w, width);
  assert.ok(l.title.y < l.photo.y && l.bar.y > l.photo.y + l.photo.h && inside(l.bar, width, height));
  assert.ok(l.upright);
});

test("the bar's sections and beats, for the part of the song in the video", () => {
  const show = { sections: [{ start: 0, end: 10, label: "Intro" }, { start: 10, end: 30, label: "Chorus", color: "#ff0000" },
    { start: 30, end: 40, label: "Outro" }], beats: [5, 15, 25, 35] };
  const { blocks, ticks } = barParts(show, 10, 20);
  assert.deepEqual(blocks.map((b) => [b.label, b.from, b.to, b.colour]), [["Chorus", 0, 1, "#ff0000"]]);
  assert.deepEqual(ticks, [0.25, 0.75]);
});

test("the title fades out, and file names are safe", () => {
  assert.equal(titleAlpha(0), 1);
  assert.ok(titleAlpha(3) > 0 && titleAlpha(3) < 1);
  assert.equal(titleAlpha(5), 0);
  assert.equal(fileName('Jingle: "Rock"/Bells'), "Jingle Rock Bells.mp4");
  assert.equal(fileName(""), "show.mp4");
});

test("IVF wrapping", () => {
  const h = ivfHeader(1920, 1080, 30, 90);
  assert.equal(h.length, 32);
  assert.equal(String.fromCharCode(...h.slice(0, 4)), "DKIF");
  assert.equal(String.fromCharCode(...h.slice(8, 12)), "VP90");
  const f = ivfFrame(new Uint8Array([1, 2, 3]), 7);
  assert.equal(f.length, 15);
  assert.equal(new DataView(f.buffer).getUint32(0, true), 3);
  assert.equal(new DataView(f.buffer).getUint32(4, true), 7);
});
