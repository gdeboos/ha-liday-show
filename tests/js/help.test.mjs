import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HELP, helpPageFor, panelHelp, searchHelp, topicGuide } from "../../haliday_show/app/halidayshow/static/js/help.js";
import { EDITORS } from "../../haliday_show/app/halidayshow/static/js/layout.js";

// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens.
const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");
const anchors = (file) => new Set(readFileSync(new URL(`../../docs/guide/${file}`, import.meta.url), "utf8")
  .split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, ""))));

test("every guide link points at a real heading", () => {
  for (const [page, p] of Object.entries(HELP)) {
    for (const topic of p.topics) {
      const [file, anchor] = topic.guide || p.guide;
      assert.ok(anchors(file).has(anchor), `${page} / ${topic.title}: ${file}#${anchor}`);
      assert.match(topicGuide(page, topic), /^https:\/\/github\.com\/gdeboos\/ha-liday-show\/blob\/main\/docs\/guide\//);
    }
  }
});

test("every editor panel has help, and every topic has something in it", () => {
  for (const [editor, spec] of Object.entries(EDITORS)) {
    const page = editor === "show" ? "editor" : editor;
    for (const panel of Object.keys(spec.panels)) assert.ok(panelHelp(page, panel), `${page} ${panel}`);
  }
  for (const p of Object.values(HELP)) for (const t of p.topics) assert.ok((t.tips || t.keys).length, t.title);
});

test("the editors' lists share the Library pages' help", () => {
  assert.equal(helpPageFor("showlist"), "shows");
  assert.equal(helpPageFor("songlist"), "songs");
  assert.equal(helpPageFor("music"), "music");
  assert.equal(helpPageFor("nope"), null);
});

test("a panel's bubble has its first tips and says how many there are", () => {
  const h = panelHelp("editor", "inspector", 2);
  assert.equal(h.tips.length, 2);
  assert.equal(h.total, 5);
  assert.equal(h.topic.id, "selection");
});

test("search finds topics with every word, the current page first, ignoring markup", () => {
  const r = searchHelp("crossfade");
  assert.ok(r.some((x) => x.page === "music" && x.topic.id === "splice"));
  assert.deepEqual(searchHelp("   "), []);
  assert.equal(searchHelp("zzzz nothing").length, 0);
  const undo = searchHelp("undo", "music");
  assert.equal(undo[0].page, "music");
  assert.ok(searchHelp("ctrl s").length >= 1, "keys are searchable");
});
