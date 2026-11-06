import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN, CHARACTERS, RECIPE_PARTS, drawRecipe, faceColour } from "../../haliday_show/app/halidayshow/static/js/faces.js";

const count = (draw, test) => {
  let n = 0;
  for (let y = 0; y < 80; y++) for (let x = 0; x < 60; x++) { const c = draw((x + 0.5) / 60, (y + 0.5) / 80); if (c && test(c)) n++; }
  return n;
};
const changes = (a, b) => {
  let n = 0;
  for (let y = 0; y < 80; y++) for (let x = 0; x < 60; x++) if (String(a((x + 0.5) / 60, (y + 0.5) / 80)) !== String(b((x + 0.5) / 60, (y + 0.5) / 80))) n++;
  return n;
};

test("every built-in face is listed, draws, sings and blinks", () => {
  for (const name of Object.keys(BUILT_IN)) assert.ok(CHARACTERS.includes(name), name);
  for (const c of CHARACTERS) {
    const shut = count((u, v) => faceColour(c, u, v, { mouth: 0 }), () => true);
    assert.ok(shut > 900, `${c} fills a good part of its box`);
    assert.ok(changes((u, v) => faceColour(c, u, v, { mouth: 1 }), (u, v) => faceColour(c, u, v, { mouth: 0 })) > 20, `${c}'s mouth opens`);
  }
  for (const c of Object.keys(BUILT_IN)) {
    assert.ok(changes((u, v) => faceColour(c, u, v, { blink: 0 }), (u, v) => faceColour(c, u, v, { blink: 1 })) > 3, `${c} blinks`);
  }
});

test("every part of a recipe draws, and bad colours fall back", () => {
  const f = { mouth: 0.6, shape: "a", blink: 0, look: 0 };
  for (const shape of RECIPE_PARTS.head) for (const style of RECIPE_PARTS.eyes) {
    const r = { head: { shape, colour: "#3080c0" }, eyes: { style, colour: "#ffd24a" }, mouth: { style: "open" } };
    assert.ok(drawRecipe(r, 0.5, 0.62, f), `${shape} with ${style} eyes`);
  }
  for (const top of RECIPE_PARTS.top) for (const mouth of RECIPE_PARTS.mouth) for (const nose of RECIPE_PARTS.nose) {
    const r = { head: { shape: "round", colour: "nope" }, top: { style: top }, mouth: { style: mouth }, nose: { style: nose },
      extras: Object.fromEntries(RECIPE_PARTS.extras.map((e) => [e, "#ffffff"])) };
    assert.ok(drawRecipe(r, 0.3, 0.55, f));
  }
  assert.equal(drawRecipe({}, 0.01, 0.99, f), null); // an empty recipe is a plain round head
});

test("recipes are cleaned, built-ins duplicate as they look, and your faces draw and are found in shows", async () => {
  const { BUILT_IN: B, LOOKALIKE, cleanRecipe, recipeOf, keepFace, forgetFace, getFace, faceList, facesUsed, facesVersion } =
    await import("../../haliday_show/app/halidayshow/static/js/faces.js");
  const f = { mouth: 0.7, shape: "a", blink: 0, look: 0 };
  // A recipe-made built-in, duplicated, draws exactly as the original.
  for (const c of Object.keys(B)) {
    const r = recipeOf(c);
    let diff = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 30; x++) if (String(drawRecipe(B[c], x / 30, y / 40, f)) !== String(drawRecipe(r, x / 30, y / 40, f))) diff++;
    assert.equal(diff, 0, c);
  }
  for (const c of Object.keys(LOOKALIKE)) assert.ok(recipeOf(c).head.shape);
  // Rubbish in, a plain face out; colours lower-cased; unknown extras dropped.
  const clean = cleanRecipe({ head: { shape: "cube", colour: "#ABCDEF" }, eyes: "x", extras: { wings: "#ffffff", scarf: "#FF0000", beard: "red" } });
  assert.equal(clean.head.shape, "round");
  assert.equal(clean.head.colour, "#abcdef");
  assert.deepEqual(clean.extras, { scarf: "#ff0000" });
  assert.deepEqual(cleanRecipe(clean), clean);
  // Yours: kept, drawn, listed, found in a show, forgotten (then a snowman).
  const v = facesVersion();
  keepFace("ftest000001", { name: "Bob", recipe: { head: { shape: "tree", colour: "#00ff00" } } });
  assert.ok(facesVersion() > v);
  assert.deepEqual(faceColour("ftest000001", 0.5, 0.92, f), faceColour("ftest000001", 0.5, 0.92, f));
  assert.notDeepEqual(faceColour("ftest000001", 0.5, 0.45, f), faceColour("snowman", 0.5, 0.45, f));
  assert.deepEqual(faceList().map((x) => x.name), ["Bob"]);
  const show = { tracks: [{ clips: [{ effect: "singingface", character: "ftest000001" }, { effect: "singingface", character: "elf" }] }] };
  assert.deepEqual(Object.keys(facesUsed(show)), ["ftest000001"]);
  assert.deepEqual(facesUsed({ tracks: [{ clips: [{ effect: "singingface", character: "elf" }] }] }), {});
  forgetFace("ftest000001");
  assert.equal(getFace("ftest000001"), undefined);
  assert.deepEqual(faceColour("ftest000001", 0.5, 0.5, f), faceColour("snowman", 0.5, 0.5, f));
});

test("a phone's quick face drawing matches the full drawing for every face, singing and blinking", async () => {
  const { faceDrawer, quickDrawer } = await import("../../haliday_show/app/halidayshow/static/js/faces.js");
  const W = 162, H = 216; // a sharp face's box on a phone
  for (const c of CHARACTERS) {
    const full = faceDrawer(c), quick = quickDrawer(c, W, H);
    for (const face of [{ mouth: 1, shape: "a", blink: 0, look: -1 }, { mouth: 0.6, shape: "e", blink: 1, look: 1 }, { mouth: 0.8, shape: "o", blink: 0.5, look: 0 }]) {
      let diff = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W, v = (y + 0.5) / H;
        if (String(full(u, v, face)) !== String(quick(u, v, face))) diff++;
      }
      assert.equal(diff, 0, `${c} ${JSON.stringify(face)}`);
    }
  }
});
