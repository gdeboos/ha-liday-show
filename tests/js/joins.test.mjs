import assert from "node:assert/strict";
import test from "node:test";

import { joinPartner, moveJoin } from "../../haliday_show/app/halidayshow/static/js/joins.js";

const a = { start: 0, end: 4 }, b = { start: 4.01, end: 8 }, c = { start: 9, end: 12 };

test("only clips that touch share a join", () => {
  const clips = [a, b, c];
  assert.equal(joinPartner(clips, a, "end"), b);
  assert.equal(joinPartner(clips, b, "start"), a);
  assert.equal(joinPartner(clips, b, "end"), null); // a gap before c
  assert.equal(joinPartner(clips, a, "start"), null);
});

test("moving a join moves both sides, and neither can vanish", () => {
  const l = { start: 0, end: 4 }, r = { start: 4, end: 8 };
  assert.equal(moveJoin(l, r, 5.5, 0.05), 5.5);
  assert.deepEqual([l.end, r.start], [5.5, 5.5]);
  assert.equal(moveJoin(l, r, 20, 0.05), 7.95);
  assert.equal(moveJoin(l, r, -3, 0.05), 0.05);
  assert.equal(l.end, r.start);
});
