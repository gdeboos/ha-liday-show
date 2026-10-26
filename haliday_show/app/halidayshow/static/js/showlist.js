// Your shows: the list the Show editor opens on, also under Library → Shows. The rows are worked
// out here, without the page, so they can be tested; app.js draws them and wires the buttons.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n) => String(n).padStart(2, "0");

export function length(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${two(s % 60)}`;
}

// "just now", "5 minutes ago", "today 08:14", "yesterday 17:30", "12 Oct", "12 Oct 2025".
export function changed(when, now = new Date()) {
  const d = new Date(when * 1000), mins = (now - d) / 60000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)} minute${Math.floor(mins) === 1 ? "" : "s"} ago`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86400000);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`}`;
}

export const songName = (path) => (path ? path.split("/").pop().replace(/\.[^.]+$/, "") : null);

// shows as the server lists them ({id, name, duration, song, modified}), newest change first, each
// with what the row says. `last` is the show this browser last had open.
export function showRows(shows, last, now = new Date()) {
  return [...shows]
    .sort((a, b) => (b.modified || 0) - (a.modified || 0) || a.name.localeCompare(b.name))
    .map((s) => ({
      id: s.id,
      name: s.name,
      last: s.id === last,
      details: [songName(s.song) || "No song yet", length(s.duration), `changed ${changed(s.modified, now)}`].join(" · "),
    }));
}

// A name for a copy that isn't taken: "Xmas copy", then "Xmas copy 2"…
export function copyName(name, taken) {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  const base = `${name.replace(/ copy(?: \d+)?$/, "")} copy`;
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}
