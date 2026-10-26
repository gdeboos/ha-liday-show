import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRows, songKey, songRows } from "../../haliday_show/app/halidayshow/static/js/songlist.js";

const songs = [
  { source: "media", path: "haliday_show/jingle-bells.mp3", detected: true, tempo: 120.1, sections: 5 },
  { source: "media", path: "Carols/away in a manger.wav", detected: false, tempo: null, sections: 0 },
  { source: "media", path: "haliday_show/beat-free.mp3", detected: true, tempo: null, sections: 1 },
];
const shows = [
  { id: "a", name: "Xmas 1", song: "haliday_show/jingle-bells.mp3" },
  { id: "b", name: "Advent", song: "haliday_show/jingle-bells.mp3" },
  { id: "c", name: "Empty", song: null },
];

test("rows are by name and say what Detect found and which shows use each song", () => {
  const rows = songRows(songs, shows);
  assert.deepEqual(rows.map((r) => r.name), ["away in a manger", "beat-free", "jingle-bells"]);
  const [manger, free, bells] = rows;
  assert.equal(manger.found, "not detected yet");
  assert.equal(manger.folder, "Carols");
  assert.equal(manger.uses, "Not used by any show");
  assert.equal(free.found, "no steady beat, 1 section");
  assert.equal(bells.found, "120 BPM, 5 sections");
  assert.equal(bells.uses, "Used by Advent, Xmas 1");
  assert.equal(bells.key, songKey(bells.ref));
});

test("filtering matches the file, its folder and the shows using it", () => {
  const rows = songRows(songs, shows);
  assert.deepEqual(filterRows(rows, "carols").map((r) => r.name), ["away in a manger"]);
  assert.deepEqual(filterRows(rows, "xmas").map((r) => r.name), ["jingle-bells"]);
  assert.deepEqual(filterRows(rows, "jingle MP3").map((r) => r.name), ["jingle-bells"]);
  assert.equal(filterRows(rows, "  ").length, 3);
});
