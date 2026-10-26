// The public page: people passing by pick a show and queue it up. It only talks to the three calls
// on the public port (api/state, api/request, api/cancel), never to the editor.

const ordinal = (n) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
};

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

// What to tell a visitor about one of their requests.
export function waitText(r) {
  if (r.playing) return "Playing now. Enjoy the show!";
  if (r.place === 1 && r.wait < 20) return "Starting in a moment…";
  if (r.place === 1) return `You're next, starting in about ${minutes(r.wait)}.`;
  return `You're ${ordinal(r.place)} in the queue, starting in about ${minutes(r.wait)}.`;
}

// Everything the page shows, worked out from api/state.
export function describe(st) {
  const soon = (st.soon || []).map((c) => ({ ...c, detail: `${c.kind === "playlist" ? "Playlist · from" : "From"} ${dayText(c.starts)}` }));
  if (!st.open) {
    return { closed: true, now: "", mine: [], choices: [], soon: [], coming: "", block: "" };
  }
  // Nothing to pick yet: say when the first one starts.
  const coming = !st.choices.length && soon.length ? `Coming soon on ${dayText(soon[0].starts)}` : "";
  const waiting = st.mine.filter((r) => !r.playing).length;
  let block = "";
  if (waiting >= st.per_phone) {
    block = st.per_phone === 1 ? "You can pick another show once yours starts."
      : `You've got ${waiting} shows waiting, the most for one phone.`;
  } else if (st.full) {
    block = "The queue is full. Try again in a few minutes.";
  }
  let now = "Nothing's on right now. Pick a show to start it.";
  if (st.now) now = `On now: ${st.now.name || "a show"}`;
  if (st.now && !st.mine.some((r) => r.playing) && st.waiting) {
    now += ` · ${st.waiting} waiting`;
  }
  return {
    closed: false,
    now,
    mine: st.mine.map((r) => ({ id: r.id, name: r.name, text: waitText(r), cancel: !r.playing })),
    choices: st.choices.map((c) => ({
      ...c, detail: c.kind === "playlist" ? `Playlist · about ${minutes(c.minutes * 60)}` : `About ${minutes(c.minutes * 60)}`,
    })),
    block,
    soon,
    coming,
  };
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
export function whereText(where) {
  switch (where.state) {
    case "checking":
      return { text: "Checking you're by the lights… Your phone may ask to share your location. It's only used for this and isn't kept.", retry: false };
    case "far":
    case "closed":
      return { text: where.text, retry: where.state === "far" };
    case "denied":
      return { text: "To start a show, let this page use your location: it's only used to check you're by the lights. Allow it in your browser's settings, then press Try again.", retry: true };
    case "slow":
      return { text: "Your phone took too long to find where you are.", retry: true };
    case "unknown":
      return { text: "Your phone couldn't tell where you are.", retry: true };
    default:
      return { text: "", retry: false };
  }
}

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
  const me = ticket();
  const key = code();
  let busy = false;
  let needsLocation = false;
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
    const words = whereText(where);
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
    try {
      const res = await fetch("api/near", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...where.pos, code: key }),
      });
      if (res.ok) setWhere("near");
      else {
        const text = await res.text();
        setWhere(/too far/.test(text) ? "far" : "closed", text);
      }
    } catch { /* offline for a moment: the next position tries again */ } finally {
      asking = false;
    }
  }

  function watchWhere() {
    if (!navigator.geolocation) { setWhere("unknown"); return; }
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setWhere("checking");
    watchId = navigator.geolocation.watchPosition((pos) => {
      const first = !where.pos;
      where.pos = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
      checkNear(first || where.state === "checking");
    }, (err) => {
      if (where.pos && err.code !== 1) return; // a hiccup after a fix: keep the last one
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
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
    $("pp-locked").hidden = !st.locked;
    if (st.locked) {
      $("pp-closed").hidden = $("pp-open").hidden = true;
      return;
    }
    last = st;
    needsLocation = !!st.needs_location;
    if (needsLocation && where.state === "idle" && st.open) watchWhere();
    if (!needsLocation) $("pp-where").hidden = true;
    const startable = canStart(needsLocation, where);
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
        const b = el("button", "", "Cancel");
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
    $("pp-now").hidden = !!view.coming && !st.now;
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
    $("pp-pick-hint").hidden = !startable;
    $("pp-pick-head").textContent = startable ? "Pick a show" : "Shows";
    $("pp-block").hidden = !view.block || !startable;
    $("pp-choices").replaceChildren(...view.choices.map((c) => {
      const row = el("div", "pp-row");
      const text = el("div", "pp-text");
      text.append(el("div", "pp-name", c.name), el("div", "pp-hint", c.detail));
      row.append(text);
      if (startable) {
        const b = el("button", "primary", "▶ Start");
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
      say("Can't reach the lights right now. Trying again…");
      $("pp-message").dataset.kind = "offline";
    }
  }

  async function send(path, body) {
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
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 3000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}

if (typeof document !== "undefined") start();
