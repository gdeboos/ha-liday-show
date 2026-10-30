// Buttons are written with symbols such as "▶ Play" or "⏩", but many of those symbols turn into
// colourful emoji on some computers and phones (Windows draws ⏩ as a blue box). On a button, each
// one is swapped for a line icon drawn in the button's own text colour, so labels can keep being
// written the easy way and look the same everywhere.

const SVG = "http://www.w3.org/2000/svg";

// Each symbol's drawing on a 24×24 grid: [tag, attributes]. "solid" shapes are filled.
const solid = { fill: "currentColor", stroke: "none" };
export const GLYPHS = {
  "▶": [["path", { d: "M7 4.5v15l12-7.5z", ...solid }]],
  "⏸": [["rect", { x: 6, y: 5, width: 4, height: 14, rx: 1, ...solid }], ["rect", { x: 14, y: 5, width: 4, height: 14, rx: 1, ...solid }]],
  "■": [["rect", { x: 6, y: 6, width: 12, height: 12, rx: 1.5, ...solid }]],
  "⏹": [["rect", { x: 6, y: 6, width: 12, height: 12, rx: 1.5, ...solid }]],
  "⏮": [["path", { d: "M18 5v14l-10-7z", ...solid }], ["path", { d: "M6 5v14" }]],
  "⏪": [["path", { d: "M12 6v12l-8-6z", ...solid }], ["path", { d: "M20 6v12l-8-6z", ...solid }]],
  "⏩": [["path", { d: "M12 6v12l8-6z", ...solid }], ["path", { d: "M4 6v12l8-6z", ...solid }]],
  "🔊": [["path", { d: "M4 9.5h3.5L12 5.5v13l-4.5-4H4z" }], ["path", { d: "M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" }]],
  "✨": [["path", { d: "M10 3.5l1.6 4.4 4.4 1.6-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6z" }],
    ["path", { d: "M17.5 13.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" }]],
  "✂": [["circle", { cx: 6, cy: 6, r: 2.5 }], ["circle", { cx: 6, cy: 18, r: 2.5 }], ["path", { d: "M8.2 7.3 20 17M8.2 16.7 20 7" }]],
  "⚙": [["circle", { cx: 12, cy: 12, r: 3 }], ["circle", { cx: 12, cy: 12, r: 6.5 }],
    ["path", { d: "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" }]],
  "⚠": [["path", { d: "M12 4 2.8 19.5h18.4z" }], ["path", { d: "M12 10v4.5M12 17v.01" }]],
  "👁": [["path", { d: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" }], ["circle", { cx: 12, cy: 12, r: 3 }]],
  "🙈": [["path", { d: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" }], ["path", { d: "M4 20 20 4" }]],
  "↩": [["path", { d: "M9 6 4 11l5 5" }], ["path", { d: "M4 11h10a5 5 0 0 1 0 10h-3" }]],
};

const PICK = new RegExp(`(${Object.keys(GLYPHS).join("|")})[︎️]?`, "gu");
// Where symbols become icons: buttons, and the 🔊 beside volume sliders.
const ON = "button, label.volume";
const ANY = new RegExp(Object.keys(GLYPHS).join("|"), "u");

// "▶ Play" → [{glyph: "▶"}, " Play"]: the text with each symbol picked out (and its emoji/text
// selector dropped). Text with none comes back as [text].
export function splitGlyphs(text) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(PICK)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push({ glyph: m[1] });
    at = m.index + m[0].length;
  }
  if (at < text.length || !out.length) out.push(text.slice(at));
  return out;
}

export function glyphIcon(glyph) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ico glyph");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of GLYPHS[glyph]) {
    const shape = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
    svg.append(shape);
  }
  return svg;
}

// Swaps the symbols in one text node for icons, if it's on a button.
function swapText(node) {
  if (!ANY.test(node.data) || !node.parentElement?.closest(ON)) return;
  const parts = splitGlyphs(node.data);
  node.replaceWith(...parts.map((p) => (typeof p === "string" ? p : glyphIcon(p.glyph))));
}

export function iconizeButtons(root = document.body) {
  if (root.nodeType === Node.TEXT_NODE) return swapText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => (ANY.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const found = [];
  while (walk.nextNode()) found.push(walk.currentNode);
  found.forEach(swapText);
}

// Keeps doing it as buttons are drawn and relabelled ("▶ Play" ↔ "⏸ Pause").
export function watchButtons(root = document.body) {
  iconizeButtons(root);
  new MutationObserver((changes) => {
    for (const c of changes) {
      if (c.type === "characterData") swapText(c.target);
      else c.addedNodes.forEach((n) => iconizeButtons(n));
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
