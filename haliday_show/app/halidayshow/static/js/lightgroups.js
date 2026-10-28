// Light groups: lights and parts a show can give one effect, on their own lane in the Show editor
// (effects.js plays them). Saved with the settings as [{id, name, members: [light or part id]}].

// What can go in a group, in the Devices tab's order: each light, then (for a split light) each part,
// indented under it.
export function memberChoices(lights) {
  const out = [];
  for (const d of lights) {
    out.push({ id: d.id, label: d.name, part: false });
    for (const p of d.parts || []) out.push({ id: `${d.id}#${p.id}`, label: p.name, part: true, parent: d.id });
  }
  return out;
}

// Members still there, in the Devices tab's order, without a part whose whole light is in too.
export function tidyMembers(members, lights) {
  const want = new Set(members);
  const out = [];
  for (const c of memberChoices(lights)) {
    if (!want.has(c.id)) continue;
    if (c.part && want.has(c.parent)) continue;
    out.push(c.id);
  }
  return out;
}

// A group's members in words: "Icicles Left, Icicles Right" or "Pillars · Left and 3 more".
export function membersText(members, lights, max = 3) {
  const names = [];
  for (const c of memberChoices(lights)) {
    if (!members.includes(c.id)) continue;
    names.push(c.part ? `${lights.find((d) => d.id === c.parent).name} · ${c.label}` : c.label);
  }
  if (!names.length) return "No lights yet";
  return names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

// What each light brings to a group: [{light, n}], n being how many of its segments are in.
export function groupShares(members, lights) {
  const want = new Set(members), out = [];
  for (const d of lights) {
    let n = 0;
    if (!d.parts?.length) { if (want.has(d.id)) n = d.segments; }
    else for (const p of d.parts) if (want.has(d.id) || want.has(`${d.id}#${p.id}`)) n += p.to - p.from + 1;
    if (n) out.push({ light: d, n });
  }
  return out;
}

// How many segments a group's strip has.
export function groupSegments(members, lights) {
  const want = new Set(members);
  let n = 0;
  for (const d of lights) {
    if (!d.parts?.length) { if (want.has(d.id)) n += d.segments; continue; }
    for (const p of d.parts) if (want.has(d.id) || want.has(`${d.id}#${p.id}`)) n += p.to - p.from + 1;
  }
  return n;
}

export function nameProblem(groups, name, except = null) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return "Give the group a name";
  if (clean.length > 60) return "Keep the name to 60 letters or fewer";
  if (groups.some((g) => g.id !== except && g.name.toLowerCase() === clean.toLowerCase())) return `There's already a group called ${clean}`;
  return null;
}

// A new id from the name and the time, so a group made again with a deleted one's name doesn't pick
// up the effects still on the deleted one's lanes.
export function newGroupId(groups, name, now = Date.now()) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "group";
  let id = `${base}-${now.toString(36).slice(-6)}`;
  for (let k = 2; groups.some((g) => g.id === id); k++) id = `${base}-${now.toString(36).slice(-6)}-${k}`;
  return id;
}

// Whether an effect added to a selected stretch goes on track `kind` ("house", "group" or "light"),
// given the kinds in the selection: House effects go on the House lane, or on group lanes when the
// House lane isn't selected; light effects on lights, or on group lanes when no light is selected.
export function rangeTakes(house, kind, kinds) {
  if (kind === "house") return house;
  if (kind === "light") return !house;
  return house ? !kinds.includes("house") : !kinds.includes("light");
}
