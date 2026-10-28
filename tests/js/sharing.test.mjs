import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTracks, lengthNote, lightType, makeShare, matchCount, myLights, partPlan, readShare, shareFileName,
  shareLevels, suggest, suggestSong,
} from "../../haliday_show/app/halidayshow/static/js/sharing.js";

const models = {
  H70C5: { sku: "H70C5", name: "30m Christmas String Lights 2" },
  H706A: { sku: "H706A", name: "30m Permanent Outdoor Lights Pro" },
};
const pillars = { id: "pillars", name: "Pillars", kind: "govee", ip: "192.168.2.155", sku: "H70C5", segments: 300,
  parts: [{ id: "l", name: "Left", from: 1, to: 100 }, { id: "c", name: "Center", from: 101, to: 200 },
    { id: "r", name: "Right", from: 201, to: 300 }], whole: true };
const roof = { id: "roof", name: "Roof", kind: "govee", ip: "192.168.2.20", sku: "H706A", segments: 90, parts: [] };
const tree = { id: "tree", name: "Tree", kind: "wled", ip: "192.168.2.30", segments: 100, parts: [] };
const clip = (start, end, effect = "solid") => ({ start, end, effect, colors: ["#ff0000"] });

const show = {
  name: "Jingle Bell Rock", audio: { source: "media", path: "Christmas/jingle bell rock.mp3" }, fps: 40, duration: 178.2,
  beats: [0.5, 1], bars: [0.5], sections: [{ start: 0, end: 10, label: "Intro" }], media_player: "media_player.kitchen",
  tracks: [
    { device: "@house", clips: [clip(0, 2, "sweep")] },
    { device: "pillars", clips: [clip(0, 4)] },
    { device: "pillars#l", clips: [clip(4, 6)] },
    { device: "pillars#r", clips: [clip(6, 8)] },
    { device: "roof", clips: [clip(1, 3)] },
    { device: "tree", clips: [] },
    { device: "gone", clips: [clip(0, 1)] },
  ],
};
const positions = { roof: [[0.1, 0.2], [0.9, 0.2]], pillars: [[0.2, 0.5], null, [0.8, 0.9]] };

test("a share file says nothing private and leaves out unused and missing lights", () => {
  const s = makeShare(show, [pillars, roof, tree], { models, positions, app: "0.2.183" });
  const text = JSON.stringify(s);
  for (const secret of ["192.168", "Christmas/", "media_player", "pillars#", "\"pillars\""]) assert.ok(!text.includes(secret), secret);
  assert.equal(s.song.name, "jingle bell rock");
  assert.equal(s.song.length, 178.2);
  assert.deepEqual(s.lights.map((l) => l.name), ["Pillars", "Roof"]);
  assert.deepEqual(s.lights[0].parts.map((p) => [p.key, p.name]), [["P1", "Left"], ["P2", "Center"], ["P3", "Right"]]);
  assert.equal(s.lights[0].type.group, "string");
  assert.equal(s.lights[1].type.group, "permanent");
  assert.deepEqual(s.lights[1].where, { x: 0.1, y: 0.2, w: 0.8, h: 0 });
  assert.deepEqual(s.tracks.map((t) => t.house ? "house" : `${t.light}${t.part || ""}`), ["house", "L1", "L1P1", "L1P3", "L2"]);
});

test("reading a share checks it and tidies it", () => {
  const s = readShare(JSON.stringify(makeShare(show, [pillars, roof, tree], { models, positions })));
  assert.equal(s.name, "Jingle Bell Rock");
  assert.equal(s.lights.length, 2);
  assert.throws(() => readShare("not json"), /isn't a HA-liday Show file/);
  assert.throws(() => readShare(JSON.stringify({ format: "other" })), /isn't a HA-liday Show file/);
  assert.throws(() => readShare(JSON.stringify({ format: "halidayshow", version: 2 })), /newer HA-liday Show/);
  const odd = readShare(JSON.stringify({ format: "halidayshow", version: 1, name: 5,
    lights: [{ key: "L1", name: "A", segments: "x" }],
    tracks: [{ light: "L1", clips: [clip(0, 1), { effect: "solid", start: 2, end: 1 }, null, { start: 0, end: 1 }] },
      { light: "L9", clips: [clip(0, 1)] }] }));
  assert.equal(odd.name, "Shared show");
  assert.equal(odd.lights[0].segments, 1);
  assert.equal(odd.tracks.length, 1);
  assert.equal(odd.tracks[0].clips.length, 1);
});

test("suggestions pair like with like, once each, and leave out poor matches", () => {
  const theirs = readShare(JSON.stringify(makeShare(show, [pillars, roof, tree], { models, positions }))).lights;
  const mine = myLights([
    { ...pillars, id: "p2", name: "Porch", ip: "" },
    { ...roof, id: "eaves", name: "Eaves" },
  ], { models, positions: { eaves: [[0.2, 0.25], [0.8, 0.25]] } });
  const plan = suggest(theirs, mine);
  assert.equal(plan.L1.light, "p2");
  assert.match(plan.L1.why, /same model/);
  assert.match(plan.L1.why, /3 parts each/);
  assert.deepEqual(plan.L1.parts, { P1: "p2#l", P2: "p2#c", P3: "p2#r" });
  assert.equal(plan.L2.light, "eaves");
  assert.match(plan.L2.why, /same spot on the house/);

  const onlyOne = suggest(theirs, [mine[0]]);
  assert.equal(onlyOne.L1.light, "p2");
  assert.equal(onlyOne.L2.light, null); // a permanent light isn't suggested onto a string that's taken

  const strangers = suggest(theirs, myLights([{ id: "sw", name: "Fountain", kind: "ha", protocol: "ha_switch", segments: 1, parts: [] }]));
  assert.equal(strangers.L1.light, null);
  assert.deepEqual(matchCount({ lights: theirs }, strangers), { matched: 0, left: 2, total: 2 });
});

test("parts go in order, by name, onto the whole light, or are left out", () => {
  const t = { parts: [{ key: "P1", name: "Left" }, { key: "P2", name: "Middle" }, { key: "P3", name: "Right" }] };
  assert.deepEqual(partPlan(t, { parts: [] }), { P1: "whole", P2: "whole", P3: "whole" });
  assert.deepEqual(partPlan(t, { parts: [{ id: "a#r", name: "Right" }, { id: "a#x", name: "Top" }] }),
    { P3: "a#r", P1: "a#x", P2: null });
});

test("tracks are built on your lights, sharing a light where asked", () => {
  const share = readShare(JSON.stringify(makeShare(show, [pillars, roof, tree], { models, positions })));
  const mine = myLights([{ ...pillars, id: "p2" }, { ...roof, id: "eaves" }], { models });
  const plan = { L1: { light: "p2", parts: { P1: "p2#l", P2: "p2#c", P3: null } }, L2: { light: "p2", parts: {} } };
  const { tracks, dropped } = buildTracks(share, plan, mine);
  assert.equal(dropped, 0);
  const by = Object.fromEntries(tracks.map((t) => [t.device, t.clips.map((c) => c.start)]));
  assert.deepEqual(by, { "@house": [0], p2: [0, 1], "p2#l": [4] });
  // A light that plays its parts only takes a whole-light track on every part.
  const partsOnly = myLights([{ ...pillars, id: "p2", whole: false }], { models });
  const t2 = buildTracks(share, { L1: { light: "p2", parts: {} } }, partsOnly).tracks;
  assert.deepEqual(t2.map((t) => t.device), ["@house", "p2#l", "p2#c", "p2#r"]);
  // Effects this copy doesn't know, or on the wrong lane, are left out and counted.
  const known = buildTracks(share, plan, mine, (fx, house) => (fx === "sweep") === house && fx !== "chase");
  assert.equal(known.dropped, 0);
  const strict = buildTracks(share, plan, mine, (fx, house) => fx === "solid" && !house);
  assert.equal(strict.dropped, 1);
  assert.deepEqual(strict.tracks.find((t) => t.device === "@house").clips, []);
  // Clips are copies.
  tracks[1].clips[0].start = 99;
  assert.equal(share.tracks[1].clips[0].start, 0);
});

test("songs, lengths and file names", () => {
  const refs = [{ source: "media", path: "xmas/Jingle Bell Rock (Radio Edit).mp3" }, { source: "media", path: "Silent Night.mp3" }];
  assert.equal(suggestSong("jingle bell rock", refs), refs[0]);
  assert.equal(suggestSong("Thriller", refs), null);
  assert.equal(lengthNote(178, 179).ok, true);
  assert.match(lengthNote(178, 212).text, /Yours is 3:32 and theirs was 2:58/);
  assert.equal(shareFileName("Xmas: 1/2"), "Xmas 1 2.halidayshow");
  assert.equal(lightType({ kind: "ha", protocol: "ha_light" }).label, "Home Assistant light");
});

test("brightness from Show settings travels in the share file and lands on your lights", () => {
  const dimmed = { ...show, brightness: 60, lightBrightness: { roof: 40, pillars: 100, tree: 30 } };
  const s = makeShare(dimmed, [pillars, roof, tree], { models, positions });
  assert.equal(s.brightness, 60);
  assert.deepEqual(s.lights.map((l) => l.brightness), [undefined, 40]); // tree has no effects, so it isn't shared
  const r = readShare(JSON.stringify(s));
  assert.equal(r.brightness, 60);
  assert.equal(r.lights[1].brightness, 40);
  // Their Roof goes on your Gutter; their Pillars on your Porch.
  assert.deepEqual(shareLevels(r, { L1: { light: "porch" }, L2: { light: "gutter" } }),
    { brightness: 60, lightBrightness: { gutter: 40 } });
  // Two of theirs on one of yours: the brighter wins.
  assert.deepEqual(shareLevels(r, { L1: { light: "porch" }, L2: { light: "porch" } }), { brightness: 60 });
});

test("an undimmed show shares as before, and odd levels are left out", () => {
  const s = makeShare(show, [pillars, roof], { models, positions });
  assert.ok(!("brightness" in s));
  assert.ok(s.lights.every((l) => !("brightness" in l)));
  const r = readShare(JSON.stringify({ ...s, brightness: "lots", lights: s.lights.map((l) => ({ ...l, brightness: 250 })) }));
  assert.ok(!("brightness" in r));
  assert.ok(r.lights.every((l) => !("brightness" in l)));
  assert.deepEqual(shareLevels(r, {}), {});
  assert.equal(readShare(JSON.stringify({ ...s, brightness: 0 })).brightness, 1);
});
