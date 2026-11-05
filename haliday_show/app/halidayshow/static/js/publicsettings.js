// Setup → More → Public page: the words around the settings, kept apart so they can be tested.

const mins = (s) => {
  const m = Math.max(1, Math.round(s / 60));
  return `${m} min`;
};

// Where to try the public page on your home Wi-Fi, from the address you open HA-liday Show on.
export function addressText(view, hostname) {
  if (view.error) return `The public page couldn't start: ${view.error}. Pick another port on the app's Configuration tab.`;
  if (!view.listening) return `The public page opens on port ${view.port} the first time you change a setting here.`;
  const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || /\.(local|lan|home|internal)$/.test(hostname)
    || !hostname.includes(".");
  const url = `http://${local ? hostname : "<your Home Assistant's address>"}:${view.port}`;
  return `The public page is on port ${view.port}. To try it on your phone over your home Wi-Fi, open ${url}`;
}

// What visitors have asked for.
export function queueText(view) {
  const parts = [];
  if (view.now) parts.push(`A visitor's show is on now: ${view.now}.`);
  if (view.waiting.length) {
    parts.push(`Waiting: ${view.waiting.map((w) => `${w.name} (in about ${mins(w.wait)})`).join(", ")}.`);
  }
  if (view.votes?.length) {
    parts.push(`Votes for what's next: ${view.votes.map((v) => `${v.name} (${v.count})`).join(", ")}.`);
  }
  if (!parts.length) return view.on ? (view.pick === "vote" ? "No votes yet." : "No visitors' shows waiting.") : "";
  return parts.join(" ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (s) => `${Number(s.slice(3))} ${MONTHS[Number(s.slice(0, 2)) - 1]}`;

// Whether a "MM-DD" range (coming round every year, over New Year if need be) includes a day.
export function inDates(item, todayIso) {
  if (!item.from) return true;
  const day = todayIso.slice(5, 10);
  return item.from <= item.to ? item.from <= day && day <= item.to : day >= item.from || day <= item.to;
}

// One line about when visitors can pick a show or playlist.
export function itemText(item, todayIso) {
  const kind = item.kind === "playlist" ? "Playlist" : "Show";
  if (!item.from) return `${kind} · all year`;
  const range = `${md(item.from)} to ${md(item.to)} every year`;
  return `${kind} · ${range} · ${inDates(item, todayIso) ? "visitors can pick it now" : `coming soon until ${md(item.from)}`}`;
}

// The link visitors open: your public address, or this machine on your home Wi-Fi, with the code.
export function visitorLink(view, hostname) {
  if (!view.code) return "";
  const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || /\.(local|lan|home|internal)$/.test(hostname)
    || !hostname.includes(".");
  const base = view.address || `http://${local ? hostname : "<your Home Assistant's address>"}:${view.port}`;
  return `${base}/?c=${view.code}`;
}

// What the nearby check measures from, or why it can't run.
export function nearbyText(view) {
  if (!view.nearby) return "Anyone with the link can start a show, wherever they are.";
  const from = view.home === "you" ? "the home location you typed in on the Schedule tab"
    : view.home === "ha" ? "your home location in Home Assistant" : "";
  if (!from) return "⚠ There's no home location to measure from, so visitors reaching the page through the internet can't start shows until you set one in Home Assistant (Settings → System → General). Your home Wi-Fi still works.";
  return `Phones reaching the page through the internet must be within ${view.distance} m of ${from}. On your home Wi-Fi they're not asked. Visitors' phones ask to share their location when the page opens, and only show Start once they're close enough.`;
}

// Ids of playlists with no show visitors could play (all archived, deleted or not saved yet).
export function emptyPlaylists(lists, liveShows) {
  return new Set(lists.filter((p) => !p.shows.some((s) => liveShows.has(s))).map((p) => p.id));
}

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const clock = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

// Opening hours for the sign, in a few words: "Shows from 5pm to 10pm, every day".
export function signHours(h) {
  if (!h?.on || !h.days?.length) return "";
  const from = h.start === "sunset" ? "dusk" : clock(h.start);
  const days = h.days.length === 7 ? "every day"
    : h.days.length === 5 && [0, 1, 2, 3, 4].every((d) => h.days.includes(d)) ? "weekdays"
      : h.days.length === 2 && h.days.includes(5) && h.days.includes(6) ? "weekends"
        : h.days.map((d) => DAY_SHORT[d]).join(", ").replace(/, ([^,]*)$/, " and $1");
  return `Shows from ${from} to ${clock(h.end)}, ${days}`;
}

// Tonight on the Queue tab: [label, value] rows from the view's tonight {picks, top, listening}.
export function tonightRows(t) {
  if (!t) return [];
  const rows = [["Picks", t.picks ? String(t.picks) : "None yet"],
    ["Listening on phones now", String(t.listening || 0)]];
  if (t.top?.length) rows.push(["Most picked", t.top.map((x) => `${x.name} (${x.count})`).join(", ")]);
  return rows;
}

// Dated looks (Look tab → Through the year). What a dated look can change; the rest stays everyday.
export const DATED_KEYS = ["title", "welcome", "picture", "theme", "mode", "colours", "snow", "spacing", "corners",
  "size", "borders"];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "look";

// A new dated look: a copy of your everyday look, from today for a month.
export function newDatedLook(view, name, todayIso) {
  const ids = new Set((view.looks || []).map((r) => r.id));
  let id = slug(name);
  for (let n = 2; ids.has(id); n++) id = `${slug(name)}-${n}`;
  const start = new Date(`${todayIso.slice(0, 10)}T00:00:00Z`);
  const end = new Date(start.getTime() + 30 * 86400000);
  const md2 = (d) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const look = Object.fromEntries(DATED_KEYS.map((k) => [k, structuredClone(view.look[k])]));
  return { id, name, from: md2(start), to: md2(end), look };
}

// The look visitors get on a day: the first dated look whose dates take it in, or null for the everyday one.
export function datedLookOn(view, todayIso) {
  return (view.looks || []).find((r) => inDates(r, todayIso)) || null;
}

// The look the Look tab edits: your everyday look, or a dated look laid over it.
export function lookFor(view, id) {
  const row = id && (view.looks || []).find((r) => r.id === id);
  return row ? { ...view.look, ...row.look } : view.look;
}

export function datedLookText(row, todayIso, view) {
  const on = datedLookOn(view, todayIso);
  const covered = on && on.id !== row.id && inDates(row, todayIso);
  return `${md(row.from)} to ${md(row.to)} every year${on?.id === row.id ? " · on now"
    : covered ? ` · ${on.name} is higher in the list, so that one shows` : ""}`;
}

export function todayLookText(view, todayIso) {
  const on = datedLookOn(view, todayIso);
  return on ? `Today visitors see ${on.name}.` : "Today visitors see your everyday look.";
}
