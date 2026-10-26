import { test } from "node:test";
import assert from "node:assert/strict";
import { changed, copyName, length, showRows } from "../../haliday_show/app/halidayshow/static/js/showlist.js";

const now = new Date(2026, 9, 26, 9, 0);
const at = (...a) => new Date(...a).getTime() / 1000;

test("rows put the newest change first and mark the last one edited", () => {
  const rows = showRows([
    { id: "old", name: "Halloween", duration: 95, song: "spooky/thriller.mp3", modified: at(2025, 9, 31, 20, 0) },
    { id: "xmas", name: "Xmas 1", duration: 104.2, song: "jingle-bells.mp3", modified: at(2026, 9, 26, 7, 14) },
    { id: "new", name: "Untitled", duration: 0, song: null, modified: at(2026, 9, 25, 17, 30) },
  ], "xmas", now);
  assert.deepEqual(rows.map((r) => r.id), ["xmas", "new", "old"]);
  assert.equal(rows[0].last, true);
  assert.equal(rows[0].details, "jingle-bells · 1:44 · changed today 07:14");
  assert.equal(rows[1].details, "No song yet · 0:00 · changed yesterday 17:30");
  assert.equal(rows[2].details, "thriller · 1:35 · changed 31 Oct 2025");
});

test("changes in the last hour say how long ago", () => {
  assert.equal(changed(now.getTime() / 1000 - 20, now), "just now");
  assert.equal(changed(now.getTime() / 1000 - 60, now), "1 minute ago");
  assert.equal(changed(now.getTime() / 1000 - 45 * 60, now), "45 minutes ago");
  assert.equal(changed(at(2026, 8, 12, 10, 0), now), "12 Sep");
});

test("lengths are minutes and seconds", () => {
  assert.equal(length(0), "0:00");
  assert.equal(length(61.6), "1:02");
});

test("a copy gets a name nobody has", () => {
  assert.equal(copyName("Xmas", ["Xmas"]), "Xmas copy");
  assert.equal(copyName("Xmas", ["Xmas", "xmas copy"]), "Xmas copy 2");
  assert.equal(copyName("Xmas copy", ["Xmas", "Xmas copy", "Xmas copy 2"]), "Xmas copy 3");
});
