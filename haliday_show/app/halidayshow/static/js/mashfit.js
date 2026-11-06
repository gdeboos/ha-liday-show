// How well one song fits over another, for mashups in the Music editor: how much its tempo and key
// would have to change to sit with the other's (as a layer matching them would), and a word for it.
// Also lining a clip's bars up with the song's. Pure, so it can be tested in node.

import { keyShift } from "./analysis.js";
import { speedFor } from "./tempo.js";

export const FITS = {
  great: "Great fit",
  good: "Good fit",
  change: "Fits with a change",
  big: "Big change",
};

// over: {tempo, key} of the song that would be layered on; under: the song it goes over. Returns
// {speed (how much faster it plays, 1 = as it is), semis (moved up or down), fit (a FITS key),
// tempo: words, key: words}. Missing tempos or keys count as fitting, and say so.
export function mashFit(over, under) {
  const speed = over?.tempo && under?.tempo ? speedFor(under.tempo, over.tempo) : 1;
  const semis = over?.key && under?.key ? keyShift(over.key, under.key) : 0;
  const change = Math.abs(speed - 1);
  const fit = change <= 0.03 && Math.abs(semis) <= 0 ? "great"
    : change <= 0.08 && Math.abs(semis) <= 2 ? "good"
      : change <= 0.12 && Math.abs(semis) <= 5 ? "change" : "big";
  // How its tempo compares: in BPM when it's played as it is, else as a change (half or double time).
  const direct = over?.tempo && under?.tempo && Math.abs(speed - under.tempo / over.tempo) < 1e-3;
  const diff = direct ? Math.round(Math.abs(under.tempo - over.tempo)) : 0;
  const tempo = !over?.tempo || !under?.tempo ? "tempo not known yet"
    : change < 0.005 || (direct && !diff) ? "same tempo"
      : direct ? `${diff} BPM ${over.tempo < under.tempo ? "slower" : "faster"}`
        : `${Math.round(change * 1000) / 10}% ${speed > 1 ? "slower" : "faster"}, at ${over.tempo < under.tempo ? "double" : "half"} time`;
  const key = !over?.key || !under?.key ? "key not known yet"
    : !semis ? (sameKey(over.key, under.key) ? "same key" : `${under.key}, fits ${over.key}`)
      : `moved ${semis > 0 ? "up" : "down"} ${Math.abs(semis)} semitone${Math.abs(semis) === 1 ? "" : "s"} into ${under.key}`;
  return { speed, semis, fit, tempo, key };
}

const sameKey = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Songs ranked by how well each fits over (or under) `target` ({tempo, key}): [{song, ...mashFit}],
// best first, then by name.
export function rankFits(songs, target, infoOf) {
  const order = Object.keys(FITS);
  return songs.map((song) => ({ song, ...mashFit(infoOf(song), target) }))
    .sort((a, b) => order.indexOf(a.fit) - order.indexOf(b.fit) || Math.abs(a.speed - 1) + Math.abs(a.semis) / 12 - (Math.abs(b.speed - 1) + Math.abs(b.semis) / 12));
}

// Where a clip should start (result seconds) so its first bar lands on the song's nearest bar: `at` is
// where it would start, clip {start, end} the part of its song it plays (that song's seconds), speed how
// fast it plays, clipBars its song's bars and songBars the song's (result seconds). `at` as it is if
// either has no bars.
export function lineUpOnBar(at, clip, speed, clipBars, songBars) {
  const first = (clipBars || []).find((b) => b >= clip.start - 1e-6 && b < clip.end);
  if (first == null || !songBars?.length) return at;
  const off = (first - clip.start) / speed, beat = at + off;
  let near = songBars[0];
  for (const b of songBars) if (Math.abs(b - beat) < Math.abs(near - beat)) near = b;
  return Math.max(0, near - off);
}
