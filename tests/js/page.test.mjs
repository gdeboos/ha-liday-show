import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Two elements with the same id make one of them unreachable from the code (0.2.132's Songs page
// took the song window's id, which left Change… empty), so every id in the page must be unique.
test("no id is used twice in the page", () => {
  const html = readFileSync(new URL("../../haliday_show/app/halidayshow/static/index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  assert.deepEqual(twice, []);
});
