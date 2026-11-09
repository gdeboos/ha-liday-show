import { test } from "node:test";
import assert from "node:assert/strict";
import { SongMissing, SongServerError, fetchSong, plainError, retrying, songLoadMessage } from "../../haliday_show/app/halidayshow/static/js/songload.js";

const reply = (status) => async () => ({ status, ok: status < 400, arrayBuffer: async () => new ArrayBuffer(4) });

test("a song that's there comes back as bytes", async () => {
  assert.equal((await fetchSong("x", reply(200))).byteLength, 4);
});

test("a missing song says to pick it again", async () => {
  await assert.rejects(fetchSong("x", reply(404)), SongMissing);
  assert.match(songLoadMessage(new SongMissing()), /gone.*Pick it again under Song/);
});

test("a file the browser can't decode suggests MP3 or WAV", () => {
  const e = new Error("Unable to decode audio data");
  e.name = "EncodingError";
  assert.match(songLoadMessage(e), /can't play that file.*MP3 or WAV/);
});

test("anything else says HA-liday Show didn't answer", async () => {
  await assert.rejects(fetchSong("x", reply(502), { waits: [] }), SongServerError);
  assert.match(songLoadMessage(new TypeError("Failed to fetch")), /didn't answer/);
  assert.doesNotMatch(songLoadMessage(new TypeError("Failed to fetch")), /Failed to fetch/);
});

test("a dropped connection is tried again, and said plainly if it stays down", async () => {
  const slept = [], sleep = async (ms) => { slept.push(ms); };
  // Down for two tries (Wi-Fi blip, then the app restarting), then back.
  const answers = [() => { throw new TypeError("Failed to fetch"); }, () => ({ status: 502 }), () => ({ status: 200, ok: true, arrayBuffer: async () => new ArrayBuffer(2) })];
  let n = 0;
  const bytes = await fetchSong("x", async () => answers[n++](), { waits: [1, 2, 3], sleep });
  assert.equal(bytes.byteLength, 2);
  assert.deepEqual(slept, [1, 2]);
  // A real answer isn't tried again.
  let tries = 0;
  await assert.rejects(retrying(async () => { tries++; throw Object.assign(new Error("bad"), { status: 400 }); }, { waits: [1], sleep }));
  assert.equal(tries, 1);
  assert.match(plainError(new TypeError("Failed to fetch")), /lost touch with HA-liday Show/);
  assert.equal(plainError(new Error("too long")), "too long");
});

test("a download cut off part way carries on from where it got to", async () => {
  const body = (parts, fail) => ({ getReader() {
    let k = 0;
    return { read: async () => {
      if (k < parts.length) return { done: false, value: Uint8Array.from(parts[k++]) };
      if (fail) throw new TypeError("network error");
      return { done: true };
    } };
  } });
  const asked = [];
  const get = async (url, init) => {
    asked.push(init?.headers?.Range || "all");
    return asked.length === 1 ? { status: 200, ok: true, body: body([[1, 2], [3]], true) }
      : asked.length === 2 ? { status: 206, ok: true, body: body([[4], [5]], true) }
        : { status: 206, ok: true, body: body([[6]], false) };
  };
  const slept = [];
  const bytes = new Uint8Array(await fetchSong("x", get, { waits: [], sleep: async (ms) => slept.push(ms) }));
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(asked, ["all", "bytes=3-", "bytes=5-"]);
  assert.deepEqual(slept, [], "getting further each time needs no wait, so it isn't given up on");
  // A server that sends it all again instead starts afresh.
  let n = 0;
  const again = async () => (++n === 1 ? { status: 200, ok: true, body: body([[9]], true) } : { status: 200, ok: true, body: body([[1, 2]], false) });
  assert.deepEqual([...new Uint8Array(await fetchSong("x", again, { waits: [] }))], [1, 2]);
});
