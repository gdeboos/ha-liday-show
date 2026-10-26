// The message spot in the top bar. A save lights it up green for a moment, then it settles to a
// quiet "✓ Saved · 08:14", so you can always see when something last saved. An error shows in red
// and stays until you press it, and nothing else covers it meanwhile. Other messages show plainly
// for a few seconds.

export const LIT_MS = 3000;
export const INFO_MS = 4000;

export const clock = (date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export class StatusLine {
  // el: the element to fill. now() and later(fn, ms) can be swapped out for tests.
  constructor(el, { now = () => new Date(), later = (fn, ms) => setTimeout(fn, ms) } = {}) {
    Object.assign(this, { el, now, later });
    this.error = null; // the error showing, until it's dismissed
    this.lastSaved = null;
    this.serial = 0;
    el.setAttribute("aria-live", "polite");
    el.addEventListener?.("click", () => this.dismiss());
    el.addEventListener?.("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.dismiss(); } });
  }

  // kind: "info", "saved" or "error". An empty info message clears whatever info is showing.
  show(msg, kind = "info") {
    if (kind === "error") {
      this.error = msg;
      this.render("error", msg);
      return;
    }
    if (kind === "saved") this.lastSaved = this.now();
    if (this.error) return; // the error stays on top until it's dismissed
    if (!msg) { this.settle(); return; }
    this.render(kind, msg);
    const mine = ++this.serial;
    this.later(() => { if (this.serial === mine && !this.error) this.settle(); }, kind === "saved" ? LIT_MS : INFO_MS);
  }

  dismiss() {
    if (!this.error) return;
    this.error = null;
    this.settle();
  }

  settle() {
    this.serial++;
    if (this.lastSaved) this.render("settled", `Saved · ${clock(this.lastSaved)}`);
    else this.render("", "");
  }

  get text() { return this.el.textContent; }

  render(kind, msg) {
    const el = this.el;
    el.className = `status${kind ? ` ${kind}` : ""}`;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.tabIndex = kind === "error" ? 0 : -1;
    el.title = kind === "error" ? "Press to dismiss" : kind === "settled" ? `Last saved at ${clock(this.lastSaved)}` : "";
    const mark = { saved: "✓", settled: "✓", error: "⚠" }[kind];
    const parts = [];
    if (mark) parts.push(span("mark", mark));
    if (msg) parts.push(span("msg", msg));
    if (kind === "saved") parts.push(span("when", "just now"));
    el.replaceChildren?.(...parts);
    if (!el.replaceChildren) el.textContent = parts.map((p) => p.textContent).join(" ");
  }
}

function span(cls, text) {
  if (typeof document === "undefined") return { textContent: text };
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}
