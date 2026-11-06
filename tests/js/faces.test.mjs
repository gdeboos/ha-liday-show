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
