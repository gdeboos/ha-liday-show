// The Help drawer and the editors' ? bubbles (words in help.js). The drawer shows the page you're
// on, follows you as you change page, and searches every page's help.
import { HELP, guideUrl, helpPageFor, panelHelp, searchHelp, topicGuide } from "./help.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
// Help's words are ours (help.js), so they're set as HTML.
const html = (tag, props, markup) => { const e = el(tag, props); e.innerHTML = markup; return e; };

let currentView = () => null;
let page = null; // the help page shown
let opener = null; // what to give focus back to on closing
const openTopics = {}; // page -> topic ids opened this visit

const drawer = () => $("help-drawer");
export const helpOpen = () => !drawer().hidden;

function topicBox(p, topic, { open, focus, label } = {}) {
  const d = el("details", { className: `help-topic${focus ? " focus" : ""}`, open: !!open });
  d.dataset.topic = topic.id;
  const s = el("summary", {}, el("span", { textContent: topic.title }));
  if (label) s.append(el("span", { className: "help-topic-tag", textContent: label }));
  d.append(s);
  if (topic.tips) d.append(el("ul", {}, ...topic.tips.map((t) => html("li", {}, t))));
  if (topic.keys) {
    d.append(el("div", { className: "help-keys" }, ...topic.keys.flatMap(([keys, what]) => [html("span", {}, keys), el("span", { textContent: what })])));
  }
  d.append(el("a", { className: "help-more", href: topicGuide(p, topic), target: "_blank", rel: "noopener", textContent: "More in the guide ↗" }));
  d.addEventListener("toggle", () => {
    const set = (openTopics[p] ??= new Set());
    if (d.open) set.add(topic.id); else set.delete(topic.id);
  });
  return d;
}

function render(focusId = null) {
  const view = currentView();
  page = helpPageFor(view);
  const body = $("help-body"), q = $("help-search").value.trim();
  if (q) {
    const found = searchHelp(q, page);
    $("help-crumb").textContent = "Help · search";
    $("help-title").textContent = found.length ? `${found.length} found` : "Nothing found";
    body.replaceChildren(...(found.length
      ? found.map(({ page: p, topic }) => topicBox(p, topic, { open: true, label: p === page ? "" : HELP[p].title }))
      : [el("p", { className: "hint", textContent: "Try fewer or other words, or look in the full guide." })]));
    $("help-guide").href = guideUrl(["README.md"]);
    $("help-guide").textContent = "The full guide ↗";
    return;
  }
  if (!page) {
    $("help-crumb").textContent = "Help";
    $("help-title").textContent = "HA-liday Show";
    body.replaceChildren(el("p", { className: "hint", textContent: "Search above, or read the full guide." }));
    $("help-guide").href = guideUrl(["README.md"]);
    return;
  }
  const p = HELP[page];
  $("help-crumb").textContent = "Help";
  $("help-title").textContent = p.title;
  const opened = (openTopics[page] ??= new Set(focusId ? [focusId] : [p.topics[0].id]));
  if (focusId) opened.add(focusId);
  body.replaceChildren(...p.topics.map((t) => topicBox(page, t, { open: opened.has(t.id), focus: t.id === focusId })));
  $("help-guide").href = guideUrl(p.guide);
  $("help-guide").textContent = `The full guide: ${p.title} ↗`;
  if (focusId) body.querySelector(`[data-topic="${focusId}"]`)?.scrollIntoView({ block: "nearest" });
}

export function openHelp(focusId = null, from = document.activeElement) {
  closePop();
  if (focusId) $("help-search").value = "";
  opener = from;
  drawer().hidden = false;
  document.body.classList.add("help-on");
  $("btn-help").setAttribute("aria-expanded", "true");
  render(focusId);
  (focusId ? drawer().querySelector(".help-topic.focus summary") : $("help-search"))?.focus({ preventScroll: true });
}

export function closeHelp() {
  if (!helpOpen()) return;
  drawer().hidden = true;
  document.body.classList.remove("help-on");
  $("btn-help").setAttribute("aria-expanded", "false");
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  opener = null;
}

// The page changed: the open drawer follows it.
export function helpPageChanged() {
  closePop();
  if (helpOpen() && !$("help-search").value.trim()) render();
}

// The quick bubble under a panel's ?, with a way on to the drawer.
let popFor = null;
function openPop(btn, p, panel) {
  const h = panelHelp(p, panel);
  if (!h) return;
  if (popFor === btn) { closePop(); return; }
  closePop();
  const pop = $("help-pop");
  $("help-pop-title").textContent = h.topic.title;
  $("help-pop-tips").replaceChildren(...h.tips.map((t) => html("li", {}, t)));
  $("help-pop-count").textContent = h.total > h.tips.length ? `${h.tips.length} of ${h.total} tips` : "";
  $("help-pop-more").onclick = () => openHelp(h.topic.id, btn);
  pop.hidden = false;
  popFor = btn;
  btn.classList.add("on");
  btn.setAttribute("aria-expanded", "true");
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.top = `${r.bottom + window.scrollY + 8}px`;
  pop.style.left = `${Math.max(8, Math.min(r.right - w + 14, window.innerWidth - w - 8)) + window.scrollX}px`;
  pop.style.setProperty("--arrow", `${Math.max(12, Math.min(w - 20, r.left + r.width / 2 - (parseFloat(pop.style.left) - window.scrollX) - 6))}px`);
  $("help-pop-close").focus({ preventScroll: true });
}

function closePop(refocus = false) {
  const pop = $("help-pop");
  if (pop.hidden) return;
  pop.hidden = true;
  popFor?.classList.remove("on");
  popFor?.setAttribute("aria-expanded", "false");
  if (refocus) popFor?.focus({ preventScroll: true });
  popFor = null;
}

// A ? before the ⋯ on each editor panel. `views` maps an editor's view id to its help page.
function addPanelButtons(views) {
  for (const [viewId, p] of Object.entries(views)) {
    for (const panel of document.querySelectorAll(`#${viewId} .panel[data-panel]`)) {
      const h = panelHelp(p, panel.dataset.panel);
      const head = panel.querySelector(".panel-head");
      if (!h || !head) continue;
      const name = head.querySelector(".section-label")?.textContent || "this";
      const b = el("button", { type: "button", className: "help-q-btn ghost", textContent: "?", title: `Tips for ${name}` });
      b.setAttribute("aria-label", `Tips for the ${name} panel`);
      b.setAttribute("aria-expanded", "false");
      b.setAttribute("aria-controls", "help-pop");
      b.addEventListener("click", (e) => { e.stopPropagation(); openPop(b, p, panel.dataset.panel); });
      head.insertBefore(b, head.querySelector(".panel-move"));
    }
  }
}

export function initHelp(getView) {
  currentView = getView;
  $("btn-help").addEventListener("click", () => (helpOpen() ? closeHelp() : openHelp()));
  $("help-close").addEventListener("click", closeHelp);
  $("help-pop-close").addEventListener("click", () => closePop(true));
  $("help-search").addEventListener("input", () => render());
  $("help-pop").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("#help-pop")) closePop();
    // Anything marked data-help="page:topic" opens that topic.
    const link = e.target.closest?.("[data-help]");
    if (link) { e.preventDefault(); openHelp(link.dataset.help.split(":")[1] || null, link); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("help-pop").hidden) { closePop(true); e.stopPropagation(); return; }
    if (helpOpen() && drawer().contains(document.activeElement)) {
      if (e.target === $("help-search") && $("help-search").value) { $("help-search").value = ""; render(); }
      else closeHelp();
      e.stopPropagation();
    }
  }, true);
  window.addEventListener("resize", () => closePop());
  // Keys typed in help (Space on a topic, say) are for help, not the editor behind it.
  for (const box of [drawer(), $("help-pop")]) box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") return; // still saves
    e.stopPropagation();
  });
  addPanelButtons({ "view-editor": "editor", "view-music": "music", "view-playlist": "playlist" });
}
