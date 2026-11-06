import assert from "node:assert/strict";
import test from "node:test";

import { decodeGif } from "../../haliday_show/app/halidayshow/static/js/gif.js";
import { forgetPicture, frameAt, fromBase64, getPicture, keepPicture, shrinkPicture, toBase64 }
  from "../../haliday_show/app/halidayshow/static/js/pictures.js";

// A tiny GIF writer for the tests: no compression (a clear code before the code size would grow), so
// every pixel is its own code. frames: [{pixels: [palette index], delay (1/100 s), transparent?, disposal?}]
function gif(w, h, palette, frames) {
  const out = [..."GIF89a"].map((c) => c.charCodeAt(0));
  const u16 = (n) => [n & 255, n >> 8];
  out.push(...u16(w), ...u16(h), 0xf1, 0, 0); // global colour table of 4
  for (let i = 0; i < 4; i++) out.push(...(palette[i] || [0, 0, 0]));
  out.push(0x21, 0xff, 11, ..."NETSCAPE2.0".split("").map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  for (const f of frames) {
    const t = f.transparent !== undefined;
    out.push(0x21, 0xf9, 4, ((f.disposal || 0) << 2) | (t ? 1 : 0), ...u16(f.delay || 0), t ? f.transparent : 0, 0);
    out.push(0x2c, ...u16(0), ...u16(0), ...u16(w), ...u16(h), 0);
    const min = 2, clear = 4, end = 5;
    const codes = [clear];
    let free = clear + 2;
    for (const p of f.pixels) {
      if (free >= 7) { codes.push(clear); free = clear + 2; } // stay at 3-bit codes
      codes.push(p);
      if (codes[codes.length - 2] !== clear) free++;
    }
    codes.push(end);
    const bytes = [];
    let acc = 0, bits = 0;
    for (const c of codes) { acc |= c << bits; bits += 3; while (bits >= 8) { bytes.push(acc & 255); acc >>= 8; bits -= 8; } }
    if (bits) bytes.push(acc & 255);
    out.push(min);
    for (let i = 0; i < bytes.length; i += 255) out.push(Math.min(255, bytes.length - i), ...bytes.slice(i, i + 255));
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255];
const rgba = (data, i) => [...data.subarray(i * 4, i * 4 + 4)];

test("a GIF's frames are read with their delays, drawn over each other", () => {
  const g = gif(2, 2, [RED, GREEN, BLUE], [
    { pixels: [0, 1, 2, 0], delay: 10 },
    { pixels: [1, 3, 3, 1], delay: 25, transparent: 3 }, // see-through dots keep the frame below
  ]);
  const pic = decodeGif(g);
  assert.equal(pic.w, 2);
  assert.equal(pic.h, 2);
  assert.deepEqual(pic.delays, [100, 250]);
  assert.deepEqual(rgba(pic.frames[0], 1), [...GREEN, 255]);
  assert.deepEqual(rgba(pic.frames[1], 0), [...GREEN, 255]);
  assert.deepEqual(rgba(pic.frames[1], 1), [...GREEN, 255]); // still the first frame's green
  assert.deepEqual(rgba(pic.frames[1], 2), [...BLUE, 255]);
});

test("a frame cleared to the background leaves see-through dots, and a delay of 0 plays as 0.1 s", () => {
  const g = gif(2, 1, [RED, GREEN], [
    { pixels: [0, 0], delay: 0, disposal: 2 },
    { pixels: [3, 1], delay: 5, transparent: 3 },
  ]);
  const pic = decodeGif(g);
  assert.deepEqual(pic.delays, [100, 50]);
  assert.equal(rgba(pic.frames[1], 0)[3], 0);
  assert.deepEqual(rgba(pic.frames[1], 1), [...GREEN, 255]);
});

test("something that isn't a GIF is refused", () => {
  assert.throws(() => decodeGif(Uint8Array.from([1, 2, 3])), /GIF/);
});

test("pictures are shrunk to fit, averaging the dots they cover, and keep at most so many frames", () => {
  const w = 4, h = 2, frame = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) frame.set(i % 2 ? [0, 0, 0, 255] : [200, 100, 0, 255], i * 4);
  const small = shrinkPicture({ w, h, frames: [frame, frame, frame], delays: [100, 10, 100] }, 2, 2);
  assert.equal(small.w, 2);
  assert.equal(small.h, 1);
  assert.equal(small.frames.length, 2);
  assert.deepEqual(small.delays, [100, 20]); // at least 20 ms each
  assert.deepEqual(rgba(small.frames[0], 0), [100, 50, 0, 255]);
  // Already small enough: left as it is.
  assert.equal(shrinkPicture({ w: 2, h: 2, frames: [new Uint8ClampedArray(16)], delays: [100] }, 64, 120).w, 2);
});

test("frames go to the server and back as base64, and the effect finds the frame for any moment", () => {
  const data = Uint8ClampedArray.from([1, 2, 3, 4, 250, 251, 252, 253]);
  assert.deepEqual([...fromBase64(toBase64(data))], [...data]);
  keepPicture("p1", { name: "Star", w: 1, h: 2, frames: [toBase64(data), toBase64(data.map((v) => 255 - v))], delays: [100, 300] });
  const pic = getPicture("p1");
  assert.equal(pic.frames.length, 2);
  assert.equal(frameAt(pic, 0.05), 0);
  assert.equal(frameAt(pic, 0.2), 1);
  assert.equal(frameAt(pic, 0.45), 0); // round again after 0.4 s
  assert.equal(frameAt(pic, 0.15, 50), 0); // at half speed, 0.15 s in is still the first frame
  assert.equal(frameAt(pic, 0.15), 1);
  forgetPicture("p1");
  assert.equal(getPicture("p1"), undefined);
});

// A real animated GIF (made by Pillow: compressed, interlaced, 3 frames of 20 x 12) and a weighted sum
// of each frame's colours, worked out from the frames Pillow drew.
const REAL = "R0lGODlhFAAMAIQAAP/IAMbaymLw8wbwhOmYo9B2rP1vhLSO+qmOeHma34iRP5utBUK98l6gvVOnNUS7MU12TRBl0PctsMU0irhGwaEKwIZPFZoPiU0KlkQeqh8KvTwWFwMnNwcgUQAAKAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACAAAACwAAAAAFAAMAAAIYQA9CBxIsODACwYTGhwg0IAHABAVJoRIMaJCAQIdcKhoUeLDig0oeqAw8MDAAh8xcARAcIPADgMhSlg5cELBBwJXAljgMYKGlQw8WBhYwUOAgRliQlTggcBACAk8KkSQMCAAIfkEAQwAHwAsAAAAABQADACE/8gA1tESZdwZLPqhA/nMCtMb68IWpKpym7iHmcE1k650YaFdf4nYJLPFH7RxQ55xKKxvK7BCp1/e3nEQinM9rkCBPVeZPVd62z9Bwihbkj19ZgL0PxkjpQAcAAAoAAAACHcAPwj48IEDwYMIPwz4kMEDwgMELySc6KHCB4ceMn4AQADAwQ0QKGZ0SFACgJMJSXpgMPLgSZQBEibwYEBjAwwfIrz0SPLixZYId6o8aKGDxqAvETqgQHAB0I1JJ0544EHD0Z0AEGA82HOkhwIofyqYSBZhT4QBAQAh+QQBFAAeACwAAAAAFAAMAIT/yADW9WnW6wl/6Ml401Jd2C4x/vcX73UO9iXLs9b1w2a4eqSmXCf3T83AWwwbvv6hdpcSglaIb50jb4LAN6OGPu2ERl/HFi+ZLRJfRYh6NjNCDqYNOvYAACgAAAAAAAAIcwA9dPAgkKDBgwUZIBxYkCAHhAQdMCRowAOEAR0GAtjYIQBEghcyWpi4ceNBBRMzZjRYEoDBgQUIquyQ4GBLhAQEZtxAUADBmx4erNQ5lOXGDENTqiRYAaiGlQwXqMTwUwIClx8NTlhZciJCClkPNEAYISAAOw==";

test("a GIF made by another program reads dot for dot", () => {
  const pic = decodeGif(Uint8Array.from(atob(REAL), (c) => c.charCodeAt(0)));
  assert.deepEqual([pic.w, pic.h, pic.delays], [20, 12, [80, 120, 200]]);
  const sum = (f) => { let s = 0; for (let i = 0; i < 240; i++) s += (f[i * 4] + f[i * 4 + 1] + f[i * 4 + 2]) * (i + 1); return s; };
  assert.deepEqual(pic.frames.map(sum), [5451221, 5102275, 5267503]);
});

test("damaged, enormous or endless GIFs are refused with a message, never a hang", () => {
  const ok = gif(1, 1, [RED], [{ pixels: [0] }]);
  const withCodeSize = (n) => { const g = ok.slice(); g[g.indexOf(0x2c) + 10] = n; return g; };
  assert.throws(() => decodeGif(withCodeSize(30)), /damaged/);
  const huge = ok.slice(); huge.set([255, 255, 255, 255], 6);
  assert.throws(() => decodeGif(huge), /too big/);
  const empty = ok.slice(); empty.set([0, 0], 6);
  assert.throws(() => decodeGif(empty), /damaged/);
  assert.throws(() => decodeGif(ok.slice(0, 20)), /cut short|damaged/);
  // Thousands of frames: only the first ones are kept.
  const many = gif(1, 1, [RED], Array.from({ length: 600 }, () => ({ pixels: [0] })));
  assert.equal(decodeGif(many).frames.length, 500);
});

test("a long GIF's phone copy loses every other frame, each kept one showing for both", async () => {
  const { halveFrames } = await import("../../haliday_show/app/halidayshow/static/js/pictures.js");
  assert.deepEqual(halveFrames(["a", "b", "c"], [100, 50, 70]), { frames: ["a", "c"], delays: [150, 70] });
  assert.deepEqual(halveFrames(["a", "b"], [9000, 5000]).delays, [10000]);
});

test("on a phone's sharp grid the Picture effect uses the phone copy, and scrolls at the same pace", async () => {
  const { keepPicture, forgetPicture, getPicture, phoneKey, pictureList, allPictures } = await import("../../haliday_show/app/halidayshow/static/js/pictures.js");
  const { phoneView, phoneScreen } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const one = (c) => btoa(String.fromCharCode(...c));
  keepPicture("psharp", { name: "Dot", w: 1, h: 1, frames: [one([255, 0, 0, 255])], delays: [100] });
  keepPicture(phoneKey("psharp"), { name: "Dot", w: 1, h: 1, frames: [one([0, 0, 255, 255])], delays: [100] });
  assert.deepEqual(pictureList().map((p) => p.id), ["psharp"]); // the phone copy isn't one of your pictures
  assert.ok(allPictures().every(([id]) => id === "psharp"));
  const clip = { effect: "picture", start: 0, end: 10, picture: "psharp", fit: "stretch", move: "still", speed: 4, animate: 100, background: "#000000" };
  const fine = phoneView([clip], 1), coarse = phoneScreen([clip], 1);
  assert.deepEqual([...fine.frame.subarray(0, 3)], [0, 0, 255]);
  assert.deepEqual([...coarse.subarray(0, 3)], [255, 0, 0]);
  // Scrolling: after 1 s at 4 dots a second, the fine grid has moved 4 x 4 of its own dots.
  keepPicture(phoneKey("psharp"), { name: "Dot", w: 2, h: 1, frames: [one([0, 0, 255, 255, 0, 255, 0, 255])], delays: [100] });
  const edge = (v, w) => { // first non-background column across the middle
    const o = 192 * w * 3;
    for (let x = 0; x < w; x++) if (v[o + x * 3] || v[o + x * 3 + 1] || v[o + x * 3 + 2]) return x;
    return -1;
  };
  const scroll = { ...clip, fit: "fit", move: "scroll left" };
  const a = phoneView([scroll], 1), b = phoneView([scroll], 2);
  assert.equal(edge(a.frame, a.w) - edge(b.frame, b.w), 16);
  forgetPicture("psharp");
  assert.equal(getPicture(phoneKey("psharp")), undefined);
});
