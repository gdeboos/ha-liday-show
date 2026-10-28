// The Scene editor and the lists of scenes (Library → Scenes, and where the Scene tab starts).
// A scene's logic is in housescenes.js; scenelib.py keeps them and the runner plays them round and
// round. This draws the pages, saves as you go, and bakes each scene's loop for the player.

import { EFFECTS, FPS, bake, composeLight, matchesPreset, presetParams } from "./effects.js";
import {
  SCENE_EFFECTS, changeEffect, clipFor, newScene, sceneColours, sceneLoop, sceneShow, sceneSummary, setSame, speedParam,
  toAdvanced,
} from "./housescenes.js";
import { applyPalette, paletteKeys } from "./palettes.js";
import { describeSchedule } from "./schedule.js";
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
  // scheduleEditor(holder, id, onChange) (the playlists' When it plays, for a scene)
  constructor(deps) {
    this.d = deps;
    this.scenes = [];
    this.scene = null; // the open scene
    this.id = null;
    this.timer = null;
    this.saving = Promise.resolve();
    this.raf = 0;
    this.status = null; // the player's status, for ▶/■ and badges
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
    const when = s.schedule?.on ? ` · comes on ${describeSchedule(s.schedule)}` : "";
    const main = el("div", { class: "show-main" }, head, el("div", { class: "hint" }, sceneSummary(s, lights) + when));
    const play = playing
      ? el("button", { type: "button", class: "primary", onclick: () => this.stop(s.id), "aria-label": `Stop ${s.name}` }, "■ Stop")
      : el("button", { type: "button", class: "primary", onclick: () => this.play(s.id), disabled: !s.baked,
        "aria-label": `Play ${s.name}`, title: s.baked ? `Play ${s.name} on your lights` : "Open it once so it's ready to play" }, "▶ Play");
    const actions = el("div", { class: "group show-actions" }, play,
      el("button", { type: "button", class: "ghost", onclick: () => this.open(s.id), "aria-label": `Edit ${s.name}` }, "Edit"),
      el("button", { type: "button", class: "ghost", onclick: () => this.remove(s), "aria-label": `Remove ${s.name}` }, "Remove…"));
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
    // An Advanced scene's House lane also depends on where the lights are on the house.
    return JSON.stringify([look, this.d.lightsKey(), scene.mode === "advanced" ? this.d.positions() : null]);
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
      rows.replaceChildren(...lights.map((d) => this.lookRow(d.name, s.lights[d.id] || null, (look) => {
        if (look) s.lights[d.id] = look;
        else delete s.lights[d.id];
      })));
    }
    $("sc-when").replaceChildren(this.d.scheduleEditor(this.scene, this.id, () => this.changed()));
    this.drawPlayButton();
    this.startPreview();
  }

  // One light's row: effect (or Off), style, colours, speed and brightness.
  lookRow(label, look, set) {
    const changed = (redraw) => { this.changed(); if (redraw) this.draw(); };
    const row = el("div", { class: "sc-row", role: "group", "aria-label": label });
    const eff = el("select", { "aria-label": `Effect for ${label}` });
    if (label !== "Every light") eff.add(new Option("Off", ""));
    for (const k of SCENE_EFFECTS) eff.add(new Option(EFFECTS[k].label, k, false, k === look?.effect));
    if (!look) eff.value = "";
    eff.addEventListener("change", () => { set(eff.value ? changeEffect(look, eff.value) : null); changed(true); });
    row.append(el("span", { class: "sc-light" }, label), eff);
    if (!look) {
      row.append(el("span", { class: "hint sc-off" }, "Off in this scene"));
      return row;
    }
    const clip = clipFor(look, 0, 1);
    const style = el("select", { "aria-label": `Style for ${label}` });
    const presets = this.d.presetsFor(look.effect);
    style.add(new Option("Style…", ""));
    presets.forEach((p, k) => style.add(new Option(p.label || p.name, String(k), false, matchesPreset(p, clip))));
    style.hidden = !presets.length;
    style.addEventListener("change", () => {
      const p = presets[Number(style.value)];
      if (!p) return;
      look.params = { ...look.params, ...presetParams(p, clip) };
      changed(true);
    });
    const keys = paletteKeys(look.effect);
    const colours = el("select", { "aria-label": `Colours for ${label}` });
    colours.add(new Option("Colours…", ""));
    this.d.palettes().forEach((p, k) => colours.add(new Option(p.name, String(k))));
    colours.hidden = !keys.length;
    colours.addEventListener("change", () => {
      const p = this.d.palettes()[Number(colours.value)];
      if (!p) return;
      const c = { effect: look.effect, ...look.params };
      applyPalette(c, p.colors);
      for (const k of keys) look.params[k] = c[k];
      changed(true);
    });
    const swatches = el("span", { class: "sc-swatches" }, ...keys.map((k) => {
      const input = el("input", { type: "color", value: clip[k], "aria-label": `${EFFECTS[look.effect].params.find((p) => p.key === k).label} for ${label}` });
      input.addEventListener("input", () => { look.params[k] = input.value; this.changed({ live: true }); });
      input.addEventListener("change", () => { look.params[k] = input.value; changed(false); });
      return input;
    }));
    row.append(style, el("span", { class: "sc-colours" }, colours, swatches));
    const sp = speedParam(look.effect);
    row.append(sp ? this.slider("Speed", label, sp, clip[sp.key], (v) => { look.params[sp.key] = v; })
      : el("span", { class: "sc-nospeed hint" }, "—"));
    const br = EFFECTS[look.effect].params.find((p) => p.key === "brightness");
    row.append(br ? this.slider("Brightness", label, br, clip.brightness, (v) => { look.params.brightness = v; })
      : el("span"));
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
