// Moving the join between two back-to-back effects on a lane: the end of one and the start of the
// next go together, so no gap or overlap opens up. "Back to back" is the crossfade's own rule.
import { ADJACENT } from "./effects.js";

// The clip on the other side of `clip`'s `side` ("start" or "end") when the two touch, else null.
export function joinPartner(clips, clip, side) {
  return clips.find((c) => c !== clip && (side === "start"
    ? Math.abs(c.end - clip.start) < ADJACENT && c.start < clip.start
    : Math.abs(c.start - clip.end) < ADJACENT && c.end > clip.end)) || null;
}

// Puts the join between `left` and `right` at `t`, keeping both at least `min` seconds long.
export function moveJoin(left, right, t, min) {
  const at = Math.min(Math.max(t, left.start + min), right.end - min);
  left.end = at;
  right.start = at;
  return at;
}
