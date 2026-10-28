// Scenes: one-tap looks for the whole house that play until something else is chosen (scenelib.py
// keeps them). Worked out here, without the page, so it can be tested. A scene is
// {name, mode: "basic", lights: {lightId: {effect, params}}, all?: {effect, params}}: with `all`,
// every light plays that; otherwise each light its own, and a light with none stays off. An Advanced
// scene, edited in the Show editor, is {name, mode: "advanced", loop, tracks} instead: a show's tracks
// (House lane included) going round every `loop` seconds.

export const ADVANCED_LOOP_S = 20;

import { EFFECTS, HOUSE, composeLight, defaultParams } from "./effects.js";
import { paletteKeys } from "./palettes.js";
import { BLOCK_EFFECTS, loopLength } from "./playlisteditor.js";

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

// The setting a row's Speed slider moves: the effect's speed, or its rate.
export const speedParam = (effect) => EFFECTS[effect]?.params.find((p) => p.key === "speed" || p.key === "rate") || null;

// A clip for a look, ready for effects.js: its settings over the effect's defaults.
export const clipFor = (look, start, end) => ({ ...defaultParams(look.effect), ...look.params, effect: look.effect, start, end });

// What the scene plays, as a show for effects.js's bake(): one clip on each light (or on each part
// of a light split into parts that's only played as parts), `loop` seconds long.
export function sceneShow(scene, lights, loop) {
  if (scene.mode === "advanced") return { duration: scene.loop, tracks: scene.tracks || [] };
  const tracks = [];
  for (const d of lights) {
    const look = lookFor(scene, d.id);
    if (!look || !EFFECTS[look.effect]) continue;
    const ids = d.parts?.length && d.whole === false ? d.parts.map((p) => `${d.id}#${p.id}`) : [d.id];
    for (const id of ids) tracks.push({ device: id, clips: [clipFor(look, 0, loop)] });
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
    : scene.all ? [scene.all] : lights.map((d) => scene.lights?.[d.id]).filter(Boolean);
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
  const on = lights.filter((d) => scene.lights?.[d.id]);
  if (!on.length) return "No lights on yet";
  const effects = [...new Set(on.map((d) => label(scene.lights[d.id])))];
  const shown = effects.slice(0, 3).join(", ") + (effects.length > 3 ? "…" : "");
  return `${on.length} light${on.length === 1 ? "" : "s"} · ${shown}`;
}

// Turning Same for every light on starts every light on the first light's look; turning it off
// gives each light that look, to change one at a time.
export function setSame(scene, on, lights) {
  if (on && !scene.all) {
    const first = lights.map((d) => scene.lights?.[d.id]).find(Boolean) || newLook();
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
  return { name: scene.name, mode: "advanced", loop, tracks: sceneShow(scene, lights, loop).tracks };
}

// Advanced → Basic is only offered when nothing would be lost: no House lane effects, and each light
// (whole, not by parts) with at most one effect running the whole loop.
export function canBasic(scene, lights) {
  if (scene.mode !== "advanced") return false;
  const ids = new Set(lights.map((d) => d.id));
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
  return { name: scene.name, mode: "basic", lights };
}
