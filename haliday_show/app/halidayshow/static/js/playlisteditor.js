// The Playlist editor's sums: where a dragged show lands, how long the playlist runs and what each
// row of Your playlists says. Worked out here, without the page, so they can be tested.

import { describeSchedule } from "./schedule.js";
import { length } from "./showlist.js";

export const MAX_SHOWS = 100; // as playlists.py keeps

// The running order with the show at `from` moved so it lands before what's now at `to` (0 to
// the list's length; the length puts it last). A new list; the one given isn't changed.
export function moved(list, from, to) {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to > from ? to - 1 : to, out.length)), 0, x);
  return out;
}

// The running order with show `id` put in before position `at` (or last), unless it's full.
export function inserted(list, id, at = list.length, max = MAX_SHOWS) {
  if (list.length >= max) return [...list];
  const out = [...list];
  out.splice(Math.max(0, Math.min(at, out.length)), 0, id);
  return out;
}

// Where a drop at `y` lands among cards whose middles are at `mids` (top to bottom): before the
// first card it's above the middle of, else last.
export function dropIndex(mids, y) {
  const k = mids.findIndex((m) => y < m);
  return k === -1 ? mids.length : k;
}

// What plays: each show's place on the playlist's strip, as fractions of one time round. Shows that
// won't play (not saved, archived or deleted) are left out, as the player skips them, and the pause
// comes after every show, the last too, as it does before going back to the top.
export function strip(ids, byId, gap) {
  const playing = ids.map((id, k) => ({ id, k, show: byId[id] })).filter((x) => x.show?.baked);
  const total = playing.reduce((t, x) => t + Math.max(0, x.show.duration || 0) + gap, 0);
  let at = 0;
  const blocks = playing.map((x) => {
    const len = Math.max(0, x.show.duration || 0);
    const b = { id: x.id, k: x.k, name: x.show.name, start: total ? at / total : 0, width: total ? len / total : 0 };
    at += len + gap;
    return b;
  });
  return { seconds: total, playing: playing.length, blocks };
}

// "3 shows · 12:40 each time round", with why any won't play.
export function summary(ids, byId, gap) {
  const s = strip(ids, byId, gap);
  if (!ids.length) return "No shows yet";
  const skipped = ids.length - s.playing;
  const shows = `${ids.length} show${ids.length === 1 ? "" : "s"}`;
  if (!s.playing) return `${shows}, none saved yet, so nothing plays`;
  return `${shows} · ${length(s.seconds)} each time round${skipped ? ` · ${skipped} skipped` : ""}`;
}

// The rows of Your playlists, in the order they're kept (which decides which goes first when two
// schedules overlap).
export function playlistRows(playlists, shows) {
  const byId = Object.fromEntries(shows.map((x) => [x.id, x]));
  return playlists.map((p) => ({
    id: p.id,
    name: p.name,
    details: [summary(p.shows, byId, p.gap), p.schedule?.on ? `plays ${describeSchedule(p.schedule)}` : "plays when you press Play"].join(" · "),
    playable: p.shows.some((id) => byId[id]?.baked),
  }));
}
