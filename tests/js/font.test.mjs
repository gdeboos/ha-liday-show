import assert from "node:assert/strict";
import test from "node:test";

import { GLYPH_H, GLYPH_W, glyph, textColumns } from "../../haliday_show/app/halidayshow/static/js/font.js";

// A glyph's dots as rows of # and ., top row first.
const draw = (cols) => Array.from({ length: GLYPH_H }, (_, y) => cols.map((c) => ((c >> y) & 1 ? "#" : ".")).join(""));

test("letters are 5 dots wide and 7 high", () => {
  assert.equal(GLYPH_W, 5);
  assert.equal(GLYPH_H, 7);
  assert.deepEqual(draw(glyph("H")), ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"]);
  assert.deepEqual(draw(glyph("T")), ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."]);
});

test("every printable character has a glyph, accents are dropped and anything else is a question mark", () => {
  for (let c = 32; c < 127; c++) assert.equal(glyph(String.fromCharCode(c)).length, 5, String.fromCharCode(c));
  assert.deepEqual(glyph("é"), glyph("e"));
  assert.deepEqual(glyph("Ü"), glyph("U"));
  assert.deepEqual(glyph("€"), glyph("?"));
  assert.notDeepEqual(glyph("£"), glyph("?"));
  assert.notDeepEqual(glyph("♥"), glyph("?"));
});

test("a message is its letters' columns with a gap after each", () => {
  const cols = textColumns("Hi");
  assert.equal(cols.length, 12);
  assert.deepEqual(cols.slice(0, 5), glyph("H"));
  assert.equal(cols[5], 0);
  assert.deepEqual(textColumns(""), []);
});

test("an accent typed as its own mark joins its letter, and emoji's invisible marks are dropped", () => {
  assert.deepEqual(textColumns("é"), textColumns("é"));
  assert.deepEqual(textColumns("★️"), textColumns("★"));
  assert.equal(textColumns("x".repeat(500)).length, 200 * 6); // at most 200 letters
});
