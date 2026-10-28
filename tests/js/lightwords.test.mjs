import test from "node:test";
import assert from "node:assert/strict";
import { countText, rangeText, showBulbs, sizeText, unitWord } from "../../haliday_show/app/halidayshow/static/js/lightwords.js";
import { groupShares } from "../../haliday_show/app/halidayshow/static/js/lightgroups.js";

const wled = { kind: "wled", segments: 400, bulbs: 400 };
const govee = { kind: "govee", segments: 15, bulbs: null };
const ha = { kind: "ha", segments: 1, bulbs: 1 };

test("LED lights count LEDs, Govee lights segments, Home Assistant lights one colour", () => {
  assert.equal(countText(wled), "400 LEDs");
  assert.equal(countText({ kind: "twinkly", segments: 1 }), "1 LED");
  assert.equal(countText(govee), "15 segments");
  assert.equal(countText({ segments: 15 }), "15 segments"); // older lights without a kind are Govee
  assert.equal(countText(ha), "one colour");
  assert.equal(unitWord(wled, 1), "LED");
  assert.equal(rangeText(wled, 1, 150), "LEDs 1–150");
  assert.equal(rangeText(govee, 1, 5), "Segments 1–5");
});

test("Bulbs shows on Govee lights, and elsewhere only when it differs from the count", () => {
  assert.equal(showBulbs(govee), true);
  assert.equal(showBulbs(wled), false);
  assert.equal(showBulbs({ ...wled, bulbs: null }), false);
  assert.equal(showBulbs({ ...wled, bulbs: 300 }), true);
  assert.equal(showBulbs(ha), false);
  assert.equal(showBulbs({ ...ha, bulbs: 6 }), true);
});

test("a group's size names each kind of cell", () => {
  const lights = [
    { id: "a", kind: "wled", segments: 100, parts: [{ id: "l", from: 1, to: 40 }, { id: "r", from: 41, to: 100 }] },
    { id: "b", kind: "govee", segments: 15 },
    { id: "c", kind: "ha", segments: 1 },
  ];
  assert.equal(sizeText(groupShares(["a#l"], lights)), "40 LEDs");
  assert.equal(sizeText(groupShares(["a", "b"], lights)), "100 LEDs and 15 segments");
  assert.equal(sizeText(groupShares(["a#r", "b", "c"], lights)), "60 LEDs, 15 segments and 1 one-colour light");
  assert.equal(sizeText([]), "");
});

test("a Govee light with a segment for every bulb counts bulbs", () => {
  const pillars = { kind: "govee", segments: 300, bulbs: 300 };
  assert.equal(countText(pillars), "300 bulbs");
  assert.equal(unitWord(pillars, 1), "bulb");
  assert.equal(rangeText(pillars, 1, 100), "Bulbs 1–100");
  assert.equal(showBulbs(pillars), true);
  assert.equal(sizeText([{ light: pillars, n: 100 }, { light: govee, n: 15 }]), "100 bulbs and 15 segments");
});
