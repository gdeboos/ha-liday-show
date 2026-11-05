import assert from "node:assert/strict";
import test from "node:test";

import { MAX_URL, browserText, issueUrl, reportText } from "../../haliday_show/app/halidayshow/static/js/report.js";

const info = { version: "0.2.364", install: "Home Assistant app", lights: "2 Govee (H706A, H70C5)", ha: true,
  log: ["17:00:01 WARNING x: <ip> didn't answer"] };

test("the browser in a few words", () => {
  assert.equal(browserText("Mozilla/5.0 (Linux; Android 14; SM-F946B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36"), "Chrome 131 on Android");
  assert.equal(browserText("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"), "Safari 18 on iPhone");
  assert.equal(browserText("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0"), "Firefox 132 on Windows");
  assert.equal(browserText(""), "A browser");
});

test("the report says what went wrong, then everything about the install", () => {
  const { title, body } = reportText({ what: "The Pillars stay dark\nafter Stop", expected: "Back to the scene", info,
    browser: "Chrome 131 on Android", screen: "412 × 900", error: "Couldn't start the show" });
  assert.equal(title, "The Pillars stay dark");
  for (const bit of ["**What went wrong**", "after Stop", "**What I expected**", "**The message it showed**",
    "- HA-liday Show 0.2.364 (Home Assistant app)", "- Lights: 2 Govee (H706A, H70C5)", "- Home Assistant connected: yes",
    "- Browser: Chrome 131 on Android, screen 412 × 900", "<ip> didn't answer"]) assert.ok(body.includes(bit), bit);
  assert.equal(reportText({ error: "Couldn't save" }).title, "Problem: Couldn't save");
  assert.match(reportText({ info: { ...info, log: [] } }).body, /None since HA-liday Show started/);
});

test("the GitHub link stays short enough, dropping the oldest lines", () => {
  const long = { ...info, log: Array.from({ length: 50 }, (_, k) => `line ${k} ${"x".repeat(300)}`) };
  const url = issueUrl({ what: "Broken", info: long });
  assert.ok(url.length <= MAX_URL && url.startsWith("https://github.com/gdeboos/ha-liday-show/issues/new?"));
  const body = new URL(url).searchParams.get("body");
  assert.ok(body.includes("line 49") && !body.includes("line 0 "));
  assert.equal(new URL(url).searchParams.get("labels"), "claude");
});
