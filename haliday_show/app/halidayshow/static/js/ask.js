// HA-liday Show's own small windows for a yes/no question or a name, in place of the browser's
// confirm() and prompt(), which look out of place (and show the web address in Home Assistant).

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
}

function windowWith(title, body, buttons) {
  const dlg = el("dialog", { className: "effect-dialog form-dialog ask-dialog" });
  const head = el("div", { className: "effect-dialog-head" }, el("h3", { textContent: title }));
  const foot = el("div", { className: "form-dialog-foot" }, el("span", { className: "spacer" }), ...buttons);
  const form = el("form", { method: "dialog" }, head, el("div", { className: "form-dialog-body" }, ...body), foot);
  dlg.append(form);
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  return { dlg, form };
}

// A question with two answers. Resolves true for yes; Esc, Cancel or the backdrop is no.
// { yes: the button's words ("Delete"), danger: a red button for something that can't be undone }
export function askYes(text, { title = "Are you sure?", yes = "OK", no = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    const ok = el("button", { type: "submit", className: danger ? "danger-fill" : "primary", textContent: yes });
    const cancel = el("button", { type: "button", textContent: no });
    const { dlg, form } = windowWith(title, [el("p", { className: "ask-text", textContent: text })], [cancel, ok]);
    let answer = false;
    cancel.addEventListener("click", () => dlg.close());
    form.addEventListener("submit", (e) => { e.preventDefault(); answer = true; dlg.close(); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => resolve(answer));
    dlg.showModal();
    ok.focus();
  });
}

// A name or other short text. Resolves the tidied text, or null if cancelled. `check(text)` returns
// what's wrong with it ("" or null when it's fine), shown under the box rather than in a pop-up.
export function askText(title, { label = "Name", value = "", yes = "OK", check = null, hint = "", max = 80 } = {}) {
  return new Promise((resolve) => {
    const input = el("input", { type: "text", value, maxLength: max, autocomplete: "off", spellcheck: false });
    const note = el("span", { className: "hint", textContent: hint });
    note.setAttribute("aria-live", "polite");
    const ok = el("button", { type: "submit", className: "primary", textContent: yes });
    const cancel = el("button", { type: "button", textContent: "Cancel" });
    const field = el("label", { className: "field" }, label, input, note);
    const { dlg, form } = windowWith(title, [field], [cancel, ok]);
    let answer = null;
    const problem = () => {
      const v = input.value.trim().replace(/\s+/g, " ");
      if (!v) return "Type something first";
      return check?.(v) || "";
    };
    input.addEventListener("input", () => { note.textContent = hint; note.classList.remove("warn"); });
    cancel.addEventListener("click", () => dlg.close());
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const p = problem();
      if (p) { note.textContent = p; note.classList.add("warn"); input.focus(); return; }
      answer = input.value.trim().replace(/\s+/g, " ");
      dlg.close();
    });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => resolve(answer));
    dlg.showModal();
    input.focus();
    input.select();
  });
}
