import { test } from "node:test";
import assert from "node:assert/strict";
import { beforeGpuTurn, gpuBusy, gpuTurn } from "../../haliday_show/app/halidayshow/static/js/splitvocals.js";

test("the AI in the browser takes turns on the graphics chip", async () => {
  const log = [], hooks = [];
  beforeGpuTurn((who) => { hooks.push(who); });
  const job = (name, ms) => gpuTurn(async () => { log.push(`${name} starts`); await new Promise((r) => setTimeout(r, ms)); log.push(`${name} ends`); return name; }, name);
  const a = job("split", 20), b = job("notes", 5);
  assert.equal(gpuBusy(), true);
  // One failing doesn't hold up the next.
  const c = gpuTurn(async () => { throw new Error("lost the chip"); }, "lineup");
  const d = job("split2", 1);
  assert.deepEqual(await Promise.all([a, b, c.catch((e) => e.message), d]), ["split", "notes", "lost the chip", "split2"]);
  assert.deepEqual(log, ["split starts", "split ends", "notes starts", "notes ends", "split2 starts", "split2 ends"]);
  assert.deepEqual(hooks, ["split", "notes", "lineup", "split2"], "each turn lets the others go first");
  assert.equal(gpuBusy(), false);
});
