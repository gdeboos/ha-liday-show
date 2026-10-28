// What a light's colour cells are called on screen. Saved lights keep `segments` for every kind, but
// only Govee lights really have segments: on WLED, DDP, E1.31 and Twinkly each one is an LED, and a
// Home Assistant light is one colour.
const PIXEL_KINDS = ["wled", "ddp", "e131", "twinkly"];
export const isPixels = (d) => PIXEL_KINDS.includes(d?.kind);
export const isHa = (d) => d?.kind === "ha";

export const unitWord = (d, n = 2) => (isPixels(d) ? (n === 1 ? "LED" : "LEDs") : n === 1 ? "segment" : "segments");
// "400 LEDs", "15 segments" or "one colour".
export const countText = (d, n = d.segments) => (isHa(d) ? "one colour" : `${n} ${unitWord(d, n)}`);
// The heading over the count, and a part's stretch: "LEDs 1–150".
export const countLabel = (d) => (isPixels(d) ? "LEDs" : "Segments");
export const rangeText = (d, from, to) => `${countLabel(d)} ${from}–${to}`;

// Bulbs only means something apart from the count on Govee lights. Elsewhere it's hidden, unless it
// was set to something else, so nothing set is out of sight.
export const showBulbs = (d) => (!isPixels(d) && !isHa(d)) || (d.bulbs != null && d.bulbs !== d.segments);

// A group's size in words, from its members' lights and the cells each brings.
export function sizeText(shares) {
  let leds = 0, segs = 0, ones = 0;
  for (const { light, n } of shares) {
    if (isHa(light)) ones++;
    else if (isPixels(light)) leds += n;
    else segs += n;
  }
  const bits = [];
  if (leds) bits.push(`${leds} ${leds === 1 ? "LED" : "LEDs"}`);
  if (segs) bits.push(`${segs} ${segs === 1 ? "segment" : "segments"}`);
  if (ones) bits.push(`${ones} one-colour ${ones === 1 ? "light" : "lights"}`);
  if (!bits.length) return "";
  return bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(", ")} and ${bits.at(-1)}`;
}
