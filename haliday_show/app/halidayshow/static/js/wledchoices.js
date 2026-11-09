// Which of a WLED's own effects (and palettes) to offer in the WLED effect window, and how: from the names the WLED
// gives (by number, reserved ones blank), Solid first then A to Z, split into those the preview draws
// as the WLED does (wled-effects/) and those it can only hint at (2D and sound-reactive ones).

import { isPorted } from "./wled-effects/index.js";

export function wledEffectChoices(names, find = "") {
  const q = find.trim().toLowerCase();
  const all = (names || [])
    .map((name, id) => ({ id, name: typeof name === "string" ? name.trim() : "" }))
    .filter((e) => e.name && (!q || e.name.toLowerCase().includes(q)))
    .sort((a, b) => (a.id === 0 ? -1 : b.id === 0 ? 1 : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
  return { drawn: all.filter((e) => isPorted(e.id)), rough: all.filter((e) => !isPorted(e.id)) };
}

// A WLED's palettes in the order WLED lists them: Default, then those made from your colours ("* Color 1"
// and so on), then the rest A to Z.
export function wledPaletteChoices(names, find = "") {
  const q = find.trim().toLowerCase();
  const rank = (e) => (e.id === 0 ? 0 : e.name.startsWith("*") ? 1 : 2);
  return (names || [])
    .map((name, id) => ({ id, name: typeof name === "string" ? name.trim() : "" }))
    .filter((e) => e.name && (!q || e.name.toLowerCase().includes(q)))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? a.id - b.id : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
}
