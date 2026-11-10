// The Schedule tab: every entry that plays a playlist, show or scene by itself (schedule.py), highest
// priority first. Each entry's times are edited with the app's schedule editor (the one playlists had);
// this draws the list, keeps the order, and saves the whole list as you go.

import { askYes } from "./ask.js";
import { folderOf, pathText, pickerView } from "./folders.js";
import { KIND_NAMES, PICK_TABS, describeSchedule, newEntry, pickList, whenNext } from "./schedule.js";
import { weekLayout } from "./weekview.js";

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
    this.weekFrom = null; // the week view's first day, "YYYY-MM-DD"; null is today
    this.weekAsked = 0;
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
        this.drawWeek();
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

  // A window to pick a playlist, show or scene: a tab for each, opening on the folders of Library →
  // Playlists, Shows or Scenes, and a box to find one by name in any of them. Resolves with
  // {type, id}, or null when closed.
  choose(current, title = "What it plays") {
    return new Promise((resolve) => {
      const targets = this.d.targets();
      const foldersFor = (type) => this.d.folders?.(type) || [];
      let tab = current?.type || PICK_TABS.find(([k]) => targets[k]?.length)?.[0] || "playlist";
      // The folder open on each tab, starting where the current choice is.
      const at = Object.fromEntries(PICK_TABS.map(([k]) => [k, current?.type === k ? folderOf(foldersFor(k), current.id) : ""]));
      let result = null;
      const dlg = el("dialog", { class: "effect-dialog form-dialog sched-pick", "aria-label": title });
      const find = el("input", { type: "search", placeholder: "Find by name", autocomplete: "off", "aria-label": "Find by name" });
      const tabs = el("div", { class: "sched-tabs", role: "tablist", "aria-label": "Playlists, shows or scenes" });
      const list = el("div", { class: "song-list sched-pick-list", role: "listbox", "aria-label": title });
      const path = el("nav", { class: "folder-path", "aria-label": "Where you are", hidden: true });
      const pick = (x) => { result = { type: x.type, id: x.id }; dlg.close(); };
      const draw = () => {
        const words = find.value.trim();
        tabs.replaceChildren(...PICK_TABS.map(([k, label]) => el("button", { type: "button", role: "tab",
          class: "sched-tab", "aria-selected": String(!words && k === tab), disabled: !targets[k]?.length,
          onclick: () => { tab = k; find.value = ""; draw(); } }, `${label} (${targets[k]?.length || 0})`)));
        const folders = foldersFor(tab);
        const view = words ? null : pickerView(folders, (targets[tab] || []).map((x) => ({ key: x.id, name: x.name })), at[tab]);
        const items = words ? pickList(targets, tab, words)
          : view.items.map((it) => ({ type: tab, id: it.key, name: it.name }));
        // Where you are: Playlists › Christmas › Carols, each part a way back up.
        path.hidden = !!words || !view.path.length;
        path.replaceChildren(...(words ? [] : [{ id: "", name: PICK_TABS.find(([k]) => k === tab)[1] }, ...view.path]).flatMap((f, i, all) => {
          const part = i === all.length - 1 ? el("b", {}, f.name)
            : el("button", { type: "button", class: "ghost path-part", onclick: () => { at[tab] = f.id; draw(); } }, f.name);
          return i ? [el("span", { class: "hint" }, " › "), part] : [part];
        }));
        const folderRows = (view?.folders || []).map(({ folder, count }) => el("button", { type: "button",
          class: "song-row sched-folder", onclick: () => { at[tab] = folder.id; draw(); list.querySelector("button")?.focus(); } },
        el("span", { class: "folder-mark small", "aria-hidden": "true" }),
        el("span", {}, el("b", {}, folder.name), el("span", { class: "hint" }, `${count} ${KIND_NAMES[tab]}${count === 1 ? "" : "s"} ›`))));
        const where = (x) => {
          const f = pathText(foldersFor(x.type), x.id);
          return [KIND_NAMES[x.type], f ? `in ${f}` : ""].filter(Boolean).join(" · ");
        };
        const rows = items.map((x) => {
          const on = current && x.type === current.type && x.id === current.id;
          return el("button", { type: "button", role: "option", "aria-selected": String(!!on),
            class: `song-row${on ? " picked" : ""}`, onclick: () => pick(x) },
          el("span", {}, el("b", {}, x.name), words ? el("span", { class: "hint" }, where(x)) : null));
        });
        list.replaceChildren(...folderRows, ...rows);
        if (!list.children.length) {
          list.append(el("p", { class: "hint" }, words ? `Nothing called ${words}.` : targets[tab]?.length ? "Nothing in this folder." : "None yet."));
        }
      };
      find.addEventListener("input", draw);
      dlg.append(
        el("div", { class: "effect-dialog-head" }, el("h3", {}, title),
          el("button", { type: "button", class: "ghost", "aria-label": "Close", onclick: () => dlg.close() }, "✕")),
        el("div", { class: "form-dialog-body" }, tabs, el("div", { class: "ns-find" }, find), path, list));
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
    this.drawWeek();
  }

  // The week view: seven days from today (or the week picked with ‹ ›), a row each, every stretch a
  // bar in the row's colour. Hatched where a row higher up plays instead; a scene's bar is faded where
  // it waits for a playlist or show.
  async drawWeek() {
    const box = $("sched-week");
    if (!box || !this.loaded) return;
    const asked = ++this.weekAsked;
    let week;
    try {
      week = await this.d.api(`api/schedule/week${this.weekFrom ? `?start=${this.weekFrom}` : ""}`);
    } catch (e) {
      box.replaceChildren(el("p", { class: "hint" }, `Couldn't work out the week: ${e.message}`));
      return;
    }
    if (asked !== this.weekAsked) return; // a newer one is on its way
    // HA-liday Show's own clock decides what today is, as it does for the schedule.
    const now = new Date();
    const today = (this.state.now || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`).slice(0, 10);
    const order = new Map(this.entries.map((e, k) => [e.id, k]));
    const w = weekLayout(week, (id) => {
      const e = this.entries.find((x) => x.id === id);
      return e ? this.name(e) || `Deleted ${KIND_NAMES[e.play.type]}` : id;
    }, today);
    const shift = (days) => {
      const d = new Date(`${week.days[0]}T00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      this.weekFrom = d.toISOString().slice(0, 10) === today ? null : d.toISOString().slice(0, 10);
      this.drawWeek();
    };
    const nav = el("div", { class: "sched-week-nav" },
      el("button", { type: "button", class: "ghost small", "aria-label": "The week before", onclick: () => shift(-7) }, "‹"),
      el("span", { class: "sched-week-range" }, `${w.days[0].label} to ${w.days[6].label}`),
      el("button", { type: "button", class: "ghost small", "aria-label": "The week after", onclick: () => shift(7) }, "›"),
      this.weekFrom ? el("button", { type: "button", class: "ghost small", onclick: () => { this.weekFrom = null; this.drawWeek(); } }, "From today") : null);
    const axis = el("div", { class: "sched-week-axis" }, ...w.ticks.map((t) => el("span", { style: `left:${t.left}%` }, t.label)));
    const colour = (id) => `hsl(${((order.get(id) ?? 0) * 137 + 200) % 360} 60% 38%)`;
    const find = (id) => {
      const row = $(`sched-${id}`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.classList.add("flash");
      setTimeout(() => row?.classList.remove("flash"), 1500);
    };
    const rows = w.days.map((d) => el("div", { class: `sched-week-day${d.today ? " today" : ""}` },
      el("span", { class: "sched-week-label" }, d.label, d.today ? el("small", {}, " today") : null),
      el("div", { class: "sched-week-track" }, ...w.ticks.map((t) => el("span", { class: "sched-week-line", style: `left:${t.left}%` })),
        ...d.bars.map((b) => el("button", { type: "button", class: `sched-week-bar ${b.lane}`, title: b.title, "aria-label": b.title,
          style: `left:${b.left}%;width:${b.width}%;--bar:${colour(b.entry)}`, onclick: () => find(b.entry) },
        el("span", { class: "sched-week-name" }, b.name),
        ...b.waits.map((c) => el("span", { class: "sched-week-waits", style: `left:${c.left}%;width:${c.width}%` })))),
        // A row's time spent waiting for another to finish: a hatched strip in its colour.
        ...d.waiting.map((c) => el("button", { type: "button", class: `sched-week-covered ${c.lane}`, title: c.title, "aria-label": c.title,
          style: `left:${c.left}%;width:${c.width}%;--bar:${colour(c.entry)}`, onclick: () => find(c.entry) })))));
    const sunsetRows = this.entries.some((e) => e.on && e.start === "sunset");
    const empty = w.days.every((d) => !d.bars.length && !d.waiting.length)
      ? el("p", { class: "hint" }, !this.entries.length ? "Nothing on the schedule yet."
        : sunsetRows && !this.state.location ? "Nothing plays this week. Rows that start at sunset need to know where you are: set it below."
        : "Nothing plays this week.") : null;
    box.replaceChildren(nav, el("div", { class: "sched-week-grid" }, el("span"), axis, ...rows), ...(empty ? [empty] : []));
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
