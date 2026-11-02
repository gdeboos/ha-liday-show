// Seasons: props that only go up for part of the year (see seasons.py, which decides the same way).
// A light's `seasons` are season ids; none means all year. A light is packed away when every season
// it's in (that still exists) is packed away.

export function awayIds(devices, seasons) {
  const out = new Map((seasons || []).map((s) => [s.id, s.out]));
  const gone = new Set();
  for (const d of devices || []) {
    const mine = (d.seasons || []).filter((t) => out.has(t));
    if (mine.length && !mine.some((t) => out.get(t))) gone.add(d.id);
  }
  return gone;
}

// A light's seasons by name, in the seasons' order, for its row on the Devices tab.
export const seasonNames = (d, seasons) => (seasons || []).filter((s) => (d.seasons || []).includes(s.id)).map((s) => s.name).join(", ");

const slug = (name) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "season";

export function newSeason(seasons, name) {
  const clean = name.split(/\s+/).filter(Boolean).join(" ").slice(0, 40);
  const ids = new Set(seasons.map((s) => s.id));
  let id = slug(clean);
  for (let n = 2; ids.has(id); n++) id = `${slug(clean).slice(0, 36)}-${n}`;
  return { id, name: clean, out: true };
}
