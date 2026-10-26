// The message spot in the top bar. A save lights it up green for a moment, then it settles to a
// quiet "✓ Saved · 08:14", so you can always see when something last saved. A failure shows in red
// and stays until you press it, or until the same thing works again (each failure can name a
// `topic`, such as "palettes", and a later save or clear of that topic takes it away). Hints (a
// nudge such as "Choose a song first") and other messages show for a few seconds.
//
// Screen readers get two regions that stay put: a polite one for everything else and an alert for
// failures, which is a real button so it says it can be pressed.

export const LIT_MS = 3000;
export const INFO_MS = 4000;
export const HINT_MS = 6000;

export const clock = (date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export class StatusLine {
  // el: the element to fill. now(), later(fn, ms) and doc can be swapped out for tests.
  constructor(el, { now = () => new Date(), later = (fn, ms) => setTimeout(fn, ms), doc = globalThis.document } = {}) {
    Object.assign(this, { el, now, later, doc });
    this.error = null; // {msg, topic} while a failure shows
    this.lastSaved = null;
    this.serial = 0;
    this.live = doc.createElement("span");
    this.live.className = "live";
    this.live.setAttribute("role", "status");
    this.live.setAttribute("aria-live", "polite");
    this.alert = doc.createElement("span");
    this.alert.className = "alert";
    this.alert.setAttribute("role", "alert");
    el.replaceChildren(this.live, this.alert);
  }

  // kind: "info", "hint", "saved" or "error". An empty message clears what's showing: with a topic,
  // a failure about that topic too.
  show(msg, kind = "info", topic = null) {
    if (kind === "error") {
      this.serial++;
      this.error = { msg, topic };
      this.render("error", msg);
      return;
    }
    if (kind === "saved") this.lastSaved = this.now();
    // It worked this time, so the failure about it is over.
    if (this.error && topic && this.error.topic === topic && (kind === "saved" || !msg)) this.error = null;
    if (this.error) return; // a failure stays on top until it's dismissed
    if (!msg) { this.settle(); return; }
    this.render(kind, msg);
    const mine = ++this.serial;
    const ms = kind === "saved" ? LIT_MS : kind === "hint" ? HINT_MS : INFO_MS;
    this.later(() => { if (this.serial === mine && !this.error) this.settle(); }, ms);
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
    this.el.className = `status${kind ? ` ${kind}` : ""}`;
    const mark = { saved: "✓", settled: "✓", hint: "⚠", error: "⚠" }[kind];
    if (kind === "error") {
      const b = this.doc.createElement("button");
      b.type = "button";
      b.className = "status-dismiss";
      b.title = "Press to dismiss";
      b.setAttribute("aria-label", `${msg.replace(/[.\s]+$/, "")}. Press to dismiss.`);
      b.append(this.part("mark", mark), this.part("msg", msg));
      b.addEventListener("click", () => this.dismiss());
      this.live.replaceChildren();
      this.alert.replaceChildren(b);
      return;
    }
    const parts = [];
    if (mark) parts.push(this.part("mark", mark));
    if (msg) parts.push(this.part("msg", msg));
    if (kind === "saved") parts.push(this.part("when", "just now"));
    this.alert.replaceChildren();
    this.live.replaceChildren(...parts);
    this.live.title = kind === "settled" ? `Last saved at ${clock(this.lastSaved)}` : "";
  }

  part(cls, text) {
    const s = this.doc.createElement("span");
    s.className = cls;
    if (cls === "mark") s.setAttribute("aria-hidden", "true");
    s.textContent = text;
    return s;
  }
}
