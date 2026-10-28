import { bestOn } from "./colours.js";

// The public page: people passing by pick a show and queue it up. It only talks to the three calls
// on the public port (api/state, api/request, api/cancel), never to the editor.

const ordinal = (n) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
};

// The words come with each answer from HA-liday Show (yours where you've changed them, on the Public
// page tab). Until the first answer arrives, only "can't reach the lights" might be needed.
const BEFORE_FIRST_ANSWER = { offline: "Can't reach the lights right now. Trying again…" };

// A word with its {name}-style parts filled in.
export function fill(text, vars = {}) {
  return String(text ?? "").replace(/\{(\w+)\}/g, (all, k) => (k in vars ? String(vars[k]) : all));
}

const say_ = (w, key, vars) => fill(w?.[key] ?? BEFORE_FIRST_ANSWER[key] ?? "", vars);

const minutes = (s) => {
  const m = Math.max(1, Math.round(s / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

// "2026-12-01" as "1 December".
export const dayText = (iso) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "17:00" as "5pm", "16:32" as "4:32pm".
export function clockText(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

// When the page opens again, from HA-liday Show's clock ("YYYY-MM-DDTHH:MM", no time zone).
export function comeBackText(hours, w) {
  if (!hours || hours.open) return "";
  if (!hours.next) return say_(w, "not_open");
  const day = (iso) => Date.UTC(...iso.slice(0, 10).split("-").map((v, i) => Number(v) - (i === 1 ? 1 : 0))) / 86400000;
  const ahead = day(hours.next) - day(hours.now);
  const at = clockText(hours.next.slice(11, 16));
  const d = new Date(`${hours.next.slice(0, 10)}T00:00Z`);
  const when = ahead === 0 ? `at ${at}` : ahead === 1 ? `tomorrow at ${at}`
    : ahead < 7 ? `on ${DAY_NAMES[d.getUTCDay()]} at ${at}` : `on ${dayText(hours.next.slice(0, 10))} at ${at}`;
  return say_(w, "come_back", { when });
}

// What to tell a visitor about one of their requests.
export function waitText(r, w) {
  if (r.playing) return say_(w, "playing");
  if (r.place === 1 && r.wait < 20) return say_(w, "starting");
  if (r.place === 1) return say_(w, "next", { minutes: minutes(r.wait) });
  return say_(w, "queued", { place: ordinal(r.place), minutes: minutes(r.wait) });
}

// Everything the page shows, worked out from api/state.
export function describe(st) {
  const w = st.words;
  const soon = (st.soon || []).map((c) => ({ ...c, detail: say_(w, c.kind === "playlist" ? "soon_from_playlist" : "soon_from", { day: dayText(c.starts) }) }));
  if (!st.open) {
    return { closed: true, now: "", mine: [], choices: [], soon: [], coming: "", block: "" };
  }
  // Nothing to pick yet: say when the first one starts.
  const coming = !st.choices.length && soon.length ? say_(w, "soon_page", { day: dayText(soon[0].starts) }) : "";
  const waiting = st.mine.filter((r) => !r.playing).length;
  let block = "";
  if (waiting >= st.per_phone) {
    block = st.per_phone === 1 ? say_(w, "one_waiting") : say_(w, "many_waiting", { count: waiting });
  } else if (st.full) {
    block = say_(w, "full");
  }
  let now = say_(w, "idle");
  if (st.now) {
    const name = st.now.name || "…";
    now = !st.mine.some((r) => r.playing) && st.waiting
      ? say_(w, "on_now_waiting", { name, count: st.waiting }) : say_(w, "on_now", { name });
  }
  const showLength = st.look?.show_length !== false;
  return {
    closed: false,
    now,
    mine: st.mine.map((r) => ({ id: r.id, name: r.name, text: waitText(r, w), cancel: !r.playing })),
    choices: st.choices.map((c) => ({
      ...c,
      detail: !showLength ? "" : say_(w, c.kind === "playlist" ? "length_playlist" : "length",
        { minutes: minutes(c.minutes * 60) }),
    })),
    block,
    soon,
    coming,
  };
}

// The words for the footer link: yours, or else the site's name.
export function linkText(look) {
  if (!look?.link) return "";
  if (look.link_text) return look.link_text;
  try { return new URL(look.link).hostname.replace(/^www\./, ""); } catch { return look.link; }
}

// Gentle falling snow behind the page. Never moves for people whose phone asks for less motion.
function makeSnow(canvas) {
  const ctx = canvas.getContext("2d");
  let flakes = [], frame = null, on = false;
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const size = () => {
    const r = devicePixelRatio || 1;
    canvas.width = innerWidth * r;
    canvas.height = innerHeight * r;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    const n = Math.min(70, Math.round(innerWidth / 10));
    flakes = Array.from({ length: n }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: 1 + Math.random() * 2.5, v: 0.3 + Math.random() * 0.8, d: Math.random() * Math.PI * 2,
    }));
  };
  let colour = "";
  const draw = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = colour;
    for (const f of flakes) {
      f.y += f.v;
      f.d += 0.01;
      f.x += Math.sin(f.d) * 0.4;
      if (f.y > innerHeight + 5) { f.y = -5; f.x = Math.random() * innerWidth; }
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    frame = requestAnimationFrame(draw);
  };
  const run = () => {
    cancelAnimationFrame(frame);
    frame = null;
    const go = on && !still() && !document.hidden;
    canvas.hidden = !go;
    if (go) {
      if (!flakes.length) size();
      colour = getComputedStyle(document.documentElement).colorScheme === "dark"
        ? "rgba(255,255,255,.75)" : "rgba(150,170,195,.55)";
      draw();
    }
  };
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", run);
  addEventListener("resize", () => { if (on) size(); });
  document.addEventListener("visibilitychange", run);
  return (want) => { on = want; run(); }; // run again too when the colours change
}

const TICKET_KEY = "halidayshow.publicTicket";
const CODE_KEY = "halidayshow.publicCode";

// The code from the QR code's link (?c=…), kept so the page still works when opened again later.
export function codeFrom(search, kept) {
  const c = new URLSearchParams(search).get("c");
  return c && /^[A-Za-z0-9]{6,16}$/.test(c) ? c : kept || "";
}

function code() {
  let kept = null;
  try { kept = localStorage.getItem(CODE_KEY); } catch { /* private browsing */ }
  const c = codeFrom(location.search, kept);
  if (c && c !== kept) try { localStorage.setItem(CODE_KEY, c); } catch { /* kept for this visit only */ }
  return c;
}

// Where the phone stands, from the browser's answer: "denied", "slow" or "unknown".
export function locationProblem(err) {
  return err?.code === 1 ? "denied" : err?.code === 3 ? "slow" : "unknown";
}

// What to say about where the phone is, and whether to offer Try again. "far" and "closed" carry the
// server's own words.
export function whereText(where, w) {
  switch (where.state) {
    case "checking":
      return { text: say_(w, "checking"), retry: false };
    case "far":
    case "closed":
      return { text: where.text, retry: where.state === "far" };
    case "denied":
    case "slow":
    case "unknown":
      return { text: say_(w, where.state), retry: true };
    default:
      return { text: "", retry: false };
  }
}

// The flashing lights warning: shown at the top for "note" and "accept"; with "accept", Start only
// appears once the visitor has pressed the button under it.
export const warningShown = (look) => look?.warning === "note" || look?.warning === "accept";
export const mustAccept = (look, accepted) => look?.warning === "accept" && !accepted;

const ACCEPTED_KEY = "halidayshow.publicAccepted";

// Start buttons only show to phones that could use them.
export const canStart = (needsLocation, where) => !needsLocation || where.state === "near";

function ticket() {
  let t = null;
  try { t = localStorage.getItem(TICKET_KEY); } catch { /* private browsing */ }
  if (!t || !/^[A-Za-z0-9_-]{16,64}$/.test(t)) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    t = Array.from(bytes, (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b % 64]).join("");
    try { localStorage.setItem(TICKET_KEY, t); } catch { /* kept for this visit only */ }
  }
  return t;
}

export function start() {
  const $ = (id) => document.getElementById(id);
  // Shown inside the editor's Public page tab: looks the same, but starts nothing.
  const preview = /\/public-preview\/$/.test(location.pathname);
  const me = ticket();
  const key = preview ? "" : code();
  let busy = false;
  let needsLocation = false;
  let w = null; // the words from the latest answer
  let accepted = false;
  try { accepted = sessionStorage.getItem(ACCEPTED_KEY) === "1"; } catch { /* private browsing */ }
  const snow = makeSnow($("pp-snow"));
  let pictureShown = 0;

  function applyLook(look) {
    if (!look) return;
    const root = document.documentElement;
    root.dataset.theme = look.theme || "plain";
    root.dataset.mode = look.mode || "auto";
    root.dataset.spacing = look.spacing || "normal";
    root.dataset.corners = look.corners || "soft";
    root.dataset.size = look.size || "normal";
    root.dataset.borders = look.borders === false ? "off" : "on";
    // Your own colours go straight onto the page; hints and borders are mixed from them in the CSS.
    for (const key of ["bg", "panel", "text", "head", "accent", "accent-text"]) root.style.removeProperty(`--${key}`);
    if (look.theme === "custom" && look.colours) {
      for (const [key, value] of Object.entries(look.colours)) root.style.setProperty(`--${key}`, value);
      root.style.setProperty("--accent-text", bestOn(look.colours.accent));
      // A dark or light background picks the matching warning colours (and snow).
      root.dataset.mode = bestOn(look.colours.bg) === "#ffffff" ? "dark" : "light";
      root.style.colorScheme = root.dataset.mode;
    } else root.style.removeProperty("color-scheme");
    if (!("title" in look)) return; // locked: colours only
    const title = look.title || "🎄 Light show";
    $("pp-title").textContent = title;
    document.title = look.title || "Light show";
    $("pp-welcome").textContent = look.welcome || "";
    $("pp-welcome").hidden = !look.welcome;
    if (look.picture && look.picture !== pictureShown) {
      $("pp-picture").src = `picture?code=${encodeURIComponent(key)}&v=${look.picture}`;
    }
    pictureShown = look.picture || 0;
    $("pp-picture").hidden = !look.picture;
    $("pp-link").textContent = linkText(look);
    if (look.link) $("pp-link").href = look.link;
    $("pp-footer").hidden = !look.link;
    snow(!!look.snow);
  }
  let last = null; // the latest state from the server
  // Where the phone is: {state: "idle" | "checking" | "near" | "far" | "closed" | "denied" | "slow" |
  // "unknown", text, pos}. Watched while the page is open, so walking up to the lights brings the
  // Start buttons.
  const where = { state: "idle", text: "", pos: null };
  let watchId = null;
  let asked = 0;
  let asking = false;

  function setWhere(state, text = "") {
    where.state = state;
    where.text = text;
    const words = whereText(where, w);
    $("pp-where-text").textContent = words.text;
    $("pp-retry").hidden = !words.retry;
    $("pp-where").hidden = !words.text;
    if (last) render(last);
  }

  let later = null;
  async function checkNear(force = false) {
    if (!where.pos) return;
    const wait = 10000 - (Date.now() - asked);
    if (asking || (!force && wait > 0)) {
      // A newer position waits its turn rather than being dropped, so walking up still counts.
      clearTimeout(later);
      later = setTimeout(() => checkNear(), Math.max(wait, 500));
      return;
    }
    asking = true;
    asked = Date.now();
    let again = false;
    try {
      const res = await fetch("api/near", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...where.pos, code: key }),
      });
      if (!res.ok) throw new Error(String(res.status)); // busy, or a blip: ask again shortly
      const ans = await res.json();
      if (!where.pos) return; // location was turned off meanwhile
      if (ans.near) setWhere("near");
      else setWhere(ans.why === "far" ? "far" : "closed", ans.text);
    } catch {
      again = true;
    } finally {
      asking = false;
    }
    // A phone standing still may not report a new position, so a failed check tries again by itself.
    if (again) {
      clearTimeout(later);
      later = setTimeout(() => checkNear(true), 10000);
    }
  }

  function stopWatching() {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearTimeout(later);
  }

  function watchWhere() {
    if (!navigator.geolocation) { setWhere("unknown"); return; }
    stopWatching();
    if (where.state !== "near") setWhere("checking");
    watchId = navigator.geolocation.watchPosition((pos) => {
      const first = !where.pos;
      where.pos = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
      checkNear(first || where.state === "checking");
    }, (err) => {
      if (where.pos && err.code !== 1) return; // a hiccup after a fix: keep the last one
      stopWatching();
      where.pos = null;
      setWhere(locationProblem(err));
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  }

  // A problem, or with info = true, a plain progress note.
  const say = (text, info = false) => {
    $("pp-message").textContent = text;
    $("pp-message").hidden = !text;
    $("pp-message").classList.toggle("pp-info", info);
  };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function render(st) {
    w = st.words || w;
    applyLook(st.look);
    $("pp-locked-text").textContent = say_(w, "locked");
    $("pp-locked-hint").textContent = say_(w, "locked_hint");
    $("pp-locked").hidden = !st.locked;
    if (st.locked) {
      $("pp-closed").hidden = $("pp-open").hidden = $("pp-warning").hidden = true;
      return;
    }
    last = st;
    for (const [id, key] of [["pp-closed-text", "closed"], ["pp-closed-hint", "closed_hint"], ["pp-retry", "try_again"],
      ["pp-soon-head", "soon_head"], ["pp-none", "no_shows"], ["pp-warning-text", "warning"], ["pp-accept", "accept"]]) {
      $(id).textContent = say_(w, key);
    }
    $("pp-where-text").textContent = whereText(where, w).text;
    // The flashing lights warning, and (if you ask for it) a press to accept it before Start.
    $("pp-warning").hidden = !st.open || !warningShown(st.look);
    $("pp-accept").hidden = !mustAccept(st.look, accepted);
    const closed = comeBackText(st.hours, w);
    $("pp-hours").textContent = closed;
    $("pp-hours").hidden = !closed;
    needsLocation = !!st.needs_location;
    // Outside opening hours nobody's asked for their location: there's nothing to start yet.
    if (needsLocation && where.state === "idle" && st.open && !closed && !document.hidden) watchWhere();
    if (!needsLocation && where.state !== "idle") { // e.g. Nearby only turned off: start afresh if it comes back
      stopWatching();
      Object.assign(where, { state: "idle", text: "", pos: null });
    }
    if (!needsLocation) $("pp-where").hidden = true;
    const startable = !closed && canStart(needsLocation, where) && !mustAccept(st.look, accepted);
    const view = describe(st);
    $("pp-closed").hidden = !view.closed;
    $("pp-open").hidden = view.closed;
    if (view.closed) return;
    $("pp-now").textContent = view.now;
    const mine = $("pp-mine");
    mine.replaceChildren(...view.mine.map((r) => {
      const row = el("div", "pp-row pp-yours");
      const text = el("div", "pp-text");
      text.append(el("div", "pp-name", r.name), el("div", "pp-hint", r.text));
      row.append(text);
      if (r.cancel) {
        const b = el("button", "", say_(w, "cancel"));
        b.type = "button";
        b.addEventListener("click", () => send("api/cancel", { id: r.id }));
        row.append(b);
      }
      return row;
    }));
    mine.hidden = !view.mine.length;
    $("pp-block").textContent = view.block;
    $("pp-block").hidden = !view.block;
    $("pp-coming").textContent = view.coming;
    $("pp-coming").hidden = !view.coming;
    $("pp-now").hidden = (!!view.coming || !!closed) && !st.now;
    $("pp-pick").hidden = !view.choices.length;
    $("pp-none").hidden = view.choices.length > 0 || view.soon.length > 0;
    $("pp-soon-head").hidden = !view.soon.length;
    $("pp-soon").replaceChildren(...view.soon.map((c) => {
      const row = el("div", "pp-row pp-later");
      const text = el("div", "pp-text");
      text.append(el("div", "pp-name", c.name), el("div", "pp-hint", c.detail));
      row.append(text);
      return row;
    }));
    $("pp-pick-hint").textContent = say_(w, "pick_hint");
    $("pp-pick-hint").hidden = !startable;
    $("pp-pick-head").textContent = say_(w, startable ? "pick_head" : "shows_head");
    $("pp-block").hidden = !view.block || !startable;
    $("pp-choices").replaceChildren(...view.choices.map((c) => {
      const row = el("div", "pp-row");
      const text = el("div", "pp-text");
      text.append(el("div", "pp-name", c.name));
      if (c.detail) text.append(el("div", "pp-hint", c.detail));
      row.append(text);
      if (startable) {
        const b = el("button", "primary", say_(w, "start"));
        b.type = "button";
        b.disabled = !!view.block || busy;
        b.setAttribute("aria-label", `Start ${c.name}`);
        b.addEventListener("click", () => send("api/request", { kind: c.kind, id: c.id }));
        row.append(b);
      }
      return row;
    }));
  }

  async function refresh() {
    try {
      const res = await fetch(`api/state?ticket=${encodeURIComponent(me)}&code=${encodeURIComponent(key)}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      render(await res.json());
      if ($("pp-message").dataset.kind === "offline") say("");
    } catch {
      say(say_(w, "offline"));
      $("pp-message").dataset.kind = "offline";
    }
  }

  async function send(path, body) {
    if (preview) {
      say("This is a preview. On visitors' phones, this starts the show.", true);
      return;
    }
    if (busy) return;
    busy = true;
    say("");
    $("pp-message").dataset.kind = "";
    try {
      const res = await fetch(path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, ...(needsLocation ? where.pos : {}), ticket: me, code: key }),
      });
      if (res.ok) {
        render(await res.json());
      } else {
        say((await res.text()) || "That didn't work. Try again in a moment.");
        await refresh();
      }
    } catch {
      say("Can't reach the lights right now. Try again in a moment.");
    } finally {
      busy = false;
      refresh();
    }
  }

  $("pp-retry").addEventListener("click", watchWhere);
  $("pp-accept").addEventListener("click", () => {
    accepted = true;
    try { sessionStorage.setItem(ACCEPTED_KEY, "1"); } catch { /* kept for this visit */ }
    if (last) render(last);
  });
  // The editor asks the preview to catch up as soon as something's saved.
  if (preview) addEventListener("message", (e) => { if (e.origin === location.origin && e.data === "refresh") refresh(); });
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 3000);
  // Location is only watched while the page is on screen, to spare the battery.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopWatching();
    else {
      if (needsLocation && ["near", "far", "checking"].includes(where.state)) watchWhere();
      refresh();
    }
  });
}

if (typeof document !== "undefined") start();
