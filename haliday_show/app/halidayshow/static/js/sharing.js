// Sharing shows: Share, on a show's row, writes a .halidayshow file (the show's effects and a
// short description of each light it uses, with nothing private), and Import show reads one,
// suggests which of your lights plays each of theirs, and builds the tracks of a new show.
// The song never travels; only its name and length.

export const SHARE_FORMAT = "halidayshow";
export const SHARE_VERSION = 1; // later versions must keep importing version 1 files
export const SHARE_EXT = ".halidayshow";
const HOUSE = "@house";
const MAX_CLIPS = 50000, MAX_LIGHTS = 200;

// What kind of light a saved light is: `label` for people, `group` for matching like with like.
const GOVEE_GROUPS = [
  [/icicle/i, "icicle"], [/curtain/i, "curtain"], [/permanent|outdoor lights pro|eave/i, "permanent"],
  [/string|christmas|fairy/i, "string"], [/strip|rope|neon/i, "strip"], [/spot|flood|projector/i, "spot"],
  [/tree/i, "tree"], [/bar|lamp|bulb|wall|hexa|panel/i, "lamp"],
];
export function lightType(dev, model) {
  if (dev.kind === "wled") return { label: "WLED strip", group: "strip" };
  if (dev.kind === "ddp" || dev.kind === "e131") return { label: "Pixel lights", group: "strip" };
  if (dev.kind === "twinkly") return { label: "Twinkly lights", group: "string" };
  if (dev.kind === "ha") {
    const sw = dev.protocol === "ha_switch";
    return { label: sw ? "Home Assistant switch" : "Home Assistant light", group: sw ? "switch" : "ha" };
  }
  const name = model?.name || (dev.sku ? `Govee ${dev.sku}` : "Govee light");
  const group = GOVEE_GROUPS.find(([re]) => re.test(name))?.[1] || "govee";
  return { label: name, group };
}

// Where a light sits on the house photo, roughly: the box round its segments, 0 to 1 across and down.
export function whereOf(points) {
  const pts = (points || []).filter(Boolean);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const r = (v) => Math.round(v * 100) / 100;
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x: r(x), y: r(y), w: r(Math.max(...xs) - x), h: r(Math.max(...ys) - y) };
}

// The share file for `show`. `lights` is the Devices tab's list, `models` Govee models by SKU,
// `positions` each device or part id's segment positions on the house (as the House lane uses).
// Lights with no effects in the show are left out; so are tracks whose light has gone.
export function makeShare(show, lights, { models = {}, positions = {}, app = "" } = {}) {
  const byId = new Map(lights.map((d) => [d.id, d]));
  const used = new Map(); // light id -> key, in the order the show uses them
  const out = { lights: [], tracks: [] };
  const lightKey = (d) => {
    if (used.has(d.id)) return used.get(d.id);
    const key = `L${used.size + 1}`;
    used.set(d.id, key);
    const parts = (d.parts || []).map((p, i) => ({ key: `P${i + 1}`, id: p.id, name: p.name, from: p.from, to: p.to }));
    out.lights.push({ key, name: d.name, type: lightType(d, models[d.sku]), sku: d.kind === "govee" ? d.sku || "" : "",
      kind: d.kind || "govee", segments: d.segments, parts: parts.map(({ id, ...p }) => p),
      where: whereOf(positions[d.id]), _parts: parts });
    const level = show.lightBrightness?.[d.id];
    if (level != null && level !== 100) out.lights.at(-1).brightness = level;
    return key;
  };
  for (const tr of show.tracks || []) {
    if (!tr.clips?.length) continue;
    if (tr.device === HOUSE) { out.tracks.push({ house: true, clips: tr.clips }); continue; }
    const [id, pid] = String(tr.device).split("#");
    const d = byId.get(id);
    if (!d) continue;
    const key = lightKey(d);
    if (pid === undefined) { out.tracks.push({ light: key, clips: tr.clips }); continue; }
    const part = out.lights.find((l) => l.key === key)._parts.find((p) => p.id === pid);
    if (part) out.tracks.push({ light: key, part: part.key, clips: tr.clips });
  }
  for (const l of out.lights) delete l._parts;
  const song = show.audio?.path ? { name: songTitle(show.audio.path), length: round2(show.duration || 0) } : null;
  return {
    format: SHARE_FORMAT, version: SHARE_VERSION, app, name: show.name || "Shared show", song,
    fps: show.fps, duration: round2(show.duration || 60), tempo: show.tempo ?? null,
    beats: show.beats || [], bars: show.bars || [], sections: show.sections || [],
    lights: out.lights, tracks: out.tracks,
    // Show settings → Brightness, only when dimmed (older copies ignore it and play at 100%).
    ...(show.brightness != null && show.brightness !== 100 ? { brightness: show.brightness } : {}),
  };
}

const round2 = (v) => Math.round(Number(v) * 100) / 100;
export const songTitle = (path) => String(path).split("/").pop().replace(/\.[^.]+$/, "");
export const shareFileName = (name) => `${String(name).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "show"}${SHARE_EXT}`;

// A share file read back, checked, with anything odd left out. Throws an Error whose message can
// be shown as it is.
export function readShare(text) {
  let s;
  try { s = JSON.parse(text); } catch { throw new Error("That isn't a HA-liday Show file. Pick a file ending in .halidayshow"); }
  if (!s || typeof s !== "object" || s.format !== SHARE_FORMAT) {
    throw new Error("That isn't a HA-liday Show file. Pick a file ending in .halidayshow");
  }
  if (!Number.isInteger(s.version) || s.version < 1) throw new Error("That show file is damaged, so it can't be imported");
  if (s.version > SHARE_VERSION) throw new Error("That show was shared from a newer HA-liday Show. Update yours first, then import it");
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const text64 = (v, d = "") => (typeof v === "string" ? v.slice(0, 80) : d);
  const nums = (a) => (Array.isArray(a) ? a.filter((v) => Number.isFinite(v)) : []);
  // A brightness level, 1–100; anything else (or 100) is left out.
  const level = (v) => {
    const n = Math.round(Number(v));
    return v != null && Number.isFinite(n) && n < 100 ? Math.max(1, n) : undefined;
  };
  const lights = (Array.isArray(s.lights) ? s.lights : []).slice(0, MAX_LIGHTS)
    .filter((l) => l && typeof l.key === "string")
    .map((l) => ({
      key: l.key, name: text64(l.name, "Light"),
      type: { label: text64(l.type?.label, "Light"), group: text64(l.type?.group, "light") },
      sku: text64(l.sku), kind: text64(l.kind, "govee"), segments: Math.max(1, Math.round(num(l.segments, 1))),
      parts: (Array.isArray(l.parts) ? l.parts : []).filter((p) => p && typeof p.key === "string")
        .map((p) => ({ key: p.key, name: text64(p.name, "Part"), from: num(p.from, 1), to: num(p.to, 1) })),
      where: l.where && ["x", "y", "w", "h"].every((k) => Number.isFinite(l.where[k]))
        ? { x: l.where.x, y: l.where.y, w: l.where.w, h: l.where.h } : null,
      ...(level(l.brightness) ? { brightness: level(l.brightness) } : {}),
    }));
  const keys = new Set(lights.map((l) => l.key));
  let count = 0;
  const tracks = [];
  for (const t of Array.isArray(s.tracks) ? s.tracks : []) {
    if (!t || !Array.isArray(t.clips)) continue;
    if (!t.house && !keys.has(t.light)) continue;
    const clips = t.clips.filter((c) => c && typeof c === "object" && typeof c.effect === "string"
      && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
      .slice(0, Math.max(0, MAX_CLIPS - count));
    count += clips.length;
    tracks.push(t.house ? { house: true, clips } : { light: t.light, part: typeof t.part === "string" ? t.part : undefined, clips });
  }
  return {
    version: s.version, name: text64(s.name, "Shared show") || "Shared show",
    song: s.song && typeof s.song === "object" ? { name: text64(s.song.name), length: num(s.song.length) } : null,
    duration: Math.max(1, num(s.duration, 60)), tempo: Number.isFinite(s.tempo) ? s.tempo : null,
    beats: nums(s.beats), bars: nums(s.bars),
    sections: (Array.isArray(s.sections) ? s.sections : []).filter((x) => x && Number.isFinite(x.start) && Number.isFinite(x.end)),
    lights: lights.filter((l) => tracks.some((t) => t.light === l.key)), tracks,
    ...(level(s.brightness) ? { brightness: level(s.brightness) } : {}),
  };
}

// The imported show's Show settings → Brightness: theirs for the whole show, and each of their
// dimmed lights' level on the light of yours it's paired with. Where two of theirs share one of
// yours, the brighter level wins, so neither ends up darker than it was made.
export function shareLevels(share, plan) {
  const out = {};
  if (share.brightness) out.brightness = share.brightness;
  const per = {};
  for (const l of share.lights) {
    const mine = plan[l.key]?.light;
    if (!mine) continue;
    const level = l.brightness ?? 100;
    per[mine] = Math.max(per[mine] ?? 0, level);
  }
  for (const [id, level] of Object.entries(per)) if (level < 100) (out.lightBrightness ||= {})[id] = level;
  return out;
}

// Your lights as the match screen offers them. `whole: false` lights play their parts only.
export function myLights(lights, { models = {}, positions = {} } = {}) {
  return lights.filter((d) => !d.light).map((d) => ({
    id: d.id, name: d.name, type: lightType(d, models[d.sku]), sku: d.kind === "govee" ? d.sku || "" : "",
    kind: d.kind || "govee", segments: d.segments, whole: d.whole !== false || !d.parts?.length,
    parts: (d.parts || []).map((p) => ({ id: `${d.id}#${p.id}`, name: p.name })),
    where: whereOf(positions[d.id]),
  }));
}

const words = (s) => String(s || "").toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "").split(/[^a-z0-9]+/).filter(Boolean);
function likeness(a, b) {
  const x = new Set(words(a)), y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / new Set([...x, ...y]).size;
}

// How well one of your lights suits one of theirs, and the reasons, best first.
export function score(theirs, mine) {
  let s = 0;
  const why = [];
  if (theirs.sku && theirs.sku === mine.sku) { s += 5; why.push("same model"); }
  else if (theirs.type.group === mine.type.group) { s += 3; why.push("same kind"); }
  else if (theirs.kind === mine.kind) s += 1;
  if (theirs.where && mine.where) {
    const c = (w) => [w.x + w.w / 2, w.y + w.h / 2];
    const [a, b] = [c(theirs.where), c(mine.where)];
    const near = Math.max(0, 1 - Math.hypot(a[0] - b[0], a[1] - b[1]) / 0.5);
    s += 3 * near;
    if (near > 0.6) why.push("same spot on the house");
  }
  if (theirs.parts.length && theirs.parts.length === mine.parts.length) {
    s += 2;
    why.push(`${mine.parts.length} parts each`);
  }
  const size = Math.min(theirs.segments, mine.segments) / Math.max(theirs.segments, mine.segments);
  s += 2 * size;
  if (size > 0.8 && why.length < 2) why.push("similar size");
  if (likeness(theirs.name, mine.name) >= 0.5) { s += 2; why.unshift("same name"); }
  return { score: s, why };
}

// Which of their parts plays on which of yours: in order when you have the same number (or by
// name), on the whole light when yours has no parts, and left out (null) when you run out.
export function partPlan(theirs, mine) {
  const plan = {};
  if (!mine) return plan;
  if (!mine.parts.length) {
    for (const p of theirs.parts) plan[p.key] = "whole";
    return plan;
  }
  const free = [...mine.parts];
  const take = (p) => { free.splice(free.indexOf(p), 1); return p.id; };
  if (theirs.parts.length !== mine.parts.length) {
    for (const p of theirs.parts) {
      const same = free.find((m) => likeness(m.name, p.name) >= 0.5);
      if (same) plan[p.key] = take(same);
    }
  }
  for (const p of theirs.parts) if (!(p.key in plan)) plan[p.key] = free.length ? take(free[0]) : null;
  return plan;
}

// The suggested pairing for every light in the share: {key: {light: your id or null, why, parts}}.
// Each of your lights is suggested once, best match first; poor matches are left out.
export function suggest(theirs, mine) {
  const pairs = [];
  for (const t of theirs) for (const m of mine) pairs.push({ t, m, ...score(t, m) });
  pairs.sort((a, b) => b.score - a.score);
  const plan = Object.fromEntries(theirs.map((t) => [t.key, { light: null, why: "", parts: {} }]));
  const taken = new Set();
  for (const p of pairs) {
    if (p.score < 3.5 || plan[p.t.key].light || taken.has(p.m.id)) continue;
    taken.add(p.m.id);
    plan[p.t.key] = { light: p.m.id, why: p.why.slice(0, 2).join(", "), parts: partPlan(p.t, p.m) };
  }
  return plan;
}

// The new show's tracks from the share and the pairings. Effects that end up on one light are put
// in time order, so where two of theirs share one of yours and play at once, the later one shows.
// `fits(effect, house)` says whether this copy knows an effect and it goes on that lane: a file
// from a newer HA-liday Show can hold effects this one hasn't got, and those are left out.
export function buildTracks(share, plan, mine, fits = () => true) {
  const byId = new Map(mine.map((m) => [m.id, m]));
  const out = new Map([[HOUSE, []]]);
  let dropped = 0;
  const put = (id, clips) => {
    if (!out.has(id)) out.set(id, []);
    const ok = clips.filter((c) => fits(c.effect, id === HOUSE));
    dropped += clips.length - ok.length;
    out.get(id).push(...ok.map((c) => JSON.parse(JSON.stringify(c))));
  };
  // A light that plays its parts only has no track of its own that plays: its parts take it instead.
  const wholeOf = (m) => (m.whole ? [m.id] : m.parts.map((p) => p.id));
  for (const t of share.tracks) {
    if (t.house) { put(HOUSE, t.clips); continue; }
    const p = plan[t.light];
    const m = p?.light && byId.get(p.light);
    if (!m) continue;
    const to = t.part === undefined ? "whole" : p.parts?.[t.part];
    if (!to) continue;
    for (const id of to === "whole" ? wholeOf(m) : [to]) put(id, t.clips);
  }
  for (const clips of out.values()) clips.sort((a, b) => a.start - b.start);
  return { tracks: [...out].map(([device, clips]) => ({ device, clips })), dropped };
}

export function matchCount(share, plan) {
  const matched = share.lights.filter((l) => plan[l.key]?.light).length;
  return { matched, left: share.lights.length - matched, total: share.lights.length };
}

// Your song that looks most like the shared one, by name, or null.
export function suggestSong(name, refs) {
  let best = null, bestScore = 0;
  for (const ref of refs) {
    const s = likeness(name, songTitle(ref.path));
    if (s > bestScore) { best = ref; bestScore = s; }
  }
  return bestScore >= 0.5 ? best : null;
}

// What to say about your song's length against the shared one's (seconds).
export function lengthNote(theirs, yours) {
  if (!theirs || !yours) return null;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  if (Math.abs(theirs - yours) <= 1.5) return { ok: true, text: `the same length as theirs (${fmt(yours)})` };
  return { ok: false, text: `Yours is ${fmt(yours)} and theirs was ${fmt(theirs)}, so the effects may not line up. You can move them in the editor` };
}
