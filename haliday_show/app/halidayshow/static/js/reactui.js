// React to music on a scene (react.py plays it): the settings form, for the Scene editor and the
// Advanced scene's React to music… window, and the line that says what it does.

export const REACT_DEFAULTS = { on: false, quiet: 20, flash: true, strength: 60, bass: "", treble: "", quietSecs: 4 };

// The scene's react setting with every field there (old scenes have none).
export function reactOf(scene) {
  return { ...REACT_DEFAULTS, ...(scene?.react || {}) };
}

// Scenes that can be the strong bass or treble look: any other scene, by name.
export function lookChoices(scenes, selfId) {
  return scenes.filter((s) => s.id !== selfId).map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// What it does, in a line: "Off", or "Louder is brighter (down to 20%) · flashes on beats · strong bass: Thump".
export function reactSummary(cfg, nameOf = (id) => id) {
  if (!cfg?.on) return "Off";
  const bits = [`Louder is brighter (down to ${cfg.quiet}%)`];
  if (cfg.flash) bits.push("flashes on beats");
  if (cfg.bass) bits.push(`strong bass: ${nameOf(cfg.bass) || "a deleted scene"}`);
  if (cfg.treble) bits.push(`strong treble: ${nameOf(cfg.treble) || "a deleted scene"}`);
  return bits.join(" · ");
}

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

// The form. cfg is changed in place; onChange(cfg) after each change. scenes: [{id, name}] to pick
// the strong bass and treble looks from. heard: GET api/live-music's answer, or null.
export function reactForm(cfg, { scenes = [], heard = null, idPrefix = "rx" } = {}, onChange = () => {}) {
  const changed = () => { draw(); onChange(cfg); };
  const box = el("div", { class: "react-form" });
  const id = (k) => `${idPrefix}-${k}`;

  const on = el("input", { type: "checkbox", id: id("on"), checked: cfg.on });
  on.addEventListener("change", () => { cfg.on = on.checked; changed(); });

  const slider = (key, min, max, label, unit) => {
    const input = el("input", { type: "range", id: id(key), min, max, step: 5, value: cfg[key] });
    const out = el("output", { for: id(key) }, `${cfg[key]}${unit}`);
    input.addEventListener("input", () => { cfg[key] = Number(input.value); out.textContent = `${cfg[key]}${unit}`; });
    input.addEventListener("change", changed);
    return el("label", { class: "react-row" }, el("span", {}, label), input, out);
  };

  const flash = el("input", { type: "checkbox", id: id("flash"), checked: cfg.flash });
  flash.addEventListener("change", () => { cfg.flash = flash.checked; changed(); });

  const look = (key, label) => {
    const sel = el("select", { id: id(key) }, el("option", { value: "" }, "None: stay on this scene"),
      ...scenes.map((s) => el("option", { value: s.id }, s.name)));
    if (cfg[key] && !scenes.some((s) => s.id === cfg[key])) sel.append(el("option", { value: cfg[key] }, "A deleted scene"));
    sel.value = cfg[key];
    sel.addEventListener("change", () => { cfg[key] = sel.value; changed(); });
    return el("label", { class: "react-row" }, el("span", {}, label), sel);
  };

  const secs = el("input", { type: "number", id: id("secs"), min: 1, max: 60, step: 1, value: cfg.quietSecs });
  secs.addEventListener("change", () => {
    const v = Math.round(Number(secs.value));
    cfg.quietSecs = Number.isFinite(v) ? Math.max(1, Math.min(60, v)) : 4;
    secs.value = cfg.quietSecs;
    changed();
  });

  const more = el("div", { class: "react-more" });
  const draw = () => {
    more.hidden = !cfg.on;
    strength.hidden = !cfg.flash;
  };
  const strength = slider("strength", 10, 100, "Flash strength", "%");
  more.append(
    slider("quiet", 0, 100, "When it's quiet, down to", "%"),
    el("label", { class: "react-row" }, flash, el("span", {}, " Flash on each beat")),
    strength,
    look("bass", "Strong bass plays"),
    look("treble", "Strong treble plays"),
    el("label", { class: "react-row" }, el("span", {}, "Back to normal after"), secs, el("span", {}, " seconds of quiet")),
  );
  box.append(
    el("label", { class: "react-on" }, on, el("span", {}, " React to music")),
    el("p", { class: "hint" }, "Follows what a WLED with a microphone hears: louder is brighter, beats flash, and strong bass "
      + "or treble can switch to another scene. With no music it plays as normal."),
    heardLine(heard),
    more,
  );
  draw();
  return box;
}

function heardLine(heard) {
  if (!heard) return null;
  const where = el("b", {}, "Setup → Settings → Live music");
  if (!heard.listening) return el("p", { class: "hint" }, "HA-liday Show can't listen for WLED right now. See ", where, ".");
  if (!heard.now) return el("p", { class: "hint" }, "No WLED is sending sound right now. Set one up under ", where, ".");
  return el("p", { class: "hint" }, heard.music ? "Hearing music now." : "A WLED is listening, but it's quiet.",
    " Which WLED and how loud counts as music are under ", where, ".");
}
