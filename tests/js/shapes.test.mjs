import test from "node:test";
import assert from "node:assert/strict";
import { builtInShape, parseXmodel, shapeLayout, shapeLeds, shapeOf, shapeRuns, shapeTestFrame, BUILT_IN_SHAPES, rasterise } from "../../haliday_show/app/halidayshow/static/js/shapes.js";

const ledsIn = (s) => s.cells.filter((c) => c >= 0).sort((a, b) => a - b);

test("every built-in shape puts each LED in its own cell", () => {
  for (const source of Object.keys(BUILT_IN_SHAPES)) {
    const s = builtInShape(source, {});
    const n = shapeLeds(s);
    assert.ok(n > 0, source);
    assert.deepEqual(ledsIn(s), Array.from({ length: n }, (_, i) => i), source);
    assert.equal(s.cells.length, s.w * s.h);
    assert.equal(s.source, source);
  }
});

test("built-in sizes follow their numbers and limits", () => {
  assert.equal(shapeLeds(builtInShape("star", { points: 5, perPoint: 10 })), 50);
  assert.equal(shapeLeds(builtInShape("circle", { rings: 3, perRing: 20 })), 60);
  assert.equal(shapeLeds(builtInShape("spinner", { arms: 6, perArm: 8 })), 48);
  assert.equal(shapeLeds(builtInShape("frame", { across: 10, down: 5 })), 30);
  assert.equal(shapeLeds(builtInShape("star", { points: 99, perPoint: 2 })), 24); // 12 points at most
});

test("shapeOf needs the light's LED count to match", () => {
  const shape = builtInShape("circle", { rings: 1, perRing: 30 });
  assert.equal(shapeOf({ segments: 30, shape }), shape);
  assert.equal(shapeOf({ segments: 31, shape }), null);
  assert.equal(shapeOf({ segments: 30 }), null);
});

test("round: a wreath's rings chase round together", () => {
  const L = shapeLayout(builtInShape("circle", { rings: 2, perRing: 24 }));
  const { len, index } = shapeRuns(L, "round");
  assert.ok(len <= 30 && len >= 20, `len ${len}`);
  // LED 0 (outer ring, top) and LED 24 (inner ring, top) share a spot.
  assert.equal(index[0], index[24]);
});

test("out: a spinner's arms light out together", () => {
  const L = shapeLayout(builtInShape("spinner", { arms: 4, perArm: 10 }));
  const { len, index } = shapeRuns(L, "out");
  assert.equal(len, 10);
  for (let a = 0; a < 4; a++) assert.equal(index[a * 10], 0);
  for (let a = 0; a < 4; a++) assert.equal(index[a * 10 + 9], 9);
});

test("arms: each star point runs from the middle out", () => {
  const L = shapeLayout(builtInShape("star", { points: 5, perPoint: 10 }));
  const { len, index } = shapeRuns(L, "arms");
  assert.ok(len >= 4 && len <= 7, `len ${len}`);
  assert.equal(index[0], len - 1); // LED 1 is the top tip, the far end of its arm
});

test("strip is the wiring order", () => {
  const L = shapeLayout(builtInShape("cane", { leds: 20 }));
  const { len, index } = shapeRuns(L, "strip");
  assert.equal(len, 20);
  assert.deepEqual([...index], Array.from({ length: 20 }, (_, i) => i));
});

test("test frame starts white", () => {
  const f = shapeTestFrame(10);
  assert.deepEqual([...f.slice(0, 3)], [255, 255, 255]);
  assert.deepEqual([...f.slice(3, 6)], [255, 0, 0]);
});

test("rasterise keeps a crowded shape inside the limits", () => {
  const pts = Array.from({ length: 3000 }, (_, i) => [Math.cos(i), Math.sin(i * 1.3)]);
  const r = rasterise(pts);
  assert.ok(r.w * r.h <= 40000);
  assert.equal(new Set(r.cells.filter((c) => c >= 0)).size, 3000);
});

test("parseXmodel reads a custom model, its pixels and submodels", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<custommodel name="Mini &amp; flake" parm1="3" parm2="3" StringType="RGB Nodes" CustomModel="1,,2;,5,;4,,3">
<subModel name="Corners" layout="horizontal" type="ranges" line0="1-4" />
<subModel name="Middle" type="ranges" line0="5" />
<subModel name="Odd" type="subbuffer" subBuffer="0x0x50x50" />
</custommodel>`;
  const m = parseXmodel(xml);
  assert.equal(m.name, "Mini & flake");
  assert.equal(m.leds, 5);
  assert.deepEqual(m.shape.cells, [0, -1, 1, -1, 4, -1, 3, -1, 2]);
  assert.equal(m.shape.source, "xmodel");
  assert.deepEqual(m.bits.map((b) => [b.name, b.leds]), [["Corners", [0, 1, 2, 3]], ["Middle", [4]]]);
});

test("parseXmodel reads the compressed form", () => {
  const xml = `<custommodel name="C" parm1="2" parm2="2" CustomModel="" CustomModelCompressed="1,0,0;2,0,1;3,1,1"/>`;
  const m = parseXmodel(xml);
  assert.deepEqual(m.shape.cells, [0, 1, -1, 2]);
});

test("parseXmodel refuses other kinds of model", () => {
  assert.throws(() => parseXmodel(`<starmodel name="x"/>`), /custom models/);
  assert.throws(() => parseXmodel("hello"), /isn't an xLights/);
});

import { composeLight, gridFor, newClip, renderTrack } from "../../haliday_show/app/halidayshow/static/js/effects.js";

test("a strip effect running out from the middle lights a spinner's arms alike", () => {
  const shape = builtInShape("spinner", { arms: 4, perArm: 10 });
  const light = { id: "s", segments: 40, shape };
  const clip = { ...newClip("rainbow", 0, 10), runs: "out" };
  const rgb = renderTrack([clip], 1.3, 40, undefined, false, gridFor(light));
  for (let i = 0; i < 10; i++) {
    const first = [...rgb.slice(i * 3, i * 3 + 3)];
    for (let a = 1; a < 4; a++) assert.deepEqual([...rgb.slice((a * 10 + i) * 3, (a * 10 + i) * 3 + 3)], first);
  }
});

test("a grid effect paints each LED from its cell, and composeLight uses the shape", () => {
  const shape = builtInShape("circle", { rings: 1, perRing: 24 });
  const light = { id: "c", segments: 24, shape };
  const tracks = { c: { device: "c", clips: [newClip("fire2d", 0, 10)] } };
  const out = composeLight(light, (id) => tracks[id], 2);
  assert.equal(out.length, 72);
  // Fire burns at the bottom: the bottom of the wreath (LED 12) is brighter than the top (LED 0).
  const lum = (i) => out[i * 3] + out[i * 3 + 1] + out[i * 3 + 2];
  assert.ok(lum(12) > lum(0), `${lum(12)} vs ${lum(0)}`);
  assert.equal(gridFor({ id: "x", segments: 25, shape }), null);
});

import { bitShape, ledAt, newBit } from "../../haliday_show/app/halidayshow/static/js/shapes.js";
import { lanesOf, partCells, partSize } from "../../haliday_show/app/halidayshow/static/js/parts.js";

test("a bit is a little shape of its own, laid out as it sits", () => {
  const shape = { w: 3, h: 2, cells: [0, 1, 2, -1, 3, 4], source: "xmodel", params: {} };
  const bit = { id: "b1", name: "Right", leds: [2, 4] };
  const s = bitShape(shape, bit);
  assert.deepEqual([s.w, s.h, s.cells], [1, 2, [0, 1]]);
  assert.equal(bitShape(shape, bit), s); // kept
  assert.equal(ledAt(shape, 0.9, 0.9), 4);
  assert.deepEqual(newBit([{ id: "b1", name: "Bit 1" }]), { id: "b2", name: "Bit 2", leds: [] });
});

test("bits are a shaped prop's lanes; overlapping bits show the clip that started last", () => {
  const shape = builtInShape("spinner", { arms: 2, perArm: 4 });
  const bits = [{ id: "a", name: "A", leds: [0, 1, 2, 3] }, { id: "b", name: "B", leds: [3, 4] }];
  const light = { id: "s", segments: 8, shape, bits };
  assert.equal(lanesOf(light), bits);
  assert.deepEqual([...partCells(light, bits[1])], [3, 4]);
  assert.equal(partSize(bits[0]), 4);
  const solid = (colour, start) => ({ ...newClip("solid", start, 10), color: colour });
  const tracks = {
    "s#a": { device: "s#a", clips: [solid("#ff0000", 0)] },
    "s#b": { device: "s#b", clips: [solid("#0000ff", 1)] },
  };
  const at = (out, i) => [...out.slice(i * 3, i * 3 + 3)];
  let out = composeLight(light, (id) => tracks[id], 2);
  assert.deepEqual(at(out, 0), [255, 0, 0]);
  assert.deepEqual(at(out, 3), [0, 0, 255]); // B started later
  assert.deepEqual(at(out, 6), [0, 0, 0]); // in no bit, and the whole lane is empty
  tracks["s#a"].clips = [solid("#ff0000", 1.5)];
  out = composeLight(light, (id) => tracks[id], 2);
  assert.deepEqual(at(out, 3), [255, 0, 0]); // now A started later
});

import { makeShare, myLights, readShare, score } from "../../haliday_show/app/halidayshow/static/js/sharing.js";

test("share files carry a shaped prop's kind and its bits' lanes", () => {
  const shape = builtInShape("star", { points: 5, perPoint: 4 });
  const star = { id: "st", name: "Star", kind: "wled", segments: 20, shape, bits: [{ id: "b1", name: "Tips", leds: [0, 4, 8] }] };
  const show = { name: "S", tracks: [{ device: "st#b1", clips: [newClip("solid", 0, 5)] }] };
  const share = makeShare(show, [star]);
  assert.deepEqual(share.lights[0].prop, { source: "star" });
  assert.deepEqual(share.lights[0].parts, [{ key: "P1", name: "Tips", bit: true }]);
  assert.deepEqual(share.tracks[0].part, "P1");
  const back = readShare(JSON.stringify(share));
  const theirs = back.lights[0];
  assert.deepEqual(theirs.prop, { source: "star" });
  const [mine] = myLights([star]);
  assert.deepEqual(mine.parts, [{ id: "st#b1", name: "Tips" }]);
  const other = myLights([{ ...star, id: "w", shape: builtInShape("circle", {}), segments: 50, bits: undefined }])[0];
  assert.ok(score(theirs, mine).score > score(theirs, other).score);
});

import { faceRoles, mouthShape } from "../../haliday_show/app/halidayshow/static/js/shapes.js";
import { setVoiceLevels } from "../../haliday_show/app/halidayshow/static/js/effects.js";

test("an xLights face comes in as bits and a face", () => {
  const xml = `<custommodel name="Face" parm1="4" parm2="2" CustomModel="1,2,3,4;5,6,7,8">
<faceInfo Name="Singing" Type="NodeRange" Mouth-AI="5-8" Mouth-rest="6-7" Mouth-O="5,8" Eyes-Open="1,4" FaceOutline="2-3" />
</custommodel>`;
  const m = parseXmodel(xml);
  const byId = Object.fromEntries(m.bits.map((b) => [b.id, b]));
  assert.deepEqual(byId[m.face.mouth.AI].leds, [4, 5, 6, 7]);
  assert.deepEqual(byId[m.face.mouth.rest].leds, [5, 6]);
  assert.deepEqual(byId[m.face.eyes[0]].leds, [0, 3]);
  assert.equal(m.face.mouth.E, undefined);
});

test("the mouth shown is the nearest the prop has, shut when quiet", () => {
  const has = new Set(["rest", "AI", "O"]);
  assert.equal(mouthShape(has, "a", 0.8), "AI");
  assert.equal(mouthShape(has, "o", 0.8), "O");
  assert.equal(mouthShape(has, "e", 0.8), "AI");
  assert.equal(mouthShape(has, "a", 0.05), "rest");
  assert.equal(mouthShape(has, "m", 0.9), "rest");
  assert.equal(mouthShape(new Set(["MBP", "AI"]), "m", 0.9), "MBP");
});

test("Prop's singing face opens the mouth with the singer and keeps the outline lit", () => {
  const shape = { w: 4, h: 2, cells: [0, 1, 2, 3, 4, 5, 6, 7], source: "xmodel", params: {} };
  const light = { id: "f", segments: 8, shape,
    bits: [{ id: "o", name: "Open", leds: [4, 5, 6, 7] }, { id: "c", name: "Shut", leds: [5, 6] }, { id: "e", name: "Eyes", leds: [0, 3] }],
    face: { mouth: { AI: "o", rest: "c" }, eyes: ["e"] } };
  assert.equal(faceRoles(light).has.size, 2);
  const clip = { ...newClip("propface", 0, 10), life: "off" };
  const tracks = { f: { device: "f", clips: [clip] } };
  const at = (out, i) => [...out.slice(i * 3, i * 3 + 3)];
  // Singing loudly from 1 s, silent before.
  setVoiceLevels({ fps: 10, values: Array.from({ length: 100 }, (_, k) => (k >= 10 ? 90 : 0)) });
  try {
    let out = composeLight(light, (id) => tracks[id], 0.5);
    assert.deepEqual(at(out, 1), [255, 255, 255]); // outline
    assert.deepEqual(at(out, 0), [0x3f, 0xa0, 0xff]); // eye
    assert.deepEqual(at(out, 5), [255, 0x30, 0x30]); // shut mouth
    assert.deepEqual(at(out, 4), [0, 0, 0]); // open mouth's own LEDs off
    out = composeLight(light, (id) => tracks[id], 3);
    assert.deepEqual(at(out, 4), [255, 0x30, 0x30]); // open
    assert.deepEqual(at(out, 5), [255, 0x30, 0x30]); // shared with the open mouth
  } finally { setVoiceLevels(null); }
});
