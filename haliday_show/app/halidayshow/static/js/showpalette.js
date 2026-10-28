// A show's own palette: new effects take its colours, and the effect chooser previews in them.
// Saved as show.palette = {name, colors}. The name is followed, so editing one of your palettes
// changes what the show uses; the colours are a copy, used if that palette is deleted.

// The show's palette, with today's colours: {name, colors}, or null when the show has none.
export function showPalette(show, palettes) {
  const p = show?.palette;
  if (!p || typeof p.name !== "string") return null;
  const now = palettes.find((q) => q.name === p.name);
  const colors = now?.colors?.length ? now.colors : Array.isArray(p.colors) ? p.colors : [];
  return colors.length ? { name: p.name, colors } : null;
}

// Sets (or, with null, clears) a show's palette.
export function setShowPalette(show, palette) {
  if (!palette) delete show.palette;
  else show.palette = { name: palette.name, colors: [...palette.colors] };
  return show;
}

// Keeps the saved copy of the colours up to date with the palette, so a deleted palette leaves the
// show with the colours it last had. Returns true when it changed anything.
export function refreshShowPalette(show, palettes) {
  const now = show?.palette && palettes.find((q) => q.name === show.palette.name);
  if (!now || JSON.stringify(now.colors) === JSON.stringify(show.palette.colors)) return false;
  show.palette.colors = [...now.colors];
  return true;
}
