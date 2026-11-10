// Picking a palette by eye: a window of colour bars, grouped (built in, yours), instead of a list of
// names. A group given its Library folders shows them, to go into, as the Palettes page does. pickPalette() resolves with the chosen palette's name, "" for None (when offered), or null
// if the window was closed without a choice. paletteButton() is the button that opens it.

import { folderOf, pickerView } from "./folders.js";

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...kids.flat().filter((k) => k != null));
  return e;
};

export function colourBar(colors, cls = "palette-bar") {
  return el("span", { class: cls, "aria-hidden": "true" }, ...colors.map((c) => {
    const s = el("span");
    s.style.background = c;
    return s;
  }));
}

// groups: [[heading, [{name, colors}], folders?]], where folders are Library → Palettes' (keyed by
// name). current: the name picked now ("" for None). none: the label for a None choice, or null for no
// such choice. note(p): an optional word after a name, such as "in season".
export function pickPalette({ title = "Pick a palette", groups, current = "", none = null, note = () => "" }) {
  return new Promise((resolve) => {
    let chosen = null;
    const dlg = el("dialog", { class: "effect-dialog palette-picker", "aria-label": title });
    const pick = (name) => { chosen = name; dlg.close(); };
    const choice = (name, label, colors, extra = "") => el("button", {
      type: "button", class: `palette-choice${name === current ? " active" : ""}`,
      "aria-pressed": name === current ? "true" : "false", onclick: () => pick(name),
    }, colors ? colourBar(colors) : el("span", { class: "palette-bar palette-none", "aria-hidden": "true" }),
    el("span", { class: "palette-choice-name" }, label, extra ? el("small", {}, ` ${extra}`) : null));
    const body = el("div", { class: "effect-dialog-body" });
    // The folder open in each group with folders, starting where the current palette is.
    const at = groups.map(([, list, folders]) => (folders?.length && list.some((p) => p.name === current) ? folderOf(folders, current) : ""));
    const draw = () => {
      body.replaceChildren();
      if (none) body.append(el("div", { class: "palette-grid" }, choice("", none, null)));
      groups.forEach(([heading, list, folders], g) => {
        if (!list.length) return;
        if (!folders?.length) {
          body.append(el("div", { class: "section-label effect-dialog-section" }, heading),
            el("div", { class: "palette-grid" }, ...list.map((p) => choice(p.name, p.name, p.colors, note(p)))));
          return;
        }
        const byName = new Map(list.map((p) => [p.name, p]));
        const view = pickerView(folders, list.map((p) => ({ key: p.name, name: p.name })), at[g]);
        const go = (id) => { at[g] = id; draw(); body.querySelector(`[data-group="${g}"] button`)?.focus(); };
        // The heading is the way back up: Your palettes › Christmas.
        const head = el("div", { class: "section-label effect-dialog-section palette-path", "data-group": g },
          ...[{ id: "", name: heading }, ...view.path].flatMap((f, i, all) => {
            const part = i === all.length - 1 ? el("span", {}, f.name)
              : el("button", { type: "button", class: "link-button", onclick: () => go(f.id) }, f.name);
            return i ? [el("span", { "aria-hidden": "true" }, " › "), part] : [part];
          }));
        const tiles = [
          ...view.folders.map(({ folder, count }) => el("button", { type: "button", class: "palette-choice palette-folder",
            onclick: () => go(folder.id) }, el("span", { class: "folder-mark small", "aria-hidden": "true" }),
          el("span", { class: "palette-choice-name" }, folder.name, el("small", {}, ` ${count} ›`)))),
          ...view.items.map((it) => { const p = byName.get(it.key); return choice(p.name, p.name, p.colors, note(p)); }),
        ];
        body.append(head, el("div", { class: "palette-grid", "data-group": g },
          ...(tiles.length ? tiles : [el("p", { class: "hint" }, "Nothing in this folder.")])));
      });
    };
    draw();
    dlg.append(el("div", { class: "effect-dialog-head" }, el("h3", {}, title),
      el("button", { type: "button", class: "ghost", "aria-label": "Close", title: "Close (Esc)", onclick: () => dlg.close() }, "✕")), body);
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
    dlg.addEventListener("close", () => { dlg.remove(); resolve(chosen); });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector(".palette-choice.active")?.focus();
  });
}

// A button showing a palette (its colours and name) that opens pickPalette(); onPick(name) runs with
// a new choice. Returns the button, with set(name, colors) to show another palette.
export function paletteButton({ label = "Palette", current = "", colors = null, none = null, ...opts }, onPick) {
  // Like every button that opens a window to choose from: what's chosen, then "Change…" (never ▾).
  const b = el("button", { type: "button", class: "picker-button palette-button", "aria-haspopup": "dialog" });
  const set = (name, cols) => {
    b.replaceChildren(cols?.length ? colourBar(cols, "palette-bar palette-bar-small") : el("span", { class: "palette-bar palette-bar-small palette-none" }),
      el("span", { class: "picker-name" }, name || none || "None"), el("span", { class: "picker-change", "aria-hidden": "true" }, "Change…"));
    b.dataset.value = name || "";
    b.setAttribute("aria-label", `${label}: ${name || none || "none"}. Change`);
  };
  set(current, colors);
  b.addEventListener("click", async () => {
    const name = await pickPalette({ ...opts, current: b.dataset.value, none });
    if (name === null || name === b.dataset.value) return;
    onPick(name);
  });
  b.set = set;
  return b;
}
