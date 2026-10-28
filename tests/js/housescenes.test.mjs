import assert from "node:assert/strict";
import test from "node:test";

import { bake } from "../../haliday_show/app/halidayshow/static/js/effects.js";
import {
  SCENE_EFFECTS, WARM_WHITE, lookFor, newScene, sceneColours, sceneLoop, sceneShow, sceneSummary, setSame, speedParam,
} from "../../haliday_show/app/halidayshow/static/js/housescenes.js";

const roof = { id: "roof", name: "Roof", segments: 4, parts: [] };
const tree = { id: "192.168.2.30", name: "Tree", segments: 2, parts: [] };
const split = { id: "pillars", name: "Pillars", segments: 6, whole: false,
  parts: [{ id: "l", name: "Left", from: 1, to: 3 }, { id: "r", name: "Right", from: 4, to: 6 }] };
const lights = [roof, tree, split];

test("a new scene starts every light on a steady warm white", () => {
  const s = newScene("Evening", lights);
  assert.equal(s.mode, "basic");
  assert.deepEqual(Object.keys(s.lights), ["roof", "192.168.2.30", "pillars"]);
  assert.deepEqual(s.lights.roof, { effect: "solid", params: { color: WARM_WHITE } });
  assert.equal(SCENE_EFFECTS[0], "solid");
  assert.ok(!SCENE_EFFECTS.includes("fade") && !SCENE_EFFECTS.includes("scene"));
});

test("each light plays its own look, a light with none stays off, and parts-only lights play on their parts", () => {
  const s = { name: "x", mode: "basic", lights: { roof: { effect: "solid", params: { color: "#ff0000" } },
    pillars: { effect: "solid", params: { color: "#0000ff" } } } };
  const show = sceneShow(s, lights, 2);
  assert.deepEqual(show.tracks.map((t) => t.device), ["roof", "pillars#l", "pillars#r"]);
  assert.equal(show.tracks[0].clips[0].end, 2);
  const devices = { roof, [tree.id]: tree, pillars: split,
    "pillars#l": { parent: "pillars", segments: 3, from: 1, to: 3 }, "pillars#r": { parent: "pillars", segments: 3, from: 4, to: 6 } };
  const blob = bake(show, devices, 10);
  assert.ok(blob.length > 0);
  assert.equal(lookFor(s, tree.id), null);
});

test("Same for every light plays one look on all of them, and back again", () => {
  const s = newScene("x", lights);
  s.lights.roof = { effect: "rainbow", params: {} };
  setSame(s, true, lights);
  assert.deepEqual(s.all, { effect: "rainbow", params: {} });
  assert.equal(sceneShow(s, lights, 1).tracks.length, 4);
  setSame(s, false, lights);
  assert.equal(s.all, undefined);
  assert.deepEqual(Object.values(s.lights).map((l) => l.effect), ["rainbow", "rainbow", "rainbow"]);
});

test("a still scene loops every second; a moving one goes round where it joins up", () => {
  assert.equal(sceneLoop(newScene("x", lights), lights, 10), 1);
  const moving = { name: "x", mode: "basic", lights: {}, all: { effect: "rainbow", params: { speed: 1 } } };
  const loop = sceneLoop(moving, [roof], 10);
  assert.ok(loop >= 10 && loop <= 60, String(loop));
});

test("a scene's row shows its colours and what it plays", () => {
  const s = { name: "x", mode: "basic", lights: { roof: { effect: "chase", params: { color: "#ff0000", background: "#000000" } },
    pillars: { effect: "twinkle", params: { color: "#ffffff" } } } };
  assert.deepEqual(sceneColours(s, lights), ["#ff0000", "#ffffff"]);
  assert.equal(sceneSummary(s, lights), "2 lights · Chase, Twinkle");
  assert.equal(sceneSummary({ ...s, all: { effect: "rainbow", params: {} } }, lights), "Every light · Rainbow");
  assert.equal(sceneSummary({ name: "x", lights: {} }, lights), "No lights on yet");
});

test("the Speed slider moves an effect's speed or its rate", () => {
  assert.equal(speedParam("chase").key, "speed");
  assert.equal(speedParam("twinkle").key, "rate");
  assert.equal(speedParam("solid"), null);
});

test("picking another effect keeps a light's colours and brightness", async () => {
  const { changeEffect } = await import("../../haliday_show/app/halidayshow/static/js/housescenes.js");
  const look = { effect: "chase", params: { color: "#ff0000", background: "#000000", brightness: 70 } };
  assert.deepEqual(changeEffect(look, "twinkle").params, { color: "#ff0000", brightness: 70 });
  assert.deepEqual(changeEffect(null, "rainbow"), { effect: "rainbow", params: {} });
});

test("Basic to Advanced and back, while nothing would be lost", async () => {
  const { toAdvanced, canBasic, toBasic } = await import("../../haliday_show/app/halidayshow/static/js/housescenes.js");
  const basic = { name: "Glow", mode: "basic", lights: { roof: { effect: "chase", params: { color: "#ff0000" } } } };
  const adv = toAdvanced(basic, lights, 20);
  assert.equal(adv.mode, "advanced");
  assert.equal(adv.loop, 20);
  assert.deepEqual(adv.tracks.map((t) => [t.device, t.clips[0].start, t.clips[0].end]), [["roof", 0, 20]]);
  assert.ok(canBasic(adv, lights));
  assert.deepEqual(toBasic(adv).lights.roof.effect, "chase");
  assert.equal(toBasic(adv).lights.roof.params.color, "#ff0000");
  // Cut in two, or a House lane effect: Basic can't hold it.
  const cut = structuredClone(adv);
  cut.tracks[0].clips = [{ ...adv.tracks[0].clips[0], end: 10 }, { ...adv.tracks[0].clips[0], start: 10 }];
  assert.ok(!canBasic(cut, lights));
  const house = structuredClone(adv);
  house.tracks.push({ device: "@house", clips: [{ effect: "sweep", start: 0, end: 20 }] });
  assert.ok(!canBasic(house, lights));
  assert.match(sceneSummary(adv, lights), /^Advanced · goes round every 20 s · Chase$/);
  assert.deepEqual(sceneColours(adv, lights), ["#ff0000"]);
  assert.equal(sceneLoop(adv, lights, 40), 20);
});

test("switching modes keeps the scene's schedule", async () => {
  const { toAdvanced, toBasic } = await import("../../haliday_show/app/halidayshow/static/js/housescenes.js");
  const schedule = { on: true, start: "sunset", offset: 0, end: "00:00", days: [0, 1], from: "", to: "" };
  const adv = toAdvanced({ name: "Glow", mode: "basic", lights: {}, schedule }, lights, 20);
  assert.deepEqual(adv.schedule, schedule);
  assert.deepEqual(toBasic(adv).schedule, schedule);
});

test("a split light's parts each get their own look, or the whole light one", async () => {
  const { byParts, partLook, setByParts, setPartLook, canBasic, toAdvanced, toBasic } =
    await import("../../haliday_show/app/halidayshow/static/js/housescenes.js");
  const both = { ...split, id: "arch", whole: true };
  const red = { effect: "solid", params: { color: "#ff0000" } }, blue = { effect: "solid", params: { color: "#0000ff" } };
  const s = { name: "x", mode: "basic", lights: { arch: red } };
  assert.equal(byParts(s, both), false);
  assert.deepEqual(sceneShow(s, [both], 1).tracks.map((t) => t.device), ["arch"]);
  setByParts(s, both, true);
  assert.deepEqual(Object.keys(s.lights), ["arch#l", "arch#r"]);
  setPartLook(s, both, both.parts[1], blue);
  assert.deepEqual(sceneShow(s, [both], 1).tracks.map((t) => [t.device, t.clips[0].color]), [["arch#l", "#ff0000"], ["arch#r", "#0000ff"]]);
  assert.equal(sceneSummary(s, [both]), "1 light · Solid");
  setPartLook(s, both, both.parts[0], null);
  assert.deepEqual(sceneShow(s, [both], 1).tracks.map((t) => t.device), ["arch#r"]);
  setByParts(s, both, false);
  assert.deepEqual(s.lights, { arch: blue });

  // A parts-only light's older single look plays on each part, until one part is changed.
  const old = { name: "x", mode: "basic", lights: { pillars: red } };
  assert.equal(byParts(old, split), true);
  assert.deepEqual(partLook(old, split, split.parts[1]), red);
  setPartLook(old, split, split.parts[0], blue);
  assert.deepEqual(old.lights, { "pillars#l": blue, "pillars#r": red });

  // By parts goes to Advanced and back.
  const adv = toAdvanced(s.lights.arch ? setByParts(s, both, true) : s, [both], 20);
  assert.equal(canBasic(adv, [both]), true);
  assert.deepEqual(Object.keys(toBasic(adv).lights), ["arch#l", "arch#r"]);
  adv.tracks.push({ device: "arch", clips: [{ effect: "solid", start: 0, end: 20 }] });
  assert.equal(canBasic(adv, [both]), false);
});
