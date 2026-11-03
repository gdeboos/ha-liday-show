import assert from "node:assert/strict";
import test from "node:test";
import * as sync from "../../haliday_show/app/halidayshow/static/public/listensync.js";

// A server whose song is at `pos0` seconds when the phone's clock reads 0, answering after `out` ms
// and arriving back after a further `back` ms.
const sample = (sentMs, out, back, pos0 = 10) => ({ sent: sentMs, recv: sentMs + out + back, position: pos0 + (sentMs + out) / 1000 });

test("an even round trip gives the exact position", () => {
  const s = sample(1000, 40, 40);
  assert.ok(Math.abs(sync.anchorOf(s) - 10) < 1e-9);
  assert.ok(Math.abs(sync.target([s], 5000) - 15) < 1e-9);
});

test("the quickest round trip wins over slow, lopsided ones", () => {
  let samples = [];
  samples = sync.addSample(samples, sample(0, 300, 20)); // slow out, quick back: 0.14 s out
  samples = sync.addSample(samples, sample(1000, 15, 15));
  samples = sync.addSample(samples, sample(2000, 20, 250));
  assert.equal(samples.length, 3);
  assert.ok(Math.abs(sync.target(samples, 3000) - 13) < 0.001);
});

test("a jump on the server starts the samples afresh", () => {
  let samples = [sample(0, 20, 20), sample(1000, 20, 20)];
  samples = sync.addSample(samples, sample(2000, 20, 20, 40)); // a new song: 30 s further on
  assert.equal(samples.length, 1);
  assert.ok(Math.abs(sync.target(samples, 3000) - 43) < 1e-9);
});

test("old samples are dropped and at most KEEP kept", () => {
  let samples = [];
  for (let i = 0; i < 20; i++) samples = sync.addSample(samples, sample(i * 1000, 20, 20));
  assert.equal(samples.length, sync.KEEP);
  samples = sync.addSample(samples, sample(60000, 20, 20));
  assert.equal(samples.length, 1);
});

test("nonsense samples are ignored", () => {
  const samples = [sample(0, 20, 20)];
  assert.equal(sync.addSample(samples, { sent: 5, recv: 2, position: 1 }), samples);
  assert.equal(sync.addSample(samples, { sent: 5, recv: 9, position: NaN }), samples);
  assert.equal(sync.target([], 100), null);
});

test("steering: jump when far out, nudge the speed when near, leave it when close", () => {
  assert.deepEqual(sync.steer(0.5), { seek: true, rate: 1 });
  assert.deepEqual(sync.steer(-0.31), { seek: true, rate: 1 });
  assert.deepEqual(sync.steer(NaN), { seek: true, rate: 1 });
  assert.deepEqual(sync.steer(0.01), { seek: false, rate: 1 });
  const ahead = sync.steer(0.1);
  assert.ok(ahead.rate < 1 && ahead.rate >= 1 - sync.MAX_NUDGE);
  const behind = sync.steer(-0.1);
  assert.ok(behind.rate > 1 && behind.rate <= 1 + sync.MAX_NUDGE);
  assert.equal(sync.steer(0.29).rate, 1 - sync.MAX_NUDGE);
});

test("speed nudging closes a gap", () => {
  // Simulate the phone 0.2 s behind, steering every quarter second.
  let err = -0.2;
  for (let i = 0; i < 40; i++) err += (sync.steer(err).rate - 1) * 0.25;
  assert.ok(Math.abs(err) < sync.CLOSE_S + 0.005, String(err));
});

test("a jump's lead is learned from where it landed", () => {
  let lead = 0;
  lead = sync.learnLead(lead, -0.2); // landed 0.2 s behind
  assert.ok(lead > 0.1);
  assert.equal(sync.learnLead(0.1, 1), 0); // never negative
  assert.equal(sync.learnLead(0.5, -1), 0.6); // never huge
  assert.equal(sync.learnLead(0.2, NaN), 0.2);
});

test("median", () => {
  assert.equal(sync.median([3, 1, 2]), 2);
  assert.equal(sync.median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(sync.median([NaN])));
});

test("music ahead / behind steps by 0.05 s within a second each way", () => {
  assert.equal(sync.clampNudge(0.15), 0.15);
  assert.equal(sync.clampNudge(0.1 + 0.05), 0.15); // no floating-point crumbs
  assert.equal(sync.clampNudge(0.07), 0.05);
  assert.equal(sync.clampNudge(3), 1);
  assert.equal(sync.clampNudge(-3), -1);
  assert.equal(sync.clampNudge("nonsense"), 0);
  assert.equal(sync.clampNudge(null), 0);
});
