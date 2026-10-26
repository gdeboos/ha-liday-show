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

// Why a phone's location couldn't be had, in words.
export function locationProblem(err) {
  if (err?.code === 1) return "Without your location you can't start a show from here. Allow location for this page in your browser's settings, then try again.";
  if (err?.code === 3) return "Your phone took too long to find where you are. Try again.";
  return "Your phone couldn't tell where you are. Try again in a moment.";
}

function whereAmI() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject({ code: 2 }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}

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
    needsLocation = !!st.needs_location;
    $("pp-location").hidden = !needsLocation;
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
    $("pp-choices").replaceChildren(...view.choices.map((c) => {
      const row = el("div", "pp-row");
      const text = el("div", "pp-text");
      text.append(el("div", "pp-name", c.name), el("div", "pp-hint", c.detail));
      const b = el("button", "primary", "▶ Start");
      b.type = "button";
      b.disabled = !!view.block || busy;
      b.setAttribute("aria-label", `Start ${c.name}`);
      b.addEventListener("click", () => send("api/request", { kind: c.kind, id: c.id }));
      row.append(text, b);
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
      let where = {};
      if (needsLocation && path === "api/request") {
        say("Checking you're by the lights…", true);
        try {
          where = await whereAmI();
        } catch (err) {
          say(locationProblem(err));
          return;
        }
        say("");
      }
      const res = await fetch(path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, ...where, ticket: me, code: key }),
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

  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 3000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}

if (typeof document !== "undefined") start();
