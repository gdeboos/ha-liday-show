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

test("a show's row names its season", () => {
  const seasons = [{ id: "halloween", name: "Halloween", out: true }];
  const [row] = showRows([{ id: "a", name: "Spooky", duration: 90, song: null, modified: 0, season: "halloween" }], null, new Date(), seasons);
  assert.match(row.details, /^Halloween · No song yet/);
  const [plain] = showRows([{ id: "b", name: "Any", duration: 90, song: null, modified: 0, season: "gone" }], null, new Date(), seasons);
  assert.match(plain.details, /^No song yet/);
});

test("the season filter keeps that season's shows and shows for any season", async () => {
  const { inSeasonFilter } = await import("../../haliday_show/app/halidayshow/static/js/showlist.js");
  const seasons = [{ id: "halloween", name: "Halloween" }, { id: "christmas", name: "Christmas" }];
  const shows = [{ id: "spooky", season: "halloween" }, { id: "xmas", season: "christmas" }, { id: "any" },
    { id: "gone", season: "easter" }]; // its season was deleted: any season again
  const pick = (f) => shows.filter((s) => inSeasonFilter(s, f, seasons)).map((s) => s.id);
  assert.deepEqual(pick("all"), ["spooky", "xmas", "any", "gone"]);
  assert.deepEqual(pick("christmas"), ["xmas", "any", "gone"]);
  assert.deepEqual(pick("halloween"), ["spooky", "any", "gone"]);
  assert.deepEqual(pick("easter"), ["spooky", "xmas", "any", "gone"]); // a filter for a deleted season shows all
});
