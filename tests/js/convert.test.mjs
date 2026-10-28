import assert from "node:assert/strict";
import test from "node:test";

import { convertProblem, showUses, stretchParts, toWled } from "../../haliday_show/app/halidayshow/static/js/convert.js";

const parts = [{ id: "p1", name: "Left", from: 1, to: 15 }, { id: "p2", name: "Center", from: 16, to: 29 },
  { id: "p3", name: "Right", from: 30, to: 44 }];
const pillars = { id: "192.168.2.155", kind: "govee", name: "Pillars", ip: "192.168.2.155", sku: "H70C5", segments: 44,
  bulbs: 300, protocol: "standard", reverse: false, gradient: true, brightness: 80, whole: true, parts };

test("parts keep their share of the light, as the Python migration does", () => {
  assert.deepEqual(stretchParts(parts, 44, 300).map((p) => [p.from, p.to]), [[1, 102], [103, 198], [199, 300]]);
  const three = [{ id: "a", from: 1, to: 100 }, { id: "b", from: 101, to: 200 }, { id: "c", from: 201, to: 300 }];
  assert.deepEqual(stretchParts(three, 300, 44).map((p) => [p.from, p.to]), [[1, 15], [16, 29], [30, 44]]);
  assert.deepEqual(stretchParts(three, 300, 2).map((p) => p.id), ["a", "b"]);
  assert.equal(stretchParts(parts, 44, 44), parts);
  assert.deepEqual(stretchParts(undefined, 44, 300), []);
});

test("a converted light keeps its id, name, parts and settings, and becomes a WLED light", () => {
  const w = toWled(pillars, "192.168.2.160", 300);
  assert.deepEqual(w, { id: "192.168.2.155", kind: "wled", name: "Pillars", ip: "192.168.2.160", sku: "",
    protocol: "ddp", gradient: false, segments: 300, bulbs: 300, reverse: false, brightness: 80, whole: true,
    parts: stretchParts(parts, 44, 300) });
  assert.deepEqual(w.parts.map((p) => p.id), ["p1", "p2", "p3"]); // clips on parts stay with them
});

test("the IP is optional, but must be one and not another light's", () => {
  const porch = { id: "porch", name: "Porch", ip: "192.168.2.20" };
  assert.equal(convertProblem(pillars, "", [pillars, porch]), ""); // planned: the controller isn't on yet
  assert.match(convertProblem(pillars, "192.168.2", [pillars, porch]), /isn't an IP address/);
  assert.match(convertProblem(pillars, "192.168.2.20", [pillars, porch]), /already Porch/);
  assert.equal(convertProblem(pillars, "192.168.2.155", [pillars, porch]), ""); // the WLED kept the old address
  assert.equal(convertProblem(pillars, "192.168.2.160", [pillars, porch]), "");
});

test("shows using the light or one of its parts are found", () => {
  assert.equal(showUses({ tracks: [{ device: "porch" }, { device: "192.168.2.155#p2" }] }, "192.168.2.155"), true);
  assert.equal(showUses({ tracks: [{ device: "192.168.2.15" }] }, "192.168.2.155"), false);
  assert.equal(showUses(null, "x"), false);
});

test("with no IP the light becomes a planned WLED light", () => {
  const w = toWled(pillars, "", 300);
  assert.equal(w.ip, "");
  assert.equal(w.kind, "wled");
  assert.equal(w.segments, 300);
});
