// Scenes: one-tap looks for the whole house that play until something else is chosen (scenelib.py
// keeps them). Worked out here, without the page, so it can be tested. A scene is
// {name, mode: "basic", lights: {lightId: {effect, params}}, all?: {effect, params}}: with `all`,
// every light plays that; otherwise each light its own, and a light with none stays off. An Advanced
// scene, edited in the Show editor, is {name, mode: "advanced", loop, tracks} instead: a show's tracks
// (House lane included) going round every `loop` seconds.

import { EFFECTS, HOUSE, composeLight, defaultParams } from "./effects.js";
import { paletteKeys } from "./palettes.js";
import { BLOCK_EFFECTS, loopLength } from "./playlisteditor.js";

export const ADVANCED_LOOP_S = 20;

// Effects a scene can use: the playlist's Effect block ones (they look right however long they run),
// with Solid first for a still colour.
export const SCENE_EFFECTS = ["solid", ...BLOCK_EFFECTS.filter((k) => k !== "solid")];

export const WARM_WHITE = "#ffc977";

export const newLook = (effect = "solid") => ({
  effect, params: effect === "solid" ? { color: WARM_WHITE } : {},
});

// A light's look with a different effect, keeping the colours it had where the new effect has room.
export function changeEffect(look, effect) {
  const next = newLook(effect);
  if (!look) return next;
  const old = clipFor(look, 0, 1);
  const colours = paletteKeys(look.effect).map((k) => old[k]).filter(Boolean);
  paletteKeys(effect).forEach((k, i) => { if (i < colours.length) next.params[k] = colours[i]; });
  if (look.params.brightness != null) next.params.brightness = look.params.brightness;
  return next;
}

// A new scene: every light a steady warm white, so it does something the moment it's played.
export function newScene(name, lights) {
  return { name, mode: "basic", lights: Object.fromEntries(lights.map((d) => [d.id, newLook()])) };
}

export const lookFor = (scene, lightId) => scene.all || scene.lights?.[lightId] || null;

// A light split into parts can have a look on each part instead, keyed "light#part". A light played
// only as parts always goes by part; its older scenes kept one look under the light's own id, which
// then plays on every part.
export const partKey = (d, p) => `${d.id}#${p.id}`;
const hasPartLooks = (scene, d) => !!d.parts?.some((p) => scene.lights?.[partKey(d, p)]);
export const byParts = (scene, d) => !scene.all && !!d.parts?.length && (d.whole === false || hasPartLooks(scene, d));
export function partLook(scene, d, p) {
  if (scene.all) return scene.all;
  return hasPartLooks(scene, d) ? scene.lights[partKey(d, p)] || null : scene.lights?.[d.id] || null;
}
// Every look a light has in the scene.
export const looksOf = (scene, d) => (byParts(scene, d) ? d.parts.map((p) => partLook(scene, d, p)) : [lookFor(scene, d.id)]).filter(Boolean);

// Setting one part's look (null for off).
export function setPartLook(scene, d, p, look) {
  if (!hasPartLooks(scene, d)) {
    const whole = scene.lights[d.id];
    for (const q of d.parts) if (whole) scene.lights[partKey(d, q)] = structuredClone(whole);
    delete scene.lights[d.id];
  }
  if (look) scene.lights[partKey(d, p)] = look;
  else delete scene.lights[partKey(d, p)];
  return scene;
}

// Each part on its own, starting on the light's look (all off if it was off), or the whole light
// again, on the first part's look.
export function setByParts(scene, d, on) {
  if (on) {
    const whole = scene.lights[d.id];
    if (whole) for (const p of d.parts) scene.lights[partKey(d, p)] = structuredClone(whole);
    delete scene.lights[d.id];
  } else {
    const first = d.parts.map((p) => scene.lights[partKey(d, p)]).find(Boolean);
    for (const p of d.parts) delete scene.lights[partKey(d, p)];
    if (first) scene.lights[d.id] = first;
  }
  return scene;
}

// The setting a row's Speed slider moves: the effect's speed, or its rate.
export const speedParam = (effect) => EFFECTS[effect]?.params.find((p) => p.key === "speed" || p.key === "rate") || null;

// A clip for a look, ready for effects.js: its settings over the effect's defaults.
export const clipFor = (look, start, end) => ({ ...defaultParams(look.effect), ...look.params, effect: look.effect, start, end });

// What the scene plays, as a show for effects.js's bake(): one clip on each light (or on each part
// of a light split into parts that's only played as parts), `loop` seconds long.
export function sceneShow(scene, lights, loop) {
  if (scene.mode === "advanced") return { duration: scene.loop, tracks: scene.tracks || [] };
  const tracks = [];
  const push = (device, look) => { if (look && EFFECTS[look.effect]) tracks.push({ device, clips: [clipFor(look, 0, loop)] }); };
  for (const d of lights) {
    if (byParts(scene, d) || (scene.all && d.parts?.length && d.whole === false)) {
      for (const p of d.parts) push(partKey(d, p), partLook(scene, d, p));
    } else push(d.id, lookFor(scene, d.id));
  }
  return { duration: loop, tracks };
}

// How long the scene's frames run before going round again: a second if nothing moves, else
// (as a playlist's Effect block) where the lights look most like they did at the start.
export function sceneLoop(scene, lights, fps) {
  if (scene.mode === "advanced") return scene.loop;
  const probe = sceneShow(scene, lights, 3600);
  const trackOf = (id) => probe.tracks.find((tr) => tr.device === id);
  const look = (t) => lights.flatMap((l) => [...composeLight(l, trackOf, t)]);
  const first = look(0).join();
  if ([0.37, 1.1, 2.9, 7.3].every((t) => look(t).join() === first)) return 1;
  return loopLength({ type: "effect", seconds: 3600 }, fps, look);
}

// Up to three colours to show for the scene on its row in Your scenes.
export function sceneColours(scene, lights) {
  const out = [];
  const looks = scene.mode === "advanced"
    ? (scene.tracks || []).flatMap((t) => t.clips).map(({ start, end, effect, ...params }) => ({ effect, params }))
    : scene.all ? [scene.all] : lights.flatMap((d) => looksOf(scene, d));
  for (const look of looks) {
    const clip = clipFor(look, 0, 1);
    for (const k of paletteKeys(look.effect)) {
      if (clip[k] && !out.includes(clip[k])) out.push(clip[k]);
      if (out.length === 3) return out;
    }
  }
  return out;
}

// The row's line of detail: "5 lights · Chase, Twinkle" or "Every light · Rainbow".
export function sceneSummary(scene, lights) {
  const label = (look) => EFFECTS[look.effect]?.label || look.effect;
  if (scene.mode === "advanced") {
    const effects = [...new Set((scene.tracks || []).flatMap((t) => t.clips).map(label))];
    const shown = effects.slice(0, 3).join(", ") + (effects.length > 3 ? "…" : "");
    return `Advanced · goes round every ${fmtLoop(scene.loop)}${shown ? ` · ${shown}` : ""}`;
  }
  if (scene.all) return `Every light · ${label(scene.all)}`;
  const on = lights.filter((d) => looksOf(scene, d).length);
  if (!on.length) return "No lights on yet";
  const effects = [...new Set(on.flatMap((d) => looksOf(scene, d).map(label)))];
  const shown = effects.slice(0, 3).join(", ") + (effects.length > 3 ? "…" : "");
  return `${on.length} light${on.length === 1 ? "" : "s"} · ${shown}`;
}

// Turning Same for every light on starts every light on the first light's look; turning it off
// gives each light that look, to change one at a time.
export function setSame(scene, on, lights) {
  if (on && !scene.all) {
    const first = lights.flatMap((d) => looksOf(scene, d))[0] || newLook();
    scene.all = structuredClone(first);
  } else if (!on && scene.all) {
    scene.lights = Object.fromEntries(lights.map((d) => [d.id, structuredClone(scene.all)]));
    delete scene.all;
  }
  return scene;
}

const fmtLoop = (s) => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${Math.round(s * 10) / 10} s`);

// Basic → Advanced: each light's look becomes one effect running the whole loop, ready to cut up.
export function toAdvanced(scene, lights, loop = ADVANCED_LOOP_S) {
  return { name: scene.name, mode: "advanced", loop, tracks: sceneShow(scene, lights, loop).tracks,
    ...(scene.schedule ? { schedule: scene.schedule } : {}) };
}

// Advanced → Basic is only offered when nothing would be lost: no House lane or group effects, each
// light or part with at most one effect running the whole loop, and no light with effects both on
// itself and on its parts.
export function canBasic(scene, lights) {
  if (scene.mode !== "advanced") return false;
  const ids = new Set(lights.flatMap((d) => [d.id, ...(d.parts || []).map((p) => partKey(d, p))]));
  const used = new Set((scene.tracks || []).filter((t) => t.clips.length).map((t) => t.device));
  if (lights.some((d) => used.has(d.id) && d.parts?.some((p) => used.has(partKey(d, p))))) return false;
  return (scene.tracks || []).every((t) => {
    if (!t.clips.length) return true;
    if (t.device === HOUSE || !ids.has(t.device) || t.clips.length > 1) return false;
    const [c] = t.clips;
    return c.start <= 0.01 && c.end >= scene.loop - 0.01 && SCENE_EFFECTS.includes(c.effect);
  });
}

export function toBasic(scene) {
  const lights = {};
  for (const t of scene.tracks || []) {
    const c = t.clips[0];
    if (!c) continue;
    const { start, end, effect, ...params } = c;
    lights[t.device] = { effect, params };
  }
  return { name: scene.name, mode: "basic", lights, ...(scene.schedule ? { schedule: scene.schedule } : {}) };
}
