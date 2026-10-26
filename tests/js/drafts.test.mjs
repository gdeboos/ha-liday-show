import assert from "node:assert/strict";
import test from "node:test";

import { DraftKeeper } from "../../haliday_show/app/halidayshow/static/js/drafts.js";

// Timers run by hand, and a server that answers when told to.
function setup() {
  const timers = { n: 0, due: new Map(),
    setTimeout(fn) { this.due.set(++this.n, fn); return this.n; },
    clearTimeout(id) { this.due.delete(id); },
    run() { const fns = [...this.due.values()]; this.due.clear(); fns.forEach((f) => f()); } };
  const calls = [], drafts = new Map();
  let nextId = 1, hold = null, failNext = false;
  const api = async (path, { method, json }) => {
    if (hold) await hold;
    calls.push([method, path, json?.name, json?.made?.path ?? null]);
    if (failNext) { failNext = false; throw Object.assign(new Error("offline"), { status: 0 }); }
    if (method === "POST") { const id = `d${nextId++}`; drafts.set(id, json); return { id }; }
    const id = path.split("/").pop();
    if (!drafts.has(id)) throw Object.assign(new Error("gone"), { status: 404 });
    drafts.set(id, json);
    return { ok: true };
  };
  const errors = [];
  const keeper = new DraftKeeper(api, { timers, onError: (m) => errors.push(m) });
  return { keeper, timers, calls, drafts, errors,
    holdUntil() { let go; hold = new Promise((r) => { go = r; }); return () => { hold = null; go(); }; },
    failOnce() { failNext = true; } };
}
const body = (name) => ({ name, pieces: [] });

test("changes are sent once they stop, the first making the draft and the rest updating it", async () => {
  const { keeper, timers, calls } = setup();
  assert.equal(keeper.current, null);
  keeper.changed(body("a"));
  keeper.changed(body("b"));
  assert.ok(keeper.pending);
  timers.run();
  await keeper.flush();
  keeper.changed(body("c"));
  await keeper.flush();
  assert.deepEqual(calls.map((c) => c.slice(0, 3)), [["POST", "api/drafts", "b"], ["PUT", "api/drafts/d1", "c"]]);
  assert.equal(keeper.current.id, "d1");
  assert.ok(!keeper.pending && !keeper.failed);
});

test("switching mid-save sends the old draft's change to it, and makes no stray draft", async () => {
  const { keeper, timers, calls, drafts, holdUntil } = setup();
  const go = holdUntil();
  keeper.changed(body("song A edit"));
  timers.run(); // A's first save is now waiting on the server
  keeper.changed(body("song A edit, more"));
  keeper.start(null); // open song B: A's waiting change is sent to A
  assert.equal(keeper.current, null, "nothing yet for song B");
  go();
  await new Promise((r) => setTimeout(r, 0));
  await keeper.flush();
  keeper.changed(body("song B edit"));
  await keeper.flush();
  // A's save had not gone yet, so it took A's latest change; B got a draft of its own.
  assert.deepEqual(calls.map((c) => c.slice(0, 3)),
    [["POST", "api/drafts", "song A edit, more"], ["POST", "api/drafts", "song B edit"]]);
  assert.deepEqual([...drafts.keys()], ["d1", "d2"]);
});

test("opening a draft carries on saving to it, and remembers the file it made", async () => {
  const { keeper, calls, drafts } = setup();
  drafts.set("d7", body("Short version"));
  keeper.start({ id: "d7", made: null });
  keeper.setMade({ source: "media", path: "haliday_show/Short version.wav" });
  keeper.changed(body("Short version"));
  await keeper.flush();
  assert.deepEqual(calls, [["PUT", "api/drafts/d7", "Short version", "haliday_show/Short version.wav"]]);
  assert.equal(keeper.current.made.path, "haliday_show/Short version.wav");
});

test("a draft deleted elsewhere is made again from the edit", async () => {
  const { keeper, calls } = setup();
  keeper.start({ id: "gone", made: null });
  keeper.changed(body("x"));
  await keeper.flush();
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [["PUT", "api/drafts/gone"], ["POST", "api/drafts"]]);
  assert.equal(keeper.current.id, "d1");
});

test("a change that couldn't be sent is kept and sent with the next flush", async () => {
  const { keeper, calls, errors, failOnce } = setup();
  failOnce();
  keeper.changed(body("x"));
  await keeper.flush();
  assert.ok(keeper.failed);
  assert.deepEqual(errors, ["offline"]);
  await keeper.flush();
  assert.ok(!keeper.failed);
  assert.deepEqual(calls.map((c) => c.slice(0, 3)), [["POST", "api/drafts", "x"], ["POST", "api/drafts", "x"]]);
});

test("a draft deleted here gets nothing more, and the next change starts a new one", async () => {
  const { keeper, timers, calls, drafts } = setup();
  drafts.set("d9", body("old"));
  keeper.start({ id: "d9", made: null });
  keeper.changed(body("old, changed"));
  keeper.forget();
  timers.run();
  await keeper.flush();
  assert.deepEqual(calls, []);
  keeper.changed(body("new"));
  await keeper.flush();
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [["POST", "api/drafts"]]);
});

test("a change made while the first save is on its way goes to that draft, even after switching", async () => {
  const { keeper, timers, calls, holdUntil } = setup();
  const go = holdUntil();
  keeper.changed(body("A1"));
  timers.run();
  await new Promise((r) => setTimeout(r, 0)); // A1 has left and is waiting on the server
  keeper.changed(body("A2"));
  keeper.start(null);
  keeper.changed(body("B1"));
  go();
  await new Promise((r) => setTimeout(r, 0));
  await keeper.flush();
  const byName = Object.fromEntries(calls.map((c) => [c[2], c.slice(0, 2)]));
  assert.deepEqual(byName.A1, ["POST", "api/drafts"]);
  assert.deepEqual(byName.A2, ["PUT", "api/drafts/d1"]);
  assert.deepEqual(byName.B1, ["POST", "api/drafts"]);
  assert.equal(calls.filter((c) => c[0] === "POST").length, 2);
});

test("a file made while you switched drafts is recorded on the draft that made it", async () => {
  const { keeper, calls, drafts } = setup();
  drafts.set("d1", body("A"));
  keeper.start({ id: "d1", made: null });
  const making = keeper.session; // Make song file pressed on A
  keeper.start(null); // then song B opened while it uploads
  keeper.setMade({ path: "A.wav" }, making);
  keeper.changed(body("A"), making);
  await making.chain;
  assert.deepEqual(calls, [["PUT", "api/drafts/d1", "A", "A.wav"]]);
  assert.equal(keeper.current, null, "song B has no draft and nothing made");
});

test("a draft deleted here while a save was on its way isn't made again", async () => {
  const { keeper, timers, calls, drafts, holdUntil } = setup();
  drafts.set("d1", body("A"));
  keeper.start({ id: "d1", made: null });
  const go = holdUntil();
  keeper.changed(body("A2"));
  timers.run();
  await new Promise((r) => setTimeout(r, 0));
  keeper.forget();
  drafts.delete("d1");
  go();
  await new Promise((r) => setTimeout(r, 0));
  await keeper.flush();
  assert.deepEqual(calls.map((c) => c[0]), ["PUT"]);
  assert.equal(drafts.size, 0);
});

test("leaving the page sends with keepalive", async () => {
  const seen = [];
  const keeper = new DraftKeeper(async (path, opts) => { seen.push(opts.keepalive); return { id: "d1" }; },
    { timers: { setTimeout: () => 1, clearTimeout() {} } });
  keeper.changed(body("x"));
  await keeper.flush({ keepalive: true });
  assert.deepEqual(seen, [true]);
});

test("a draft you've left whose last change failed is reported, kept and sent with your next change", async () => {
  const { keeper, timers, calls, drafts, failOnce } = setup();
  const errors = [];
  keeper.onError = (m, s, current) => errors.push([m, s.latest?.name, current]);
  drafts.set("d9", body("A"));
  keeper.start({ id: "d9", made: null });
  failOnce();
  keeper.changed(body("A changed"));
  keeper.start(null); // leave A: its change is sent now, and fails
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(errors, [["offline", "A changed", false]]);
  assert.ok(!keeper.failed && keeper.anyFailed, "this song is fine, but A's change is waiting");
  keeper.changed(body("B"));
  timers.run();
  await keeper.flush();
  assert.equal(drafts.get("d9").name, "A changed");
  assert.ok(!keeper.anyFailed);
  assert.deepEqual(calls.map((c) => c.slice(0, 3)).filter((c) => c[2] !== "B"),
    [["PUT", "api/drafts/d9", "A changed"], ["PUT", "api/drafts/d9", "A changed"]]);
});

test("a stalled draft that's deleted, renamed or reopened from Your songs stays as you left it", async () => {
  const { keeper, drafts, failOnce } = setup();
  const leaveFailing = async (id, name) => {
    drafts.set(id, body(name));
    keeper.start({ id, made: null });
    await keeper.flush(); // let any retries finish first, so the failure is this draft's
    failOnce();
    keeper.changed(body(`${name} changed`));
    keeper.start(null);
    await new Promise((r) => setTimeout(r, 0));
  };
  await leaveFailing("d7", "Deleted");
  keeper.forgetId("d7");
  drafts.delete("d7");
  await leaveFailing("d8", "Renamed");
  drafts.set("d8", body("New name"));
  keeper.renamed("d8", "New name");
  await leaveFailing("d6", "Reopened");
  keeper.start({ id: "d6", made: null }); // opened again, as the server has it
  await keeper.flush();
  assert.ok(!drafts.has("d7") && [...drafts.values()].every((d) => !d.name.startsWith("Deleted")), "not made again");
  assert.equal(drafts.get("d8").name, "New name");
  assert.equal(drafts.get("d6").name, "Reopened", "the stale change didn't land on the reopened draft");
  assert.ok(!keeper.anyFailed);
});
