// The Schedule tab: every entry that plays a playlist, show or scene by itself (schedule.py), highest
// priority first. Each entry's times are edited with the app's schedule editor (the one playlists had);
// this draws the list, keeps the order, and saves the whole list as you go.

import { askYes } from "./ask.js";
import { KIND_NAMES, describeSchedule, newEntry, whenNext } from "./schedule.js";

const SAVE_AFTER_MS = 600;
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids.filter((x) => x != null));
  return e;
}

export class SchedulePage {
  // deps: api, status(msg, kind, key), timesEditor(holder, {onChange, noteFor, label}) (app.js's
  // schedule editor, which edits holder.schedule), targets() -> {playlist: [{id, name}], show, scene},
  // stateChanged(state) (so the rest of the app knows the clock, next starts and entries).
  constructor(deps) {
    this.d = deps;
    this.entries = [];
    this.state = {};
    this.loaded = false;
    this.timer = null;
    this.saving = Promise.resolve();
    this.dragging = null;
  }

  async load() {
    await this.flush();
    try {
      this.take(await this.d.api("api/schedule"));
      this.loaded = true;
    } catch (e) {
      this.d.status(`Couldn't load the schedule: ${e.message}`, true, "schedule");
    }
    return this.state;
  }

  take(state) {
    this.state = state;
    if (!this.timer) this.entries = state.entries || [];
    this.d.stateChanged?.(state);
  }

  // Saving -----------------------------------------------------------------------
  changed() {
    if (!this.loaded) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), SAVE_AFTER_MS);
  }

  save() {
    clearTimeout(this.timer);
    this.timer = null;
    const entries = this.entries.map((e) => ({ ...e }));
    this.saving = this.saving.then(async () => {
      try {
        const st = await this.d.api("api/schedule", { method: "PUT", json: entries });
        this.state = st;
        this.d.stateChanged?.(st);
        this.d.status("Schedule saved", "saved", "schedule");
        this.notes();
      } catch (e) {
        this.d.status(`Couldn't save the schedule: ${e.message}`, true, "schedule");
      }
    });
    return this.saving;
  }

  async flush() {
    if (this.timer) this.save();
    await this.saving;
  }

  // Adding from elsewhere (a playlist's card, a scene) --------------------------------
  async add(type, id) {
    if (!this.loaded) await this.load();
    if (!this.loaded) return;
    const e = newEntry(type, id, this.entries);
    this.entries.push(e);
    this.changed();
    this.draw();
    $(`sched-${e.id}`)?.scrollIntoView({ block: "center" });
  }

  // + Add to schedule on the tab: the first playlist (else show, else scene), to change in its row.
  addAny() {
    const t = this.d.targets();
    const type = ["playlist", "show", "scene"].find((k) => t[k]?.length);
    if (!type) {
      this.d.status("Make a playlist, show or scene first", "hint", "schedule");
      return;
    }
    this.add(type, t[type][0].id);
  }

  // Drawing ---------------------------------------------------------------------------
  name(e) {
    const t = this.d.targets()[e.play.type] || [];
    return t.find((x) => x.id === e.play.id)?.name || null;
  }

  noteFor(e) {
    if (!e.on) return "Switched off.";
    if (!this.name(e)) return `This ${KIND_NAMES[e.play.type]} has been deleted, so it's skipped.`;
    const scene = e.play.type === "scene";
    if ((scene ? this.state.scene_scheduled : this.state.scheduled) === e.id) {
      return scene ? "On now." : "Playing now.";
    }
    if (e.start === "sunset" && !this.state.location) return "To know when sunset is, it needs where you are: add it below.";
    const next = this.state.next?.[e.id];
    if (!next || !this.state.now) return e.days.length ? "" : "Pick at least one day.";
    return `Next starts ${whenNext(next, this.state.now)}.`;
  }

  notes() {
    for (const e of this.entries) {
      const row = $(`sched-${e.id}`);
      if (!row) continue;
      row.querySelector(".playlist-next").textContent = this.noteFor(e);
      row.classList.toggle("playing", [this.state.scheduled, this.state.scene_scheduled].includes(e.id));
    }
  }

  draw() {
    const list = $("sched-list");
    if (!list) return;
    if (!this.entries.length) {
      list.replaceChildren(el("p", { class: "hint" }, this.loaded
        ? "Nothing on the schedule yet. Press + Add to schedule, or add a playlist or scene from its own page." : ""));
    } else {
      list.replaceChildren(...this.entries.map((e, k) => this.row(e, k)));
    }
    $("sched-add").disabled = !this.loaded;
    this.notes();
  }

  picker(e) {
    const targets = this.d.targets();
    const sel = el("select", { "aria-label": "What it plays" });
    for (const [type, label] of [["playlist", "Playlists"], ["show", "Shows"], ["scene", "Scenes"]]) {
      const items = targets[type] || [];
      if (!items.length) continue;
      const g = el("optgroup", { label });
      for (const x of items) g.append(new Option(x.name, `${type}:${x.id}`));
      sel.append(g);
    }
    if (!this.name(e)) sel.prepend(new Option(`(deleted ${KIND_NAMES[e.play.type]}: ${e.play.id})`, `${e.play.type}:${e.play.id}`));
    sel.value = `${e.play.type}:${e.play.id}`;
    sel.addEventListener("change", () => {
      const [type, ...rest] = sel.value.split(":");
      e.play = { type, id: rest.join(":") };
      this.changed();
      this.draw();
    });
    return sel;
  }

  row(e, k) {
    const label = this.name(e) || e.play.id;
    const move = (to) => {
      if (to < 0 || to >= this.entries.length) return;
      this.entries.splice(k, 1);
      this.entries.splice(to, 0, e);
      this.changed();
      this.draw();
      $(`sched-${e.id}`)?.querySelector(to < k ? ".sched-up" : ".sched-down")?.focus();
    };
    const handle = el("span", { class: "sched-grip", "aria-hidden": "true", title: "Drag to change the order" }, "⠿");
    const head = el("div", { class: "sched-head" }, handle,
      el("span", { class: "sched-kind" }, KIND_NAMES[e.play.type]), this.picker(e),
      el("span", { class: "sched-actions" },
      el("button", { type: "button", class: "ghost sched-up", disabled: k === 0, onclick: () => move(k - 1),
        "aria-label": `Move ${label} up`, title: "Higher: plays first where times overlap" }, "↑"),
      el("button", { type: "button", class: "ghost sched-down", disabled: k === this.entries.length - 1,
        onclick: () => move(k + 1), "aria-label": `Move ${label} down` }, "↓"),
      el("button", { type: "button", class: "ghost", "aria-label": `Delete this entry for ${label}`, onclick: async () => {
        if (!(await askYes(`Take ${label} (${describeSchedule(e)}) off the schedule?`, { yes: "Take it off" }))) return;
        this.entries = this.entries.filter((x) => x !== e);
        this.changed();
        this.draw();
      } }, "Delete")));
    const holder = {
      get schedule() { return e; },
      set schedule(v) { Object.assign(e, v); },
    };
    const times = this.d.timesEditor(holder, { onChange: () => this.changed(), noteFor: () => this.noteFor(e), label: " On" });
    const row = el("div", { class: `sched-entry${this.name(e) ? "" : " missing"}`, id: `sched-${e.id}`, role: "listitem" },
      head, times);
    // Dragging by the grip reorders; the row is only draggable while the grip is held, so times can be typed.
    handle.addEventListener("pointerdown", () => { row.draggable = true; });
    row.addEventListener("dragstart", (ev) => { this.dragging = e; ev.dataTransfer.effectAllowed = "move"; row.classList.add("dragging"); });
    row.addEventListener("dragend", () => { row.draggable = false; row.classList.remove("dragging"); this.dragging = null; });
    row.addEventListener("dragover", (ev) => { if (this.dragging && this.dragging !== e) ev.preventDefault(); });
    row.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const from = this.entries.indexOf(this.dragging);
      if (from < 0 || this.dragging === e) return;
      this.entries.splice(from, 1);
      this.entries.splice(this.entries.indexOf(e) + (from < k ? 1 : 0), 0, this.dragging);
      this.changed();
      this.draw();
    });
    return row;
  }
}
