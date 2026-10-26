// Colour sums for "Your own colours": readability (WCAG contrast) and what goes on the buttons.
// Used by the visitors' page and by the editor's readability check, so both agree.

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// The same mix as the page's CSS (color-mix in srgb): `part` of a, the rest b.
export const mix = (a, b, part) => hex(rgb(a).map((v, i) => v * part + rgb(b)[i] * (1 - part)));

// Black or white words, whichever reads better on a colour.
export const bestOn = (bg) => (contrast("#ffffff", bg) >= contrast("#111111", bg) ? "#ffffff" : "#111111");

// Pairs that are hard to read (under 4.5:1), in words, for the editor to warn about.
export function readability(c) {
  const hints = mix(c.text, c.bg, 0.72);
  const pairs = [
    ["Text on the background", c.text, c.bg],
    ["Text on cards", c.text, c.panel],
    ["Headings on the background", c.head, c.bg],
    ["Small print on cards", hints, c.panel],
    ["Words on buttons", bestOn(c.accent), c.accent],
  ];
  return pairs.map(([what, fg, bg]) => ({ what, ratio: contrast(fg, bg) }))
    .filter((p) => p.ratio < 4.5)
    .map((p) => `${p.what} is hard to read (${p.ratio.toFixed(1)}:1; aim for 4.5:1 or more).`);
}

export const DEFAULT_COLOURS = { bg: "#0f1a14", panel: "#16241c", text: "#eef4ef", head: "#ffd36b", accent: "#c62828" };
