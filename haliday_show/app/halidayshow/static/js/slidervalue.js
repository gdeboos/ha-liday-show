// Every slider gets a small box beside it with its exact number, which you can type into or step with
// the arrow keys, so two lights can be set to exactly the same. A slider made anywhere in the editor
// gets one as it appears (watchSliders). The box drives the slider as dragging does: it sets the value
// and sends the slider's own "input" and "change", so nothing else needs to know about it.

const VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
// A read-out that's just a number and a unit ("50%", "-6 dB"): the box says the same, so it's hidden.
const PLAIN = /^\s*[−+-]?\d+(?:[.,]\d+)?\s*(%|dB|s|ms|°|×|x|px|BPM)?\s*$/;

// How the box shows a slider's number: a slider from 0 to 1 (or less) shows as a percentage.
export function scaleOf(min, max) {
  return min >= 0 && max <= 1 ? 100 : 1;
}

export function decimals(step, scale) {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const s = String(+(step * scale).toFixed(6));
  return s.includes(".") ? Math.min(3, s.split(".")[1].length) : 0;
}

// What the slider takes for a typed number: in its range, on its steps; null for not a number.
export function fromTyped(text, { min, max, step, scale }) {
  const v = Number(String(text).replace(",", ".").replace("−", "-").trim()) / scale;
  if (!String(text).trim() || !Number.isFinite(v)) return null;
  const s = Number.isFinite(step) && step > 0 ? step : 0;
  const snapped = s ? min + Math.round((v - min) / s) * s : v;
  return Math.min(max, Math.max(min, +snapped.toFixed(6)));
}

export function unitOf(text) {
  const m = PLAIN.exec(text || "");
  return m ? m[1] || "" : null;
}

const skip = (r) => "noValue" in r.dataset || r.classList.contains("preview-seek") || r.id === "song-player-seek";

// The read-out a slider already had beside it, if any (the next element, past spaces).
function readout(r) {
  let n = r.nextSibling;
  while (n && n.nodeType === 3 && !n.textContent.trim()) n = n.nextSibling;
  return n && n.nodeType === 1 && (n.tagName === "OUTPUT" || n.matches(".range-value, .eq-value, .hint"))
    && !n.matches("input, button, select") ? n : null;
}

function pair(r) {
  if (r._valueBox || skip(r) || !r.isConnected) return;
  const old = readout(r);
  const box = document.createElement("input");
  box.type = "text";
  box.inputMode = "decimal";
  box.className = "slider-value";
  box.autocomplete = "off";
  const unit = document.createElement("span");
  unit.className = "slider-unit";
  unit.setAttribute("aria-hidden", "true");
  const wrap = document.createElement("span");
  wrap.className = "slider-value-wrap";
  wrap.append(box, unit);
  r.after(wrap);  // a read-out with words ("None", "Muffled") stays beside it
  r._valueBox = box;
  let typing = false;
  const lim = () => {
    const min = Number(r.min || 0), max = Number(r.max || 100), step = r.step === "any" ? 0 : Number(r.step || 1);
    const scale = "scale" in r.dataset ? Number(r.dataset.scale) : scaleOf(min, max);
    return { min, max, step, scale };
  };
  const show = () => {
    const { step, scale } = lim();
    if (!typing) box.value = (Number(VALUE.get.call(r)) * scale).toFixed(decimals(step, scale));
    let u = "unit" in r.dataset ? r.dataset.unit : null;
    if (old) {
      const found = unitOf(old.textContent);
      old.hidden = found !== null || !old.textContent.trim();
      if (u === null && found) u = found;
    }
    if (u === null) u = lim().scale === 100 ? "%" : "";
    unit.textContent = u;
    const name = r.getAttribute("aria-label") || r.labels?.[0]?.textContent?.trim() || r.title || "Slider";
    box.setAttribute("aria-label", `${name}: exact value${u ? ` (${u})` : ""}`);
    box.disabled = r.disabled;
    wrap.hidden = r.hidden;
    box.title = "Type a number, or use the arrow keys (Shift for bigger steps)";
  };
  // Values set by code (redrawing, undo) show in the box too.
  Object.defineProperty(r, "value", {
    configurable: true,
    get() { return VALUE.get.call(this); },
    set(v) { VALUE.set.call(this, v); show(); },
  });
  const send = (type) => r.dispatchEvent(new Event(type, { bubbles: true }));
  const take = (text, type) => {
    const v = fromTyped(text, lim());
    if (v === null || v === Number(VALUE.get.call(r))) return;
    VALUE.set.call(r, String(v));
    send("input");
    if (type === "change") send("change");
  };
  box.addEventListener("focus", () => { typing = true; box.select(); });
  box.addEventListener("input", () => take(box.value, "input"));
  box.addEventListener("change", () => { take(box.value, "change"); send("change"); });
  box.addEventListener("blur", () => { typing = false; show(); });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); box.blur(); return; }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const { min, max, step, scale } = lim();
    const by = (step || (max - min) / 100) * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
    const v = Math.min(max, Math.max(min, +(Number(VALUE.get.call(r)) + by).toFixed(6)));
    VALUE.set.call(r, String(v));
    box.value = (v * scale).toFixed(decimals(step, scale));
    send("input");
    send("change");
  });
  r.addEventListener("input", show);
  r.addEventListener("change", show);
  new MutationObserver(show).observe(r, { attributes: true, attributeFilter: ["disabled", "hidden", "min", "max", "step", "value"] });
  if (old) new MutationObserver(show).observe(old, { childList: true, characterData: true, subtree: true });
  show();
}

export function watchSliders(root = document.body) {
  const all = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches('input[type="range"]')) pair(node);
    for (const r of node.querySelectorAll('input[type="range"]')) pair(r);
  };
  all(root);
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) all(n);
  }).observe(root, { childList: true, subtree: true });
}
