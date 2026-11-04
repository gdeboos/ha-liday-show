// The visitors' page's icons: simple line drawings in the button's own colour, in place of emoji
// (which look different on every phone and clash with the themes).
const NS = "http://www.w3.org/2000/svg";

// Each icon: its shapes on a 24 × 24 grid. A shape with "fill" is solid; the rest are 2 px lines.
const ICONS = {
  play: [["path", { d: "M7 4.5v15l12.5-7.5z", fill: true }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  check: [["path", { d: "M5 12.5l4.5 4.5L19 7.5" }]],
  music: [["path", { d: "M9 18V5.5l11-2v12.5" }], ["circle", { cx: 6.5, cy: 18, r: 2.5 }], ["circle", { cx: 17.5, cy: 16, r: 2.5 }]],
  clock: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 7v5l3 2" }]],
  headphones: [["path", { d: "M3.5 18v-6a8.5 8.5 0 0 1 17 0v6" }],
    ["path", { d: "M20.5 18.5a2 2 0 0 1-2 2h-1v-6h3zM3.5 18.5a2 2 0 0 0 2 2h1v-6h-3z" }]],
  soundoff: [["path", { d: "M11 5L6.5 9H3v6h3.5l4.5 4z" }], ["path", { d: "M16 9.5l5 5M21 9.5l-5 5" }]],
  stop: [["rect", { x: 6, y: 6, width: 12, height: 12, rx: 1.5, fill: true }]],
  skip: [["path", { d: "M5 5l10 7-10 7z", fill: true }], ["path", { d: "M19 5v14" }]],
  install: [["path", { d: "M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M5 20h14" }]],
  left: [["path", { d: "M15 18l-6-6 6-6" }]],
  right: [["path", { d: "M9 18l6-6-6-6" }]],
  x: [["path", { d: "M17.5 6.5l-11 11M6.5 6.5l11 11" }]],
  lock: [["rect", { x: 5, y: 11, width: 14, height: 9.5, rx: 2 }], ["path", { d: "M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11" }]],
  unlock: [["rect", { x: 5, y: 11, width: 14, height: 9.5, rx: 2 }], ["path", { d: "M8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2" }]],
  again: [["path", { d: "M20 12a8 8 0 1 1-2.3-5.6M20 4.5v4h-4" }]],
};

export const ICON_NAMES = Object.keys(ICONS);

export function icon(name) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "pp-ico");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of ICONS[name] || []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (k !== "fill") el.setAttribute(k, String(v));
    if (attrs.fill) el.setAttribute("class", "pp-ico-fill");
    svg.append(el);
  }
  return svg;
}

// Words for a button, without an emoji or symbol at either end: the icon stands in for it, so words
// you typed with one (as the page's own once had) don't show both.
export const bare = (text) => String(text || "").replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}.?!)…]+$/u, "").trim();

// A button's icon and words; with after, the icon goes after them (Later ▶).
export function label(button, name, text, after = false) {
  const words = document.createElement("span");
  words.textContent = bare(text);
  const ico = name ? icon(name) : null;
  button.replaceChildren(...(ico ? (after ? [words, ico] : [ico, words]) : [words]));
  button.classList.toggle("pp-has-ico", !!ico);
  return button;
}
