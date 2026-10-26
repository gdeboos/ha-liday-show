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
