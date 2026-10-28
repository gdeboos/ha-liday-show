// Finding Home Assistant lights and switches to add (the Add a light window). A house can have
// hundreds, many of them switches that have nothing to do with lights, so they're sorted into
// kinds and found by typing.
export const HA_KINDS = [
  { id: "colour", label: "Colour lights", one: "Colour light" },
  { id: "light", label: "Other lights", one: "Light" },
  { id: "switch", label: "Switches", one: "Switch" },
];

export const haKind = (e) => (e.entity.startsWith("switch.") ? "switch" : e.colour ? "colour" : "light");

// The entities matching every typed word (in the name or the entity id) and the kind ("" for all):
// colour lights first, then other lights, then switches, each by name.
export function findEntities(list, query = "", kind = "") {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const order = (e) => HA_KINDS.findIndex((k) => k.id === haKind(e));
  return list
    .filter((e) => (!kind || haKind(e) === kind)
      && words.every((w) => `${e.name} ${e.entity}`.toLowerCase().includes(w)))
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

// How many of each kind there are, for the filter's labels.
export function kindCounts(list) {
  const out = { "": list.length };
  for (const k of HA_KINDS) out[k.id] = 0;
  for (const e of list) out[haKind(e)]++;
  return out;
}
