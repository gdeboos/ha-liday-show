// What each effect is like, for the effect window's filters: how it moves (Moving, Sparkles and
// twinkles, Flashing, Steady), whether it's colourful, and its mood (Calm or Lively). Worked out here
// without the page, so it can be tested.

const TAGS = {
  housecolour: "colours", solid: "still calm", duo: "still calm", trio: "still calm", pulse: "calm", gradient: "still calm",
  cycle: "colours calm", fade: "calm", strobe: "flashes lively",
  chase: "moves lively", rainbow: "moves colours lively", comet: "moves lively", scanner: "moves",
  wipe: "moves", theatre: "moves lively", juggle: "moves colours lively", ripple: "moves lively",
  dissolve: "sparkles lively", bounce: "moves lively", lighthouse: "moves calm", tetris: "moves lively",
  level: "moves", morph: "moves colours",
  flicker: "sparkles calm", lightning: "flashes lively", twinkle: "sparkles calm", eyes: "sparkles",
  fireworks: "sparkles flashes colours lively", drip: "moves calm", candles: "sparkles calm",
  snow: "moves sparkles calm", fairy: "sparkles colours calm",
  ocean: "moves calm", aurora: "moves colours calm", flow: "moves colours calm", sunrise: "calm",
  sweep: "moves lively", housewipe: "moves", wave: "moves colours", shockwave: "moves flashes lively",
  pinwheel: "moves lively", curtain: "moves", butterfly: "moves calm", housesolid: "still calm",
  housegradient: "still calm", housestripes: "still", plasma: "moves colours", spiral: "moves lively",
  housechecks: "still", housewave: "moves colours calm", housesparkle: "sparkles", spotlight: "moves",
  housedots: "still",
  text: "moves", picture: "still", fire2d: "moves lively", snowfall: "moves calm",
  vumeter: "music lively", musicbars: "music lively",
  levelmeter: "music lively", beatburst: "music flashes lively", spectrum: "music lively",
};

// The filters, in the order they're offered: [tag, label, what it means].
export const FILTERS = [
  ["moves", "Moving", "Light that travels along the light"],
  ["sparkles", "Sparkles and twinkles", "Bulbs that twinkle, flicker or sparkle on their own"],
  ["flashes", "Flashing", "Sudden flashes: strobes, lightning, bursts"],
  ["still", "Steady", "Colours that stay put"],
  ["colours", "Colourful", "Lots of colours at once, or colours that keep changing"],
  ["calm", "Calm", "Slow and gentle"],
  ["lively", "Lively", "Fast and bright"],
  ["music", "Follows the music", "Moves with the song's loudness or beat"],
];

// An effect's tags. Effects not listed (one of a WLED's own) have none and only show unfiltered.
export function tagsOf(key, fx = {}) {
  const tags = new Set((TAGS[key] || "").split(" ").filter(Boolean));
  if (fx.music || fx.live) tags.add("music");
  return tags;
}

// Whether an effect is shown: it has every tag picked, and its name has every word typed.
export function matches(key, fx, picked = [], find = "") {
  const tags = tagsOf(key, fx);
  if (!picked.every((t) => tags.has(t))) return false;
  const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const name = `${fx.label || key}`.toLowerCase();
  return words.every((w) => name.includes(w));
}
