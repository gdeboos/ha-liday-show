// The Scene editor and the lists of scenes (Library → Scenes, and where the Scene tab starts).
// A scene's logic is in housescenes.js; scenelib.py keeps them and the runner plays them round and
// round. This draws the pages, saves as you go, and bakes each scene's loop for the player.

import { EFFECTS, FPS, bake, composeLight, matchesPreset, presetParams, unusedColour } from "./effects.js";
import {
  SCENE_EFFECTS, byParts, changeEffect, clipFor, newScene, partKey, partLook, sceneColours, sceneLoop, sceneShow,
  sceneSummary, setByParts, setPartLook, setSame, speedParam, toAdvanced,
} from "./housescenes.js";
import { applyPalette, paletteKeys } from "./palettes.js";
import { pickPalette } from "./palettepicker.js";
import { withMore } from "./rowmenu.js";
import { PART, sendParts } from "./upload.js";

const SAVE_AFTER_MS = 600;
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== "list") e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids.filter((x) => x != null));
  return e;
}

export class SceneEditor {
  // deps: api, status(msg, kind), lights() (Devices tab order), devices() (track id -> light or
  // part), lightsKey(), house (for the preview), asShown, palettes(), presetsFor(effect), prefs,
  // positions() (where each light is on the house, for an Advanced scene's House lane),
  // opened() (after a scene opens, to show the editor page), closed() (back to the list),
  // editAdvanced(id) (an Advanced scene opens in the Show editor),
  // scheduleLink(id) (what the schedule does with a scene, and a way to the Schedule tab),
  // scheduleLine(id) (the same in words, or "" when it isn't on the schedule),
  // chooseEffect(options) (the Show editor's effect window, with its moving previews)
  constructor(deps) {
    this.d = deps;
    this.scenes = [];
    this.scene = null; // the open scene
    this.id = null;
    this.timer = null;
    this.saving = Promise.resolve();
    this.raf = 0;
    this.status = null; // the player's status, for ▶/■ and badges
    // Split lights switched to Each part on its own while open, so they stay that way with every part off.
    this.byParts = new Set();
  }

  // Lists -------------------------------------------------------------------------
  async refresh() {
    try {
      [this.scenes, this.status] = await Promise.all([this.d.api("api/house-scenes"), this.d.api("api/player")]);
    } catch (e) {
      this.d.status(`Couldn't load your scenes: ${e.message}`, true);
      return;
    }
    this.drawLists();
    this.drawPlayButton();
  }

  playingId() {
    const s = this.status?.scene;
    return s?.playing ? s.id : null;
  }

  drawLists() {
    const lights = this.d.lights();
    for (const box of document.querySelectorAll("[data-scene-list]")) {
      if (!this.scenes.length) {
        box.replaceChildren(el("p", { class: "hint" }, "No scenes yet. Press + New scene to make one."));
        continue;
      }
      box.replaceChildren(...this.scenes.map((s) => this.row(s, lights)));
      this.d.afterList?.(box);
    }
  }

  row(s, lights) {
    const playing = this.playingId() === s.id;
    const waiting = !playing && this.status?.scene?.id === s.id;
    const colours = sceneColours(s, lights);
    const sw = el("span", { class: "scene-swatches", "aria-hidden": "true" },
      ...(colours.length ? colours : ["#3a3f47"]).map((c) => {
        const x = el("span");
        x.style.background = c;
        return x;
      }));
    const head = el("div", {}, el("b", { class: "show-name" }, s.name));
    if (playing) head.append(el("span", { class: "show-last" }, "▶ Playing now"));
    if (waiting) head.append(el("span", { class: "show-last" }, "Comes back after the show"));
    if (!s.baked) head.append(el("span", { class: "badge warn", title: "Open it once so it's ready to play" }, "⚠ Not ready yet"));
    const line = this.d.scheduleLine(s.id);
    const when = line ? ` · ${line[0].toLowerCase()}${line.slice(1)}` : "";
    const main = el("div", { class: "show-main" }, head, el("div", { class: "hint" }, sceneSummary(s, lights) + when));
    const play = playing
      ? el("button", { type: "button", class: "primary", onclick: () => this.stop(s.id), "aria-label": `Stop ${s.name}` }, "■ Stop")
      : el("button", { type: "button", class: "primary", onclick: () => this.play(s.id), disabled: !s.baked,
        "aria-label": `Play ${s.name}`, title: s.baked ? `Play ${s.name} on your lights` : "Open it once so it's ready to play" }, "▶ Play");
    const actions = el("div", { class: "group show-actions" }, play,
      el("button", { type: "button", class: "ghost", onclick: () => this.open(s.id), "aria-label": `Edit ${s.name}` }, "Edit"),
      el("button", { type: "button", class: "ghost", onclick: () => this.renameRow(s), "aria-label": `Rename ${s.name}` }, "Rename…"),
      el("button", { type: "button", class: "ghost", onclick: () => this.duplicate(s), "aria-label": `Duplicate ${s.name}` }, "Duplicate"),
      el("button", { type: "button", class: "ghost", onclick: () => this.remove(s), "aria-label": `Remove ${s.name}` }, "Remove…"));
    withMore(actions, 2);
    const row = el("div", { class: `show-row scene-row${playing ? " playing" : ""}`, role: "listitem" }, sw, main, actions);
    row.dataset.sceneId = s.id;
    return row;
  }

  // Playing --------------------------------------------------------------------------
  async play(id) {
    if (id === this.id) await this.flush();
    await this.playNow(id);
  }

  async playNow(id) {
    try {
      this.status = await this.d.api(`api/house-scenes/${encodeURIComponent(id)}/play`, { method: "POST" });
      this.d.status(`Playing ${this.status.scene?.name || "the scene"} on your lights`);
    } catch (e) {
      this.d.status(`Couldn't play the scene: ${e.message}`, true);
    }
    this.drawLists();
    this.drawPlayButton();
  }

  async stop(id) {
    try {
      this.status = await this.d.api(`api/house-scenes/${encodeURIComponent(id)}/stop`, { method: "POST" });
    } catch (e) {
      this.d.status(`Couldn't stop the scene: ${e.message}`, true);
    }
    this.drawLists();
    this.drawPlayButton();
  }

  // Making and removing -----------------------------------------------------------
  newScene() {
    const taken = new Set(this.scenes.map((s) => s.name.toLowerCase()));
    let n = 1, guess = "My scene";
    while (taken.has(guess.toLowerCase())) guess = `My scene ${++n}`;
    const dlg = el("dialog", { class: "effect-dialog form-dialog", "aria-labelledby": "nsc-title" });
    const input = el("input", { id: "nsc-name", value: guess, maxLength: 80 });
    const note = el("span", { class: "hint", id: "nsc-note" }, "Every light starts on a steady warm white. Change any of them afterwards.");
    const make = el("button", { type: "submit", class: "primary" }, "Create scene");
    const form = el("form", { method: "dialog" },
      el("div", { class: "effect-dialog-head" }, el("h3", { id: "nsc-title" }, "New scene"),
        el("button", { type: "button", class: "ghost", "aria-label": "Close", onclick: () => dlg.close() }, "✕")),
      el("div", { class: "form-dialog-body" },
        el("label", { class: "field" }, "Name", input), note),
      el("div", { class: "form-dialog-foot" }, el("span", { class: "spacer" }),
        el("button", { type: "button", onclick: () => dlg.close() }, "Cancel"), make));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim().replace(/\s+/g, " ");
      if (!name) { input.focus(); return; }
      if (taken.has(name.toLowerCase())) {
        note.textContent = `There's already a scene called ${name}. Give this one its own name.`;
        note.className = "hint warn";
        input.select();
        return;
      }
      make.disabled = true;
      try {
        const { id } = await this.d.api("api/house-scenes", { method: "POST", json: { name } });
        this.d.placeNew?.(id);
        await this.d.api(`api/house-scenes/${encodeURIComponent(id)}`, { method: "PUT", json: newScene(name, this.d.lights()) });
        dlg.close();
        await this.open(id);
      } catch (err) {
        note.textContent = `Couldn't make the scene: ${err.message}`;
        note.className = "hint error";
        make.disabled = false;
      }
    });
    dlg.append(form);
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    input.select();
  }

  // Renaming from the list. Saving a scene clears its frames, so they're made again straight away.
  async renameRow(s) {
    const name = prompt("Rename the scene", s.name)?.trim().replace(/\s+/g, " ");
    if (!name || name === s.name) return;
    if (this.scenes.some((x) => x.id !== s.id && x.name.toLowerCase() === name.toLowerCase())) {
      this.d.status(`There's already a scene called ${name}. Give this one its own name`, "hint");
      return;
    }
    if (s.id === this.id) { $("sc-name").value = name; this.rename(name); await this.flush(); return; }
    try {
      const scene = await this.d.api(`api/house-scenes/${encodeURIComponent(s.id)}`);
      scene.name = name.slice(0, 80);
      await this.d.api(`api/house-scenes/${encodeURIComponent(s.id)}`, { method: "PUT", json: scene });
      await this.bakeAndSend(s.id, scene);
      this.d.status("Scene renamed", "saved");
    } catch (e) {
      this.d.status(`Couldn't rename ${s.name}: ${e.message}`, true);
    }
    await this.refresh();
  }

  // A copy under a free name ("Evening copy"), ready to play: its frames are made straight away. It
  // isn't on the schedule.
  async duplicate(s) {
    if (s.id === this.id) await this.flush();
    const taken = new Set(this.scenes.map((x) => x.name.toLowerCase()));
    let name = `${s.name} copy`;
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${s.name} copy ${k}`;
    try {
      const { schedule, ...scene } = await this.d.api(`api/house-scenes/${encodeURIComponent(s.id)}`);
      scene.name = name.slice(0, 80);
      const { id } = await this.d.api("api/house-scenes", { method: "POST", json: { name: scene.name } });
      this.d.placeBeside?.(s.id, id);
      await this.d.api(`api/house-scenes/${encodeURIComponent(id)}`, { method: "PUT", json: scene });
      await this.bakeAndSend(id, scene);
      this.d.status(`Made ${scene.name}`, "saved");
    } catch (e) {
      this.d.status(`Couldn't duplicate ${s.name}: ${e.message}`, true);
    }
    await this.refresh();
  }

  remove(s) {
    const dlg = el("dialog", { class: "effect-dialog form-dialog", "aria-labelledby": "rsc-title" });
    const del = el("button", { type: "button", class: "danger" }, "Delete for good…");
    dlg.append(
      el("div", { class: "effect-dialog-head" }, el("h3", { id: "rsc-title" }, `Remove ${s.name}`),
        el("button", { type: "button", class: "ghost", "aria-label": "Close", onclick: () => dlg.close() }, "✕")),
      el("div", { class: "form-dialog-body" },
        el("p", {}, "The scene is deleted, and stops if it's on. A copy of everything is kept first under ",
          el("b", {}, "Setup → Settings → Your data"), ", so it can be brought back.")),
      el("div", { class: "form-dialog-foot" }, el("span", { class: "spacer" }),
        el("button", { type: "button", onclick: () => dlg.close() }, "Cancel"), del));
    del.addEventListener("click", async () => {
      del.disabled = true;
      try {
        await this.d.api(`api/house-scenes/${encodeURIComponent(s.id)}`, { method: "DELETE" });
        this.d.status(`${s.name} deleted`, "saved");
        if (this.id === s.id) this.close();
      } catch (e) {
        this.d.status(`Couldn't delete ${s.name}: ${e.message}`, true);
      }
      dlg.close();
      await this.refresh();
    });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // The editor ---------------------------------------------------------------------
  async open(id) {
    await this.flush();
    try {
      this.scene = await this.d.api(`api/house-scenes/${encodeURIComponent(id)}`);
    } catch (e) {
      this.d.status(`Couldn't open the scene: ${e.message}`, true);
      return;
    }
    if (this.scene.mode === "advanced") {
      this.scene = null;
      await this.d.editAdvanced(id);
      return;
    }
    this.id = id;
    this.byParts.clear();
    this.d.prefs.set("lastScene", id);
    $("sc-name").value = this.scene.name;
    this.draw();
    this.d.opened();
    // An older bake (or none, or one for different lights) is made again now.
    if (!this.scenes.find((s) => s.id === id)?.baked || this.d.prefs.get("sceneBakes", {})[id] !== this.bakeKey()) {
      this.saving = this.saving.then(() => this.bakeAndSend()).catch(() => {});
    }
  }

  close() {
    this.flush();
    this.id = null;
    this.scene = null;
    this.stopPreview();
    this.d.closed();
  }

  bakeKey(scene = this.scene) {
    const { name, ...look } = scene;
    // An Advanced scene's House and group lanes also depend on where the lights are on the house, and
    // on the groups.
    const advanced = scene.mode === "advanced";
    return JSON.stringify([look, this.d.lightsKey(), advanced ? this.d.positions() : null, advanced ? this.d.groups?.() || [] : null]);
  }

  // Basic → Advanced: each light's look becomes one effect across the loop, in the Show editor.
  async toAdvanced() {
    await this.flush();
    const id = this.id, scene = toAdvanced(this.scene, this.d.lights());
    try {
      await this.d.api(`api/house-scenes/${encodeURIComponent(id)}`, { method: "PUT", json: scene });
      await this.bakeAndSend(id, scene);
    } catch (e) {
      this.d.status(`Couldn't switch ${scene.name} to Advanced: ${e.message}`, true);
      return;
    }
    this.id = null;
    this.scene = null;
    this.stopPreview();
    await this.d.editAdvanced(id);
  }

  draw() {
    if (!this.scene) return;
    const s = this.scene, lights = this.d.lights();
    $("sc-same").checked = !!s.all;
    const rows = $("sc-rows");
    if (!lights.length) {
      rows.replaceChildren(el("p", { class: "hint" }, "Add your lights under Setup → Devices first."));
    } else if (s.all) {
      rows.replaceChildren(this.lookRow("Every light", s.all, (look) => { s.all = look; }));
    } else {
      rows.replaceChildren(...lights.flatMap((d) => this.lightRows(s, d)));
    }
    $("sc-when").replaceChildren(this.d.scheduleLink(this.id));
    this.drawPlayButton();
    this.startPreview();
  }

  // A light's rows: one, or for a light split into parts, the whole light or each part.
  lightRows(s, d) {
    const whole = (look) => { if (look) s.lights[d.id] = look; else delete s.lights[d.id]; };
    if (!d.parts?.length) return [this.lookRow(d.name, s.lights[d.id] || null, whole, d.id)];
    const split = byParts(s, d) || this.byParts.has(d.id);
    const box = el("input", { type: "checkbox", checked: split, disabled: d.whole === false });
    box.addEventListener("change", () => {
      setByParts(s, d, box.checked);
      if (box.checked) this.byParts.add(d.id); else this.byParts.delete(d.id);
      this.changed();
      this.draw();
    });
    const toggle = el("label", { class: "sc-parts", title: d.whole === false
      ? "This light only plays as parts. To light it as one too, turn on Also play as one under Setup → Devices."
      : "Give each part its own effect" }, box, " Each part on its own");
    // Played whole, the light is one row with the switch under its name; by parts, that row is just
    // its name and the switch, with a row for each part under it.
    if (!split) return [this.lookRow(d.name, s.lights[d.id] || null, whole, d.id, null, toggle)];
    const head = el("div", { class: "sc-row sc-split", role: "group", "aria-label": d.name },
      el("span", { class: "sc-light" }, d.name, toggle));
    return [head, ...d.parts.map((p) => this.lookRow(p.name, partLook(s, d, p),
      (look) => { setPartLook(s, d, p, look); this.byParts.add(d.id); }, partKey(d, p), `${d.name} · ${p.name}`))];
  }

  // One light's row: effect (or Off), colours, speed and brightness, every cell there even when empty
  // so the columns line up. `devId` is what the effect window previews on; `name` the light's full
  // name when `label` is a part's; `extra` goes under the name.
  lookRow(label, look, set, devId = null, name = null, extra = null) {
    const changed = (redraw) => { this.changed(); if (redraw) this.draw(); };
    const nested = !!name;
    const full = name || label;
    const row = el("div", { class: `sc-row${nested ? " nested" : ""}`, role: "group", "aria-label": full });
    const clip = look ? clipFor(look, 0, 1) : null;
    const preset = look ? this.d.presetsFor(look.effect).find((p) => matchesPreset(p, clip)) : null;
    const fxName = look ? `${EFFECTS[look.effect]?.label || look.effect}${preset ? ` · ${preset.label || preset.name}` : ""}` : "Off";
    const eff = el("button", { type: "button", class: "sc-effect picker-button", "aria-haspopup": "dialog",
      "aria-label": `Effect for ${full}: ${fxName}. Change…`, title: `${fxName}. Pick an effect or preset, with a preview of each` },
      el("span", { class: "picker-name" }, fxName), el("span", { class: "picker-change", "aria-hidden": "true" }, "Change…"));
    eff.addEventListener("click", () => this.d.chooseEffect({
      title: `Effect for ${full}`, dev: this.d.devices()[devId] || null, length: 6,
      current: look?.effect ?? null, currentPreset: preset, only: SCENE_EFFECTS,
      // Each effect previews as it would be picked: this light's colours carried over.
      paramsFor: (key) => {
        const { start, end, effect, ...params } = clipFor(changeEffect(look, key), 0, 1);
        return params;
      },
      onPick: (key, picked) => {
        const next = changeEffect(look, key);
        if (picked) next.params = { ...next.params, ...presetParams(picked, clipFor(next, 0, 1)) };
        set(next);
        changed(true);
      },
    }));
    const fx = el("span", { class: "sc-fx" }, eff);
    if (look && label !== "Every light") {
      fx.append(el("button", { type: "button", class: "ghost small", "aria-label": `Turn ${full} off in this scene`,
        title: "Off in this scene", onclick: () => { set(null); changed(true); } }, "Off"));
    }
    row.append(el("span", { class: "sc-light" }, label, extra), fx);
    if (!look) {
      row.append(el("span", { class: "hint sc-off" }, "Off in this scene"));
      return row;
    }
    const none = () => el("span", { class: "sc-none hint", "aria-hidden": "true" }, "—");
    const keys = paletteKeys(look.effect).filter((k) => !unusedColour(look.effect, k, clip));
    if (keys.length) {
      const colours = el("button", { type: "button", class: "ghost small sc-palette", "aria-label": `Colours for ${full} from a palette`,
        title: "Use one of your palettes" }, "Palette…");
      colours.addEventListener("click", async () => {
        const name = await pickPalette({ title: `Colours for ${full}`, groups: [["Palettes", this.d.palettes()]] });
        const p = this.d.palettes().find((q) => q.name === name);
        if (!p) return;
        const c = { effect: look.effect, ...look.params };
        applyPalette(c, p.colors);
        for (const k of [...paletteKeys(look.effect), "count"]) if (k in c) look.params[k] = c[k];
        changed(true);
      });
      const swatches = el("span", { class: "sc-swatches" }, ...keys.map((k) => {
        const input = el("input", { type: "color", value: clip[k], "aria-label": `${EFFECTS[look.effect].params.find((p) => p.key === k).label} for ${full}` });
        input.addEventListener("input", () => { look.params[k] = input.value; this.changed({ live: true }); });
        input.addEventListener("change", () => { look.params[k] = input.value; changed(false); });
        return input;
      }));
      row.append(el("span", { class: "sc-colours" }, swatches, colours));
    } else row.append(none());
    const sp = speedParam(look.effect);
    row.append(sp ? this.slider("Speed", full, sp, clip[sp.key], (v) => { look.params[sp.key] = v; }) : none());
    const br = EFFECTS[look.effect].params.find((p) => p.key === "brightness");
    row.append(br ? this.slider("Brightness", full, br, clip.brightness, (v) => { look.params.brightness = v; }) : none());
    return row;
  }

  // A slider with its name beside it on a phone, where the column headings are hidden.
  slider(what, light, p, value, set) {
    const input = el("input", { type: "range", min: p.min ?? 0, max: p.max ?? 100, step: p.step ?? 1, value,
      "aria-label": `${what} for ${light}` });
    input.addEventListener("input", () => { set(Number(input.value)); this.changed({ live: true }); });
    input.addEventListener("change", () => { set(Number(input.value)); this.changed(); });
    return el("span", { class: "sc-slider" }, el("span", { class: "sc-mini", "aria-hidden": "true" }, what), input);
  }

  setSame(on) {
    setSame(this.scene, on, this.d.lights());
    this.changed();
    this.draw();
  }

  rename(name) {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) { $("sc-name").value = this.scene.name; return; }
    if (this.scenes.some((s) => s.id !== this.id && s.name.toLowerCase() === clean.toLowerCase())) {
      this.d.status(`There's already a scene called ${clean}. Give this one its own name`, "hint");
      $("sc-name").value = this.scene.name;
      return;
    }
    this.scene.name = clean;
    this.changed();
  }

  // Saving: a moment after each change, then its frames are made again for the player.
  changed({ live = false } = {}) {
    this.previewShow = null;
    if (live) return;
    clearTimeout(this.timer);
    $("sc-state").textContent = "Saving…";
    this.timer = setTimeout(() => this.flush(), SAVE_AFTER_MS);
  }

  flush() {
    if (!this.timer) return this.saving;
    clearTimeout(this.timer);
    this.timer = null;
    const id = this.id, scene = structuredClone(this.scene);
    this.saving = this.saving.then(async () => {
      try {
        await this.d.api(`api/house-scenes/${encodeURIComponent(id)}`, { method: "PUT", json: scene });
        await this.bakeAndSend(id, scene);
        $("sc-state").textContent = "All changes saved";
        // Playing it now? It plays the new frames straight away.
        if (this.playingId() === id) await this.playNow(id);
      } catch (e) {
        $("sc-state").textContent = "";
        this.d.status(`Couldn't save ${scene.name}: ${e.message}`, true);
      }
      await this.refresh();
    });
    return this.saving;
  }

  async bakeAndSend(id = this.id, scene = this.scene) {
    const lights = this.d.lights();
    if (!lights.length) return;
    const loop = sceneLoop(scene, lights, FPS);
    const advanced = scene.mode === "advanced";
    const blob = bake(sceneShow(scene, lights, loop), this.d.devices(), FPS, advanced ? this.d.positions() : {},
      advanced ? this.d.groups?.() || [] : []);
    const path = `api/house-scenes/${encodeURIComponent(id)}/baked`;
    if (blob.byteLength > PART) await sendParts(this.d.api, `${path}/part`, new Blob([blob]));
    else await this.d.api(path, { method: "PUT", body: blob, headers: { "Content-Type": "application/octet-stream" } });
    const made = this.d.prefs.get("sceneBakes", {});
    made[id] = this.bakeKey(scene);
    this.d.prefs.set("sceneBakes", made);
  }

  // Scenes not baked yet, or baked for lights that have changed since, so they play as they should.
  async keepReady() {
    try {
      const list = await this.d.api("api/house-scenes");
      const made = this.d.prefs.get("sceneBakes", {});
      for (const row of list) {
        const scene = row.mode === "advanced"
          ? { name: row.name, mode: "advanced", loop: row.loop, tracks: row.tracks || [] }
          : { name: row.name, mode: row.mode, lights: row.lights, ...(row.all ? { all: row.all } : {}) };
        if (!row.baked || made[row.id] !== this.bakeKey(scene)) await this.bakeAndSend(row.id, scene);
      }
      for (const id of Object.keys(made)) if (!list.some((s) => s.id === id)) delete made[id];
      this.d.prefs.set("sceneBakes", made);
    } catch { /* tried again next time */ }
  }

  drawPlayButton() {
    const b = $("sc-play");
    if (!b || !this.id) return;
    const on = this.playingId() === this.id;
    b.textContent = on ? "■ Stop" : "▶ Play on lights";
    b.onclick = () => (on ? this.stop(this.id) : this.play(this.id));
  }

  // Preview: the scene moving on the house photo, as the lights would show it.
  startPreview() {
    if (this.raf) return;
    const t0 = performance.now();
    const frame = () => {
      if ($("view-scene").hidden || !this.scene) { this.raf = 0; return; }
      const t = (performance.now() - t0) / 1000;
      this.previewShow ||= sceneShow(this.scene, this.d.lights(), 3600);
      const show = this.previewShow;
      const trackOf = (id) => show.tracks.find((tr) => tr.device === id);
      const frames = new Map();
      const full = (light) => {
        if (!frames.has(light.id)) frames.set(light.id, this.d.asShown(light, t, (at) => composeLight(light, trackOf, at)));
        return frames.get(light.id);
      };
      const byId = Object.fromEntries(this.d.lights().map((l) => [l.id, l]));
      this.d.house.paint($("sc-canvas"), Math.min(window.innerHeight * 0.4, 340), (dev) => {
        if (!dev.parent) return full(byId[dev.id] || dev);
        return full(byId[dev.parent]).slice((dev.from - 1) * 3, dev.to * 3);
      });
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stopPreview() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
