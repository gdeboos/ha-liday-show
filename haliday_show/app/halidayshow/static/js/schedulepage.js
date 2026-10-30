// The Schedule tab: every entry that plays a playlist, show or scene by itself (schedule.py), highest
// priority first. Each entry's times are edited with the app's schedule editor (the one playlists had);
// this draws the list, keeps the order, and saves the whole list as you go.

import { askYes } from "./ask.js";
import { KIND_NAMES, PICK_TABS, describeSchedule, newEntry, pickList, whenNext } from "./schedule.js";

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

  // + Add to schedule on the tab: pick what it plays, then set its times in its row.
  async addAny() {
    const t = this.d.targets();
    if (!PICK_TABS.some(([k]) => t[k]?.length)) {
      this.d.status("Make a playlist, show or scene first", "hint", "schedule");
      return;
    }
    const picked = await this.choose(null, "Add to the schedule");
    if (picked) this.add(picked.type, picked.id);
  }

  // A window to pick a playlist, show or scene: a tab for each, and a box to find one by name.
  // Resolves with {type, id}, or null when closed.
  choose(current, title = "What it plays") {
    return new Promise((resolve) => {
      const targets = this.d.targets();
      let tab = current?.type || PICK_TABS.find(([k]) => targets[k]?.length)?.[0] || "playlist";
      let result = null;
      const dlg = el("dialog", { class: "effect-dialog form-dialog sched-pick", "aria-label": title });
      const find = el("input", { type: "search", placeholder: "Find by name", autocomplete: "off", "aria-label": "Find by name" });
      const tabs = el("div", { class: "sched-tabs", role: "tablist", "aria-label": "Playlists, shows or scenes" });
      const list = el("div", { class: "song-list sched-pick-list", role: "listbox", "aria-label": title });
      const pick = (x) => { result = { type: x.type, id: x.id }; dlg.close(); };
      const draw = () => {
        const words = find.value.trim();
        tabs.replaceChildren(...PICK_TABS.map(([k, label]) => el("button", { type: "button", role: "tab",
          class: "sched-tab", "aria-selected": String(!words && k === tab), disabled: !targets[k]?.length,
          onclick: () => { tab = k; find.value = ""; draw(); } }, `${label} (${targets[k]?.length || 0})`)));
        const items = pickList(targets, tab, words);
        list.replaceChildren(...(items.length ? items.map((x) => {
          const on = current && x.type === current.type && x.id === current.id;
          return el("button", { type: "button", role: "option", "aria-selected": String(!!on),
            class: `song-row${on ? " picked" : ""}`, onclick: () => pick(x) },
          el("span", {}, el("b", {}, x.name), words ? el("span", { class: "hint" }, KIND_NAMES[x.type]) : null));
        }) : [el("p", { class: "hint" }, words ? `Nothing called ${words}.` : "None yet.")]));
      };
      find.addEventListener("input", draw);
      dlg.append(
        el("div", { class: "effect-dialog-head" }, el("h3", {}, title),
          el("button", { type: "button", class: "ghost", "aria-label": "Close", onclick: () => dlg.close() }, "✕")),
        el("div", { class: "form-dialog-body" }, tabs, el("div", { class: "ns-find" }, find), list));
      dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
      document.body.append(dlg);
      draw();
      dlg.showModal();
      (list.querySelector(".picked") || find).focus();
      list.querySelector(".picked")?.scrollIntoView({ block: "center" });
    });
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

  // What the entry plays: its name on a button that opens the picker.
  picker(e) {
    const name = this.name(e) || `Deleted ${KIND_NAMES[e.play.type]}`;
    return el("button", { type: "button", class: "picker-button sched-what", "aria-haspopup": "dialog",
      "aria-label": `Plays ${name}. Change…`, title: "Pick a playlist, show or scene",
      onclick: async () => {
        const picked = await this.choose(e.play);
        if (!picked || (picked.type === e.play.type && picked.id === e.play.id)) return;
        e.play = picked;
        this.changed();
        this.draw();
        $(`sched-${e.id}`)?.querySelector(".sched-what")?.focus();
      } },
    el("span", { class: "picker-name" }, name), el("span", { class: "picker-change", "aria-hidden": "true" }, "Change…"));
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
