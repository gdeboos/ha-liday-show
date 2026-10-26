import assert from "node:assert/strict";
import test from "node:test";
import { PART, parts, uploadSong } from "../../haliday_show/app/halidayshow/static/js/upload.js";

test("a song is split into pieces under Home Assistant's 16 MB limit", () => {
  assert.ok(PART < 16 * 1024 * 1024);
  assert.deepEqual(parts(0), [{ start: 0, end: 0, done: true }]);
  assert.deepEqual(parts(10, 4), [{ start: 0, end: 4, done: false }, { start: 4, end: 8, done: false }, { start: 8, end: 10, done: true }]);
  assert.deepEqual(parts(8, 4).map((p) => p.done), [false, true]);
});

test("a big song goes up in order, naming the file on the last piece", async () => {
  const calls = [];
  const api = async (path, opts) => { calls.push({ path, size: opts.body.size }); return path.includes("done=1") ? { source: "media", path: "x" } : {}; };
  const big = new Blob([new Uint8Array(PART * 2 + 5)]);
  const seen = [];
  const ref = await uploadSong(api, big, "Big Song.mp3", (f) => seen.push(f));
  assert.deepEqual(ref, { source: "media", path: "x" });
  assert.equal(calls.length, 3);
  assert.match(calls[0].path, /^api\/audio\/part\?upload=[0-9a-f]{24}&offset=0$/);
  assert.match(calls[2].path, new RegExp(`offset=${PART * 2}&done=1&name=Big\\+Song\\.mp3$`));
  assert.deepEqual(calls.map((c) => c.size), [PART, PART, 5]);
  assert.equal(seen.at(-1), 1);
  const small = []; // a small song goes in one go, as before
  await uploadSong(async (path, opts) => { small.push(path); return {}; }, new Blob([new Uint8Array(10)]), "a.mp3");
  assert.deepEqual(small, ["api/audio"]);
});
