import test from "node:test";
import assert from "node:assert/strict";
import { familyCount, filterFamilies, shortName, songFamilies, songRows } from "../../haliday_show/app/halidayshow/static/js/songlist.js";

const song = (path) => ({ source: "media", path, detected: true, tempo: 100, sections: 2, own: true });
const AM = "haliday_show/Arctic Monkeys - Dancefloor.mp3", SHORT = "haliday_show/Arctic Monkeys - Dancefloor _ SHORT.wav";
const rows = songRows([song(AM), song(SHORT), song("haliday_show/carol.mp3"), song("haliday_show/carol (edit).wav"),
  song("haliday_show/Jingle.mp3")], [{ name: "Xmas 1", song: "haliday_show/carol (edit).wav" }]);
const ref = (path) => ({ source: "media", path });
const drafts = [
  { id: "short", name: "SHORT", base: ref(AM), made: ref(SHORT), modified: 5 },
  { id: "party", name: "Party mix", base: ref(AM), made: null },
  { id: "gone", name: "Lost", base: ref("haliday_show/gone.mp3"), made: null },
];

test("edits and drafts sit under the song they were made from", () => {
  const fams = songFamilies(rows, drafts);
  assert.deepEqual(fams.map((f) => f.original.name), ["Arctic Monkeys - Dancefloor", "carol", "Jingle"]);
  const am = fams[0];
  assert.deepEqual(am.edits.map((e) => [e.short, e.draft?.id]), [["SHORT", "short"]]);
  assert.deepEqual(am.drafts.map((d) => d.id), ["party"]); // the draft with a file is shown with its file
  assert.deepEqual(fams[1].edits.map((e) => [e.short, e.draft]), [["carol (edit)", null]]); // older edit, by its name
  assert.equal(familyCount(fams), "3 songs · 2 edits · 1 draft");
});

test("an edit of an edit belongs to the first song, and loops don't hang", () => {
  const twice = [...drafts, { id: "shorter", name: "Shorter", base: ref(SHORT), made: null }];
  assert.deepEqual(songFamilies(rows, twice)[0].drafts.map((d) => d.id), ["party", "shorter"]);
  const loop = [{ id: "a", name: "a", base: ref(SHORT), made: ref(AM) }, { id: "b", name: "b", base: ref(AM), made: ref(SHORT) }];
  assert.equal(songFamilies(rows, loop).length >= 3, true);
});

test("filters and Find", () => {
  const fams = songFamilies(rows, drafts);
  assert.deepEqual(filterFamilies(fams, "edits", "").map((f) => f.original.name), ["Arctic Monkeys - Dancefloor", "carol"]);
  assert.deepEqual(filterFamilies(fams, "drafts", "").map((f) => f.drafts.length), [1]);
  assert.ok(filterFamilies(fams, "originals", "").every((f) => !f.edits.length && !f.drafts.length));
  assert.deepEqual(filterFamilies(fams, "all", "xmas").map((f) => f.original.name), ["carol"]); // found by the show using its edit
  assert.deepEqual(filterFamilies(fams, "all", "party").map((f) => f.original.name), ["Arctic Monkeys - Dancefloor"]);
});

test("short names", () => {
  assert.equal(shortName("Carol - SHORT", "Carol"), "SHORT");
  assert.equal(shortName("carol (edit)", "carol"), "carol (edit)");
  assert.equal(shortName("Something else", "Carol"), "Something else");
});
