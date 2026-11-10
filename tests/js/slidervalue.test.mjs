import test from "node:test";
import assert from "node:assert/strict";

globalThis.HTMLInputElement ??= class { get value() { return ""; } set value(v) {} };
const { decimals, fromTyped, scaleOf, unitOf } = await import("../../haliday_show/app/halidayshow/static/js/slidervalue.js");

test("a slider from 0 to 1 shows as a percentage, others as they are", () => {
  assert.equal(scaleOf(0, 1), 100);
  assert.equal(scaleOf(0, 0.9), 100);
  assert.equal(scaleOf(0, 255), 1);
  assert.equal(scaleOf(-24, 12), 1);
});

test("as many decimals as the slider's steps need", () => {
  assert.equal(decimals(1, 1), 0);
  assert.equal(decimals(0.05, 100), 0);
  assert.equal(decimals(0.005, 100), 1);
  assert.equal(decimals(0.1, 1), 1);
});

test("a typed number lands on the slider's steps, inside its range", () => {
  const speed = { min: 0, max: 255, step: 1, scale: 1 };
  assert.equal(fromTyped("128", speed), 128);
  assert.equal(fromTyped("127.6", speed), 128);
  assert.equal(fromTyped("300", speed), 255);
  assert.equal(fromTyped("-4", speed), 0);
  assert.equal(fromTyped("", speed), null);
  assert.equal(fromTyped("abc", speed), null);
  assert.equal(fromTyped("45", { min: 0, max: 1, step: 0.05, scale: 100 }), 0.45);
  assert.equal(fromTyped("−6", { min: -24, max: 12, step: 1, scale: 1 }), -6);
  assert.equal(fromTyped("12", { min: 0, max: 100, step: 5, scale: 1 }), 10);
});

test("a read-out that's just a number and unit is replaced; one with words stays", () => {
  assert.equal(unitOf("50%"), "%");
  assert.equal(unitOf("+3 dB"), "dB");
  assert.equal(unitOf("40"), "");
  assert.equal(unitOf("None"), null);
  assert.equal(unitOf("Muffled 40%"), null);
});
