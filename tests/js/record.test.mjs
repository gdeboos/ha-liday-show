import { test } from "node:test";
import assert from "node:assert/strict";
import { canRecord, coverRect, recClock, extOf, fileName, frameSize, pickMime } from "../../haliday_show/app/halidayshow/static/public/record.js";

test("MP4 where the phone can make it, else WebM", () => {
  assert.equal(pickMime((m) => m === "video/mp4"), "video/mp4");
  assert.equal(pickMime((m) => m.startsWith("video/webm")), "video/webm;codecs=vp9,opus");
  assert.equal(pickMime(() => { throw new Error("old browser"); }), "");
  assert.equal(extOf("video/mp4;codecs=avc1"), "mp4");
  assert.equal(extOf("video/webm"), "webm");
});

test("the file is named after the page's title and the time", () => {
  const when = new Date(2026, 10, 17, 18, 5);
  assert.equal(fileName("🎄 Northampton Close Lights", when, "video/mp4"), "northampton-close-lights-2026-11-17-1805.mp4");
  assert.equal(fileName("🎄", when, "video/webm"), "light-show-2026-11-17-1805.webm");
});

test("the camera fills the frame without stretching", () => {
  assert.deepEqual(coverRect(1920, 1080, 1080, 1920), { sx: 656.25, sy: 0, sw: 607.5, sh: 1080 });
  assert.deepEqual(coverRect(1080, 1920, 1080, 1920), { sx: 0, sy: 0, sw: 1080, sh: 1920 });
  assert.deepEqual(frameSize(1920, 1080), { w: 1280, h: 720 });
  assert.deepEqual(frameSize(720, 1280), { w: 720, h: 1280 });
  assert.deepEqual(frameSize(0, 0), { w: 720, h: 1280 });
});

test("the clock, and only phones that can record get the button", () => {
  assert.equal(recClock(65.4), "1:05");
  assert.equal(canRecord({ isSecureContext: false }), false);
  const ok = { isSecureContext: true, MediaRecorder: class {}, navigator: { mediaDevices: { getUserMedia() {} } },
    HTMLCanvasElement: { prototype: { captureStream() {} } } };
  assert.equal(canRecord(ok), true);
  assert.equal(canRecord({ ...ok, MediaRecorder: undefined }), false);
});
