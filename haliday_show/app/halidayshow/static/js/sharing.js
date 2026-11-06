// Sharing shows: Share, on a show's row, writes a .halidayshow file (the show's effects and a
// short description of each light it uses, with nothing private), and Import show reads one,
// suggests which of your lights plays each of theirs, and builds the tracks of a new show.
// The song never travels; only its name and length.

import { MAX_MATRIX, gridOf } from "./matrix.js";
import { isRectPart } from "./parts.js";
import { cleanRecipe } from "./faces.js";

export const SHARE_FORMAT = "halidayshow";
// Version 2 adds the pictures a show's Picture effects use; a show without any is still written as 1,
// so older copies can import it. Later versions must keep importing version 1 and 2 files.
export const SHARE_VERSION = 2;
const MAX_SHARED_PICTURES = 20, MAX_SHARED_FACES = 20;
export const SHARE_EXT = ".halidayshow";
const HOUSE = "@house";
const PHONES = "@phones"; // phones.js: the Phones lane, which plays on visitors' phones
const MAX_CLIPS = 50000, MAX_LIGHTS = 200;

// What kind of light a saved light is: `label` for people, `group` for matching like with like.
const GOVEE_GROUPS = [
  [/icicle/i, "icicle"], [/curtain/i, "curtain"], [/permanent|outdoor lights pro|eave/i, "permanent"],
  [/string|christmas|fairy/i, "string"], [/strip|rope|neon/i, "strip"], [/spot|flood|projector/i, "spot"],
  [/tree/i, "tree"], [/bar|lamp|bulb|wall|hexa|panel/i, "lamp"],
];
export function lightType(dev, model) {
  if (dev.kind === "wled") return { label: gridOf(dev) ? "WLED matrix" : "WLED strip", group: "strip" };
  if (dev.kind === "ddp" || dev.kind === "e131") return { label: gridOf(dev) ? "Pixel matrix" : "Pixel lights", group: "strip" };
  if (dev.kind === "twinkly") return { label: "Twinkly lights", group: "string" };
  if (dev.kind === "ha") {
    const sw = dev.protocol === "ha_switch";
    return { label: sw ? "Home Assistant switch" : "Home Assistant light", group: sw ? "switch" : "ha" };
  }
  const name = model?.name || (dev.sku ? `Govee ${dev.sku}` : "Govee light");
  const group = GOVEE_GROUPS.find(([re]) => re.test(name))?.[1] || "govee";
  return { label: name, group };
}

// A matrix as a share file and the match screen describe it: its size and whether it's a mega-tree.
// shapeOf(id) gives "tree" or "panel" (the house photo's style).
const matrixOf = (d, shapeOf) => {
  const g = gridOf(d);
  return g ? { w: g.w, h: g.h, shape: shapeOf(d.id) === "tree" ? "tree" : "panel" } : null;
};
const gridWords = (m) => `${m.w} × ${m.h} ${m.shape === "tree" ? "mega-tree" : "matrix"}`;

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
export function makeShare(show, lights, { models = {}, positions = {}, app = "", pictureOf = () => null, faceOf = () => null, seasons = [], shapeOf = () => "panel" } = {}) {
  const byId = new Map(lights.map((d) => [d.id, d]));
  // Seasons go by name (ids are only this copy's): a light's, and the show's.
  const seasonName = new Map(seasons.map((x) => [x.id, x.name]));
  const used = new Map(); // light id -> key, in the order the show uses them
  const out = { lights: [], tracks: [] };
  const lightKey = (d) => {
    if (used.has(d.id)) return used.get(d.id);
    const key = `L${used.size + 1}`;
    used.set(d.id, key);
    const parts = (d.parts || []).map((p, i) => ({ key: `P${i + 1}`, id: p.id, name: p.name,
      ...(isRectPart(p) ? { x: p.x, y: p.y, w: p.w, h: p.h } : { from: p.from, to: p.to }) }));
    out.lights.push({ key, name: d.name, type: lightType(d, models[d.sku]), sku: d.kind === "govee" ? d.sku || "" : "",
      kind: d.kind || "govee", segments: d.segments, parts: parts.map(({ id, ...p }) => p),
      where: whereOf(positions[d.id]), _parts: parts });
    const level = show.lightBrightness?.[d.id];
    if (level != null && level !== 100) out.lights.at(-1).brightness = level;
    const its = (d.seasons || []).map((id) => seasonName.get(id)).filter(Boolean);
    if (its.length) out.lights.at(-1).seasons = its;
    // Older copies ignore it, so a show with matrices is still version 1 (or 2 with pictures).
    const matrix = matrixOf(d, shapeOf);
    if (matrix) out.lights.at(-1).matrix = matrix;
    return key;
  };
  for (const tr of show.tracks || []) {
    if (!tr.clips?.length) continue;
    if (tr.device === HOUSE) { out.tracks.push({ house: true, clips: tr.clips }); continue; }
    // Older copies skip it, as a light that isn't in the file.
    if (tr.device === PHONES) { out.tracks.push({ phones: true, clips: tr.clips }); continue; }
    const [id, pid] = String(tr.device).split("#");
    const d = byId.get(id);
    if (!d) continue;
    const key = lightKey(d);
    if (pid === undefined) { out.tracks.push({ light: key, clips: tr.clips }); continue; }
    const part = out.lights.find((l) => l.key === key)._parts.find((p) => p.id === pid);
    if (part) out.tracks.push({ light: key, part: part.key, clips: tr.clips });
  }
  for (const l of out.lights) delete l._parts;
  // Pictures travel with the show, each once, with the clips pointing at them by key. pictureOf(id)
  // gives {name, w, h, frames (base64), delays}, or null for one that's gone (those clips show nothing).
  const pictures = [], picKeys = new Map();
  const keyOf = (id) => {
    if (!picKeys.has(id)) {
      const pic = picKeys.size < MAX_SHARED_PICTURES ? pictureOf(id) : null;
      picKeys.set(id, pic ? `I${pictures.length + 1}` : "");
      if (pic) pictures.push({ key: picKeys.get(id), name: pic.name, w: pic.w, h: pic.h, frames: pic.frames, delays: pic.delays });
    }
    return picKeys.get(id);
  };
  out.tracks = out.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.effect === "picture" && c.picture ? { ...c, picture: keyOf(c.picture) } : c)) }));
  // Your own Singing faces travel the same way, as their recipes, keyed F1, F2… faceOf(id) gives
  // {name, recipe} for one of yours, or null (a built-in, which every copy has, or one that's gone).
  const faces = [], faceKeys = new Map();
  const faceKey = (id) => {
    if (!faceKeys.has(id)) {
      const face = faceKeys.size < MAX_SHARED_FACES ? faceOf(id) : null;
      faceKeys.set(id, face ? `F${faces.length + 1}` : id);
      if (face) faces.push({ key: faceKeys.get(id), name: face.name, recipe: face.recipe });
    }
    return faceKeys.get(id);
  };
  out.tracks = out.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.effect === "singingface" && typeof c.character === "string" ? { ...c, character: faceKey(c.character) } : c)) }));
  const song = show.audio?.path ? { name: songTitle(show.audio.path), length: round2(show.duration || 0) } : null;
  return {
    format: SHARE_FORMAT, version: pictures.length ? 2 : 1, app, name: show.name || "Shared show", song,
    fps: show.fps, duration: round2(show.duration || 60), tempo: show.tempo ?? null,
    beats: show.beats || [], bars: show.bars || [], sections: show.sections || [],
    lights: out.lights, tracks: out.tracks,
    // Show settings → Brightness, only when dimmed (older copies ignore it and play at 100%).
    ...(show.brightness != null && show.brightness !== 100 ? { brightness: show.brightness } : {}),
    ...(seasonName.get(show.season) ? { season: seasonName.get(show.season) } : {}),
    ...(pictures.length ? { pictures } : {}),
    // Older copies ignore it (the faces show as snowmen), so it doesn't change the version.
    ...(faces.length ? { faces } : {}),
  };
}

// An imported show's tracks with each face key swapped for the id it was saved under here (ids: {key:
// id}); a face key with nothing saved is a snowman.
export const withFaceIds = (tracks, ids) => tracks.map((t) => ({ ...t,
  clips: t.clips.map((c) => (c.effect !== "singingface" || typeof c.character !== "string" || !/^F[0-9]+$/.test(c.character) ? c
    : { ...c, character: Object.hasOwn(ids, c.character) && typeof ids[c.character] === "string" ? ids[c.character] : "snowman" })) }));

// An imported show's tracks with each picture key swapped for the id it was saved under here
// (ids: {key: id}). A key with no picture becomes none.
export const withPictureIds = (tracks, ids) => tracks.map((t) => ({ ...t,
  clips: t.clips.map((c) => (c.effect !== "picture" ? c
    : { ...c, picture: typeof c.picture === "string" && Object.hasOwn(ids, c.picture) && typeof ids[c.picture] === "string" ? ids[c.picture] : "" })) }));

// A shared matrix's size, if it's a real one: whole numbers, 1 to 4,096 LEDs in all.
function sharedMatrix(m) {
  if (!m || typeof m !== "object") return null;
  const w = Number(m.w), h = Number(m.h);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > MAX_MATRIX) return null;
  return { w, h, shape: m.shape === "tree" ? "tree" : "panel" };
}

// A shared picture as it should be: small, with frames and delays that fit; anything else is skipped.
function sharedPicture(p) {
  if (!p || typeof p !== "object" || typeof p.key !== "string") return null;
  const w = p.w, h = p.h, frames = p.frames, delays = p.delays;
  if (![w, h].every((v) => Number.isInteger(v) && v >= 1 && v <= 64)) return null;
  if (!Array.isArray(frames) || !frames.length || frames.length > 120 || !Array.isArray(delays) || delays.length !== frames.length) return null;
  if (!frames.every((f) => typeof f === "string" && f.length === Math.ceil((w * h * 4) / 3) * 4)) return null;
  if (!delays.every((d) => Number.isInteger(d) && d >= 20 && d <= 10000)) return null;
  return { key: p.key, name: typeof p.name === "string" && p.name.trim() ? p.name.slice(0, 60) : "Picture", w, h, frames, delays };
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
  const names = (a) => (Array.isArray(a) ? a.filter((v) => typeof v === "string" && v.trim()).slice(0, 20).map((v) => v.trim().slice(0, 40)) : []);
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
        .map((p) => ({ key: p.key, name: text64(p.name, "Part"),
          // A matrix's part is a rectangle; a strip's a run.
          ...(Number.isInteger(p.w) && Number.isInteger(p.h) ? { x: num(p.x), y: num(p.y), w: p.w, h: p.h } : { from: num(p.from, 1), to: num(p.to, 1) }) })),
      where: l.where && ["x", "y", "w", "h"].every((k) => Number.isFinite(l.where[k]))
        ? { x: l.where.x, y: l.where.y, w: l.where.w, h: l.where.h } : null,
      ...(level(l.brightness) ? { brightness: level(l.brightness) } : {}),
      ...(names(l.seasons).length ? { seasons: names(l.seasons) } : {}),
      ...(sharedMatrix(l.matrix) ? { matrix: sharedMatrix(l.matrix) } : {}),
    }));
  const keys = new Set(lights.map((l) => l.key));
  let count = 0;
  const tracks = [];
  for (const t of Array.isArray(s.tracks) ? s.tracks : []) {
    if (!t || !Array.isArray(t.clips)) continue;
    const phones = t.phones === true && !t.house;
    if (!t.house && !phones && !keys.has(t.light)) continue;
    const clips = t.clips.filter((c) => c && typeof c === "object" && typeof c.effect === "string"
      && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
      .slice(0, Math.max(0, MAX_CLIPS - count));
    count += clips.length;
    tracks.push(t.house ? { house: true, clips } : phones ? { phones: true, clips } : { light: t.light, part: typeof t.part === "string" ? t.part : undefined, clips });
  }
  return {
    version: s.version, name: text64(s.name, "Shared show") || "Shared show",
    song: s.song && typeof s.song === "object" ? { name: text64(s.song.name), length: num(s.song.length) } : null,
    duration: Math.max(1, num(s.duration, 60)), tempo: Number.isFinite(s.tempo) ? s.tempo : null,
    beats: nums(s.beats), bars: nums(s.bars),
    sections: (Array.isArray(s.sections) ? s.sections : []).filter((x) => x && Number.isFinite(x.start) && Number.isFinite(x.end)),
    lights: lights.filter((l) => tracks.some((t) => t.light === l.key)), tracks,
    ...(level(s.brightness) ? { brightness: level(s.brightness) } : {}),
    ...(typeof s.season === "string" && s.season.trim() ? { season: s.season.trim().slice(0, 40) } : {}),
    pictures: (Array.isArray(s.pictures) ? s.pictures : []).slice(0, MAX_SHARED_PICTURES).map(sharedPicture).filter(Boolean),
    faces: (Array.isArray(s.faces) ? s.faces : []).slice(0, MAX_SHARED_FACES)
      .filter((f) => f && typeof f === "object" && typeof f.key === "string" && /^F[0-9]+$/.test(f.key))
      .map((f) => ({ key: f.key, name: text64(f.name, "Face").slice(0, 60) || "Face", recipe: cleanRecipe(f.recipe) })),
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
export function myLights(lights, { models = {}, positions = {}, seasons = [], shapeOf = () => "panel" } = {}) {
  const seasonName = new Map(seasons.map((x) => [x.id, x.name]));
  return lights.filter((d) => !d.light).map((d) => ({
    ...(matrixOf(d, shapeOf) ? { matrix: matrixOf(d, shapeOf) } : {}),
    seasons: (d.seasons || []).map((id) => seasonName.get(id)).filter(Boolean),
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
// seasonal: the shared show says which of its lights are props (older files don't), so an all-year
// light of theirs can be kept off your props.
export function score(theirs, mine, { seasonal = (theirs.seasons || []).length > 0 } = {}) {
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
  // Seasonal props for props of the same season; an all-year light rather not on one of your props.
  const theirSeasons = (theirs.seasons || []).map((x) => x.toLowerCase()), mySeasons = mine.seasons || [];
  const shared = mySeasons.find((x) => theirSeasons.includes(x.toLowerCase()));
  if (shared) { s += 3; why.unshift(`both ${shared} props`); }
  else if (seasonal && !theirSeasons.length && mySeasons.length) s -= 1;
  // A matrix's grid effects want one of your matrices, a mega-tree's spirals one of your trees.
  if (theirs.matrix && mine.matrix) {
    const tree = theirs.matrix.shape === "tree", same = tree === (mine.matrix.shape === "tree");
    s += same ? 5 : 3;
    why.unshift(same && tree ? "both mega-trees" : "both matrices");
  } else if (theirs.matrix) s -= 2;
  return { score: s, why };
}

// What the match screen says when a matrix of theirs goes on a light of yours that isn't the same:
// a different grid stretches their matrix effects to fit, and a strip shows only a slice of them.
export function matrixNote(theirs, mine) {
  if (!theirs?.matrix || !mine) return "";
  if (!mine.matrix) return `Made for a ${gridWords(theirs.matrix)}: its matrix effects show only a slice on ${mine.name}.`;
  const a = theirs.matrix, b = mine.matrix;
  if (a.w === b.w && a.h === b.h) return "";
  return `Their ${a.w} × ${a.h}, yours ${b.w} × ${b.h}: its matrix effects stretch to fit.`;
}

// The imported show's season: yours with the same name (any case), or none (any season) with a note
// saying theirs was for a season you haven't got.
export function shareSeason(share, seasons) {
  if (!share.season) return { id: null, note: "" };
  const found = seasons.find((x) => x.name.toLowerCase() === share.season.toLowerCase());
  return found ? { id: found.id, note: "" }
    : { id: null, note: `It was made for ${share.season}, a season you haven't got, so it's for any season. Pick one in ⚙ Show settings….` };
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
  const seasonal = theirs.some((t) => t.seasons?.length);
  for (const t of theirs) for (const m of mine) pairs.push({ t, m, ...score(t, m, { seasonal }) });
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
    if (t.phones) { put(PHONES, t.clips); continue; }
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
