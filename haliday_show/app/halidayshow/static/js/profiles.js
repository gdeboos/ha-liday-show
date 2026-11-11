// Profiles (profiles.py on the server): the lights you have now, and plans for next year. Each has its
// own lights list, house photo and tracing, groups and roles; shows are shared. The editor looks at one
// profile at a time (kept per browser); only the live one is baked and played.

// The routes that are about one profile. Everything else is the same in every profile.
export const PROFILE_PATHS = ["api/devices", "api/house", "api/house/photo", "api/light-groups", "api/light-roles"];

// `path` asked about profile `pid` (none: the live one, as the server takes it).
export function withProfile(path, pid) {
  if (!pid) return path;
  const at = path.indexOf("?");
  const base = at < 0 ? path : path.slice(0, at);
  if (!PROFILE_PATHS.includes(base)) return path;
  const q = new URLSearchParams(at < 0 ? "" : path.slice(at + 1));
  q.set("profile", pid);
  return `${base}?${q}`;
}

// The profile this browser looks at: the one picked, if it still exists, else the live one.
export function pickedProfile(view, picked) {
  if (!view?.profiles?.length) return null;
  return view.profiles.some((p) => p.id === picked) ? picked : view.live;
}

export const isPlan = (view, pid) => !!view && !!pid && pid !== view.live;

// Lanes that belong to another profile: a track for a light (or a part of one, "light#part") that's in
// another profile but not this one, or for a group only another profile has. They're hidden, never
// deleted, so switching back shows them again.
export function elsewhere(view, pid) {
  const out = new Set();
  if (!view?.profiles || view.profiles.length < 2) return out;
  const here = view.profiles.find((p) => p.id === pid);
  if (!here) return out;
  const mine = new Set(here.lights), myGroups = new Set(here.groups || []);
  for (const p of view.profiles) {
    if (p === here) continue;
    for (const id of p.lights) if (!mine.has(id)) out.add(id);
    for (const g of p.groups || []) if (!myGroups.has(g)) out.add(`group:${g}`);
  }
  return out;
}

// Whether a track (its device id) is one of those lanes. `groupPrefix` is how group lanes are named.
export function onlyElsewhere(device, hidden, groupPrefix = "@group:") {
  if (!hidden.size || !device) return false;
  if (device.startsWith(groupPrefix)) return hidden.has(`group:${device.slice(groupPrefix.length)}`);
  return hidden.has(device.split("#")[0]);
}

// What Make this the live one says before it does it.
export function liveWarning(view, pid) {
  const p = view.profiles.find((x) => x.id === pid);
  const was = view.profiles.find((x) => x.live);
  if (!p || !was) return "";
  const gone = was.lights.filter((id) => !p.lights.includes(id)).length;
  const added = p.lights.filter((id) => !was.lights.includes(id)).length;
  const bits = [];
  if (added) bits.push(`${added} light${added === 1 ? "" : "s"} only in ${p.name} start${added === 1 ? "s" : ""} playing`);
  if (gone) bits.push(`${gone} light${gone === 1 ? "" : "s"} only in ${was.name} stop${gone === 1 ? "s" : ""}`);
  return `Make ${p.name} the live one? Shows, schedules and the visitors' page then play on its lights and house.`
    + (bits.length ? ` ${bits.join(", and ")}.` : "")
    + ` Your shows are saved again for its lights in the background, which can take a few minutes. ${was.name} stays as it is, so you can switch back.`;
}
