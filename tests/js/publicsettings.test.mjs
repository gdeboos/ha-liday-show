import assert from "node:assert/strict";
import test from "node:test";
import { addressText, queueText } from "../../haliday_show/app/halidayshow/static/js/publicsettings.js";

const view = (extra = {}) => ({ on: true, port: 18099, listening: true, error: null, now: null, waiting: [], ...extra });

test("the public page's address uses the home address HA-liday Show was opened on", () => {
  assert.match(addressText(view(), "192.168.2.10"), /http:\/\/192\.168\.2\.10:18099$/);
  assert.match(addressText(view(), "homeassistant.local"), /http:\/\/homeassistant\.local:18099$/);
  assert.match(addressText(view(), "abc123.ui.nabu.casa"), /<your Home Assistant's address>:18099$/);
  assert.match(addressText(view({ listening: false }), "x"), /first time you change a setting/);
  assert.match(addressText(view({ error: "couldn't open port 18099: in use" }), "x"), /Configuration tab/);
});

test("the queue says what visitors are waiting for", () => {
  assert.equal(queueText(view()), "No visitors' shows waiting.");
  assert.equal(queueText(view({ on: false })), "");
  assert.equal(queueText(view({ now: "Party", waiting: [{ name: "Frozen", wait: 130 }] })),
    "A visitor's show is on now: Party. Waiting: Frozen (in about 2 min).");
});

test("each show or playlist says when visitors can pick it", async () => {
  const { inDates, itemText } = await import("../../haliday_show/app/halidayshow/static/js/publicsettings.js");
  const xmas = { kind: "playlist", from: "12-01", to: "01-06" };
  assert.equal(inDates(xmas, "2026-12-25"), true);
  assert.equal(inDates(xmas, "2027-01-06"), true);
  assert.equal(inDates(xmas, "2026-10-26"), false);
  assert.equal(itemText({ kind: "show", from: "", to: "" }, "2026-10-26"), "Show · all year");
  assert.equal(itemText(xmas, "2026-10-26"), "Playlist · 1 Dec to 6 Jan every year · coming soon until 1 Dec");
  assert.equal(itemText(xmas, "2026-12-02"), "Playlist · 1 Dec to 6 Jan every year · visitors can pick it now");
});
