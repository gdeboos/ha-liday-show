import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentsOf, segmentLights, refreshedSegment, wledClash, onlySegmentsAt, isSegmentLight }
  from "../../haliday_show/app/halidayshow/static/js/wledsegments.js";

// As /api/wled/info gives a WLED's segments: Pillars on LEDs 1–150, icicles after it.
const parts = [{ id: "w0", name: "Pillars", from: 1, to: 150 },
  { id: "w1", name: "Icicles left", from: 151, to: 210 },
  { id: "w3", name: "Icicles right", from: 211, to: 270 }];

test("each WLED segment becomes a light starting at its first LED", () => {
  const lights = segmentLights([], "192.168.2.50", parts);
  assert.deepEqual(lights.map((d) => [d.id, d.name, d.first, d.segments, d.segment]), [
    ["wled-192.168.2.50-s0", "Pillars", 1, 150, 0],
    ["wled-192.168.2.50-s1", "Icicles left", 151, 60, 1],
    ["wled-192.168.2.50-s3", "Icicles right", 211, 60, 3]]);
  assert.ok(lights.every((d) => d.kind === "wled" && d.protocol === "ddp" && isSegmentLight(d)));
  assert.equal(segmentLights([{ id: "wled-192.168.2.50-s0" }], "192.168.2.50", parts)[0].id, "wled-192.168.2.50-s0-2");
  assert.deepEqual(segmentsOf([{ id: "p1", from: 1, to: 2 }]), []); // hand-made parts aren't segments
});

test("a segment light follows its segment when WLED's change", () => {
  const d = { kind: "wled", segment: 1, first: 151, segments: 60 };
  assert.deepEqual(refreshedSegment(d, [{ id: "w1", name: "x", from: 161, to: 200 }]),
    { first: 161, segments: 40, bulbs: 40, segment: 1 });
  assert.equal(refreshedSegment(d, [{ id: "w0", name: "x", from: 1, to: 10 }]), null);
});

test("lights share a WLED's IP only as different segments", () => {
  const lights = segmentLights([], "10.0.0.5", parts);
  const pillars = { id: "pillars", kind: "govee", ip: "" };
  assert.equal(wledClash(pillars, "10.0.0.5", lights, 2), "");
  assert.equal(wledClash(pillars, "10.0.0.5", lights, 1), "That WLED segment is already Icicles left");
  assert.equal(wledClash(pillars, "10.0.0.5", lights), "10.0.0.5 is already Pillars");
  assert.equal(wledClash(pillars, "", lights), "");
  const whole = [{ id: "w", kind: "wled", ip: "10.0.0.6", name: "Eaves" }];
  assert.equal(wledClash(pillars, "10.0.0.6", whole, 0), "10.0.0.6 is already Eaves");
  assert.equal(onlySegmentsAt(lights, "10.0.0.5"), true);
  assert.equal(onlySegmentsAt(whole, "10.0.0.6"), false);
  assert.equal(onlySegmentsAt(lights, "10.0.0.9"), false);
});
