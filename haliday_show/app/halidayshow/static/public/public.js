import { bestOn } from "./colours.js";
import { bare, label as iconLabel } from "./icons.js";
import { NUDGE_STEP, addSample, clampNudge, learnLead, median, steer, target } from "./listensync.js";

// The public page: people passing by pick a show and queue it up, and (if you allow it) listen to
// the music on their phone. It only talks to the public port's own calls, never to the editor.

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
  if (st.vote) {
    // Voting: one vote per phone, changed by pressing another, so nothing holds a phone back.
  } else if (st.wait_left > 0) {
    block = say_(w, "phone_wait", { minutes: minutes(st.wait_left) });
  } else if (waiting >= st.per_phone) {
    block = st.per_phone === 1 ? say_(w, "one_waiting") : say_(w, "many_waiting", { count: waiting });
  } else if (st.full) {
    block = say_(w, "full");
  }
  let now = say_(w, st.vote ? "idle_vote" : "idle");
  if (st.resting > 0 && !st.now) {
    now = say_(w, "resting");
  } else if (st.now && st.vote) {
    now = say_(w, "on_now_vote", { name: st.now.name || "…" });
  } else if (st.now) {
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

// The queue as visitors see it: every pick by show name, yours marked, the first few unless opened.
export const QUEUE_SHOWN = 3;
export function queueView(st, w, open = false) {
  const q = st.queue || [];
  const rows = q.map((r, k) => ({
    place: k + 1, name: r.name, yours: !!r.yours, id: r.id || "", kind: r.kind || "", ref: r.ref || "",
    when: r.yours ? say_(w, "queue_yours", { minutes: minutes(r.wait) }) : say_(w, "queue_when", { minutes: minutes(r.wait) }),
  }));
  // Always show your own, even far down.
  const shown = open ? rows : rows.filter((r, k) => k < QUEUE_SHOWN || r.yours);
  return {
    head: q.length ? say_(w, "up_next", { count: q.length }) : "",
    rows: shown,
    more: rows.length > shown.length ? say_(w, "queue_more", { count: rows.length })
      : open && rows.length > QUEUE_SHOWN ? say_(w, "queue_less") : "",
  };
}

// Installed as an app (or added to the home screen on an iPhone): the Install button isn't needed.
export const runningAsApp = (win) => !!(win.matchMedia?.("(display-mode: standalone)").matches || win.navigator?.standalone);

// The first-visit welcome: which steps it has, and the words for picking that match how the page is
// set up (Start, Queue or Vote), worked out from api/state.
export function tourPlan(st, w) {
  const vote = !!st.vote;
  const word = vote ? "vote_btn" : startWord(st);
  const text = vote ? "tour_pick_vote" : word === "start" ? "tour_pick_start" : "tour_pick_queue";
  const rules = [];
  if (st.hours?.until) rules.push(say_(w, "tour_hours", { time: clockText(st.hours.until.slice(11, 16)) }));
  if (!vote && !st.admin && st.per_phone === 1) rules.push(say_(w, "tour_one"));
  else if (!vote && !st.admin && st.per_phone > 1) rules.push(say_(w, "tour_many", { count: st.per_phone }));
  const listen = !!st.listen, join = !!st.phones;
  const steps = ["welcome", ...((st.choices || []).length ? ["pick"] : []), ...(listen || join ? ["join"] : [])];
  return { steps, word, text, rules, listen, join, warning: warningShown(st.look) };
}

// The icon for each show button's word.
export const BUTTON_ICON = { start: "play", queue_btn: "plus", queued_btn: "check", playing_btn: "music",
  recent_btn: "clock", late_btn: "clock", vote_btn: "plus", voted_btn: "check" };

// With voting on: a show's votes in words, and whether it's winning (the first listed is the leader).
export function voteOf(c, st) {
  const v = st.vote;
  if (!v) return null;
  const key = `${c.kind}:${c.id}`, count = v.counts?.[key] || 0;
  const w = st.words;
  return {
    key, count, mine: v.mine === key,
    leading: count > 0 && Object.keys(v.counts || {})[0] === key,
    text: count ? say_(w, count === 1 ? "vote_count_one" : "vote_count", { count }) : "",
  };
}

// Pressing Start or Queue on a show with no speaker also starts listening on this phone, if listening
// is on and it isn't already (the press is what lets a phone play sound).
export const listensToo = (c, st, listening) => !!(st.listen && c.speaker === false && !listening);

// The button on each show: Start when it would play straight away, Queue when it would wait.
export const startWord = (st) => (st.now || (st.queue || []).length ? "queue_btn" : "start");

// Your headings, in the order they first appear, for the buttons above the shows.
export function headingsOf(choices) {
  const out = [];
  for (const c of choices || []) if (c.group && !out.includes(c.group)) out.push(c.group);
  return out;
}

// How far through the show on now is, 0 to 1, moving on from the last answer by the time since.
export function progressOf(now, sinceMs) {
  if (!now || !(now.duration > 0)) return null;
  return Math.min(1, Math.max(0, (now.position + sinceMs / 1000) / now.duration));
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

// The editor's preview asks for one dated look (?look=…); the page on the public port ignores it.
const LOOK = typeof location === "undefined" ? "" : new URLSearchParams(location.search).get("look") || "";
const lookParam = LOOK ? `&look=${encodeURIComponent(LOOK)}` : "";

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

// The phone remembers the warning it accepted, word for word, so it isn't asked on every visit but is
// asked again if you change what the warning says.
export const warningAccepted = (kept, text) => !!kept && kept === text;

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

const PASS_KEY = "halidayshow.listenPass";
const ADMIN_KEY = "halidayshow.adminPass";

// The hidden way into the admin PIN box: this many taps on the title, each within `gap` ms of the last.
export const ADMIN_TAPS = 5;
export function tapsDone(times, now, need = ADMIN_TAPS, gap = 700) {
  const run = times.length && now - times[times.length - 1] < gap ? [...times, now] : [now];
  return run.length >= need ? { times: [], done: true } : { times: run, done: false };
}
const NUDGE_KEY = "halidayshow.listenNudge";

// How the Music ahead / behind setting reads: {key, seconds} for the word to show.
export function nudgeWord(nudge) {
  if (!nudge) return { key: "nudge_none", seconds: "0" };
  const seconds = Math.abs(nudge).toFixed(2).replace(/0$/, "");
  return { key: nudge > 0 ? "nudge_earlier_by" : "nudge_later_by", seconds };
}
const POLL_MS = 1000;
const STEER_MS = 250;
const RENEW_EARLY_S = 120; // ask for a new pass this long before it runs out

// Listening on the phone: plays the song that's on now, kept in time with the lights (listensync.js).
// say(key, vars) gives a word; pos() where the phone is (for the nearby check); onChange() redraws.
export function makeListener({ code, say, pos, onChange, headers = () => ({}) }) {
  const audio = new Audio();
  audio.preload = "auto";
  if ("preservesPitch" in audio) audio.preservesPitch = true;
  const me = {
    on: false, state: "off", // "off" | "pin" | "starting" | "loading" | "playing" | "idle" | "tap"
    name: "", message: "", token: "", until: 0,
  };
  let samples = [], song = null, src = "", errs = [], lead = 0.15, seekedAt = 0, learning = false;
  let nudge = 0; // seconds earlier than the lights, kept on this phone
  let house = 0; // and for every phone, set with the pre-show check's timing test
  const ahead = () => nudge + house;
  try { nudge = clampNudge(localStorage.getItem(NUDGE_KEY)); } catch { /* private browsing */ }
  let pollTimer = null, steerTimer = null, polling = false, gen = 0;
  const passKey = `${PASS_KEY}.${code}`;
  const keptPass = () => { try { return localStorage.getItem(passKey) || ""; } catch { return ""; } };
  const keepPass = (v) => { try { v ? localStorage.setItem(passKey, v) : localStorage.removeItem(passKey); } catch { /* this visit only */ } };

  const set = (state, message = "") => { me.state = state; me.message = message; onChange(); };

  // Phones only play sound started by a press: play a moment of silence now, so the song can start
  // later on this same player.
  function unlock() {
    audio.src = "listen/silence.wav";
    src = "";
    audio.play().catch(() => {});
  }

  async function getPass(pin) {
    const body = { code, ...(pos() || {}) };
    if (pin) body.pin = pin;
    else if (keptPass()) body.pass = keptPass();
    const res = await fetch("api/listen", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers() }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(text || say("offline"));
      err.pin = res.headers.get("X-Listen") === "pin";
      err.status = res.status;
      if (err.pin && !pin) keepPass("");
      throw err;
    }
    const ans = await res.json();
    if (ans.pass) keepPass(ans.pass);
    me.token = ans.token;
    me.until = Date.now() + ans.seconds * 1000;
  }

  async function begin(pin, needsPin) {
    if (needsPin && !pin && !keptPass()) { set("pin"); return; }
    unlock();
    me.on = true;
    set("starting");
    try {
      await getPass(pin);
    } catch (e) {
      me.on = false;
      audio.pause();
      if (e.pin) set("pin", e.message);
      else set("off", e.message);
      return;
    }
    const mine = ++gen;
    samples = []; errs = [];
    poll(mine);
    clearInterval(steerTimer);
    steerTimer = setInterval(steerNow, STEER_MS);
  }

  function stop(message = "") {
    me.on = false;
    gen++;
    clearTimeout(pollTimer);
    clearInterval(steerTimer);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    src = ""; song = null; samples = [];
    set("off", message);
  }

  async function poll(mine) {
    if (mine !== gen || polling) return;
    polling = true;
    try {
      if (me.until - Date.now() < RENEW_EARLY_S * 1000) await getPass();
      const sent = performance.now();
      const res = await fetch(`api/listen/now?${new URLSearchParams({ code, token: me.token })}`, { cache: "no-store", headers: headers() });
      const recv = performance.now();
      if (mine !== gen) return;
      if (res.status === 403 && res.headers.get("X-Listen") === "renew") {
        await getPass();
      } else if (!res.ok) {
        if (res.status === 409 || res.status === 403) { stop(await res.text()); return; }
      } else {
        heard(await res.json(), sent, recv);
      }
    } catch (e) {
      if (mine !== gen) return;
      if (e.status) { // a pass refused: the PIN changed, listening was turned off, or the phone walked off
        me.on = false;
        stop(e.message);
        if (e.pin) set("pin", e.message);
        return;
      }
      // A blip: carry on, the song keeps playing meanwhile.
    } finally {
      polling = false;
    }
    if (mine === gen) pollTimer = setTimeout(() => poll(mine), POLL_MS);
  }

  function heard(now, sent, recv) {
    if (!now.playing) {
      if (song) { audio.pause(); song = null; src = ""; samples = []; }
      set("idle");
      return;
    }
    me.name = now.name || "";
    const was = house;
    house = Math.max(-2, Math.min(2, Number(now.offset) || 0));
    if (house !== was) errs = []; // a new timing: steer to it afresh
    if (song !== now.key) { song = now.key; samples = []; errs = []; }
    samples = addSample(samples, { sent, recv, position: now.position });
    if (!now.ready) { set("loading"); return; }
    if (src !== now.src) {
      src = now.src;
      audio.src = src;
      seekTo();
      return;
    }
    if (audio.paused && me.state !== "tap") play();
  }

  function play() {
    audio.play().then(() => { if (me.state !== "playing") set("playing"); }).catch((e) => {
      if (e?.name === "NotAllowedError") set("tap");
    });
  }

  function seekTo() {
    const t = target(samples, performance.now());
    if (t === null) return;
    try { audio.currentTime = Math.max(0, t + ahead() + lead); } catch { /* not loaded yet: the next steer tries again */ }
    seekedAt = performance.now();
    learning = true;
    errs = [];
    audio.playbackRate = 1;
    if (audio.paused) play();
  }

  function steerNow() {
    if (!me.on || !src || audio.paused || audio.readyState < 2) return;
    const now = performance.now();
    const t = target(samples, now);
    if (t === null) return;
    if (now - seekedAt < 1000) return; // let a jump settle first
    errs = [...errs, audio.currentTime - (t + ahead())].slice(-8);
    if (errs.length < 4) return;
    const err = median(errs);
    if (learning) { lead = learnLead(lead, err); learning = false; }
    const move = steer(err);
    if (move.seek) seekTo();
    else if (audio.playbackRate !== move.rate) audio.playbackRate = move.rate;
  }

  audio.addEventListener("ended", () => { if (me.on) set("idle"); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && me.on) { clearTimeout(pollTimer); poll(gen); }
  });

  return {
    get state() { return me; },
    begin,
    stop,
    // Pressing Listen again after the phone wouldn't play by itself.
    resume() { set("playing"); play(); },
    get nudge() { return nudge; },
    // Music earlier (+1) or later (-1) by a step. A small change glides in; a big one jumps.
    shift(dir) {
      nudge = clampNudge(nudge + dir * NUDGE_STEP);
      try { localStorage.setItem(NUDGE_KEY, String(nudge)); } catch { /* this visit only */ }
      errs = [];
      onChange();
    },
  };
}

const BOOT_KEY = "halidayshow.publicBoot";

// HA-liday Show restarted (an update, say) since this page loaded: load it again, so a page left open
// on a phone doesn't carry on as the old version. Once per restart, so a stale copy can't loop.
export function shouldReload(loadedWith, now, reloadedFor) {
  return !!(loadedWith && now && now !== loadedWith && now !== reloadedFor);
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
  let acceptedText = "";
  try { acceptedText = localStorage.getItem(ACCEPTED_KEY) || ""; } catch { /* private browsing */ }
  const accepted = () => warningAccepted(acceptedText, w ? say_(w, "warning") : "");
  const snow = makeSnow($("pp-snow"));
  let pictureShown = 0;
  let bootSeen = "";
  function reloadIfUpdated(boot) {
    if (preview || !boot) return false;
    let done = "";
    try { done = sessionStorage.getItem(BOOT_KEY) || ""; } catch { /* private browsing */ }
    if (!bootSeen) { bootSeen = boot; return false; }
    if (!shouldReload(bootSeen, boot, done)) return false;
    try { sessionStorage.setItem(BOOT_KEY, boot); } catch { /* reloads once anyway */ }
    location.reload();
    return true;
  }
  // Your own phone, unlocked with the admin PIN: the pass goes with every call.
  const adminKey = `${ADMIN_KEY}.${key}`;
  let adminPass = "";
  try { adminPass = (!preview && localStorage.getItem(adminKey)) || ""; } catch { /* private browsing */ }
  const keepAdmin = (v) => {
    adminPass = v;
    try { v ? localStorage.setItem(adminKey, v) : localStorage.removeItem(adminKey); } catch { /* this visit only */ }
  };
  const adminHeaders = () => (adminPass ? { "X-Admin": adminPass } : {});
  let adminOpen = false, taps = [];
  let queueOpen = false, nudgeOpen = false, heading = "", gotAt = 0;
  // Installing as an app: the manifest carries the code (so the app opens unlocked), and the phone's own
  // install offer is kept for the Install button rather than shown at a random moment.
  let installOffer = null;
  if (!preview && key) {
    const link = (rel, href) => { const l = document.createElement("link"); l.rel = rel; l.href = href; document.head.append(l); };
    link("manifest", `manifest.webmanifest?${new URLSearchParams({ c: key })}`);
    link("apple-touch-icon", "icon.png?s=192");
    addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      installOffer = e;
      drawInstall();
    });
    addEventListener("appinstalled", () => { installOffer = null; drawInstall(); });
  }
  function drawInstall() {
    const b = $("pp-install");
    b.hidden = !installOffer || runningAsApp(window) || !last;
    if (!b.hidden) iconLabel(b, "install", say_(w, "install"));
  }
  async function install() {
    if (!installOffer) return;
    const offer = installOffer;
    installOffer = null;
    drawInstall();
    try { await offer.prompt(); await offer.userChoice; } catch { /* the phone said no */ }
  }

  const listener = makeListener({
    code: key, say: (k, vars) => say_(w, k, vars), pos: () => (needsLocation ? where.pos : null),
    onChange: () => drawListen(), headers: adminHeaders,
  });

  // Join the show: the screen glows with the colours the show carries for phones, ten a second, kept in
  // time as listening is (listensync.js). Phones set to reduce motion fade between colours instead of flashing.
  // One press joins: the screen opens dark with the flashing warning, then the colours fade in.
  const join = { on: false, samples: [], key: "", colours: "", house: "", lane: null, fps: 10, timer: 0, raf: 0, wake: null,
    gen: 0, since: 0 };
  // The editor's effect code (effects.js), loaded the first time a show with a Phones lane plays here.
  let fx = null, fxPictures = null, img = null;
  async function loadFx() {
    if (!fx) {
      [fx, fxPictures] = await Promise.all([import("./fx/effects.js"), import("./fx/pictures.js")]);
    }
    return fx;
  }
  const JOIN_POLL_MS = 1000, WARN_MS = 3000, FADE_IN_MS = 1000;
  const JOIN_WARNED_KEY = "halidayshow.joinWarned", TOUR_KEY = "halidayshow.tourSeen";
  const joinWarned = () => { try { return localStorage.getItem(JOIN_WARNED_KEY) === say_(w, "tour_flash_phone"); } catch { return false; } };

  async function joinPoll(gen) {
    if (!join.on || gen !== join.gen) return;
    const sent = performance.now();
    try {
      const res = await fetch(`api/phones/now?${new URLSearchParams({ code: key })}`, { cache: "no-store", headers: adminHeaders() });
      const recv = performance.now();
      if (gen !== join.gen) return;
      if (res.status === 403 || res.status === 409) { leaveShow(await res.text()); return; }
      if (res.ok) {
        const now = await res.json();
        if (!now.playing) { join.key = ""; join.samples = []; join.colours = ""; join.lane = null; }
        else {
          if (now.key !== join.key) {
            join.key = now.key; join.samples = []; join.colours = ""; join.lane = null;
            joinColours(now.key, gen);
          }
          join.samples = addSample(join.samples, { sent, recv, position: now.position });
        }
      }
    } catch { /* the next try */ }
    if (join.on && gen === join.gen) join.timer = setTimeout(() => joinPoll(gen), JOIN_POLL_MS);
  }

  async function joinColours(want, gen) {
    try {
      const res = await fetch(`api/phones/colours?${new URLSearchParams({ code: key, key: want })}`, { cache: "no-store", headers: adminHeaders() });
      if (!res.ok || gen !== join.gen || join.key !== want) return;
      const got = await res.json();
      // A Phones lane: drawn here, with its pictures kept for the Picture effect. If the effect code
      // won't load, the show's colours (one at a time) still do.
      if (got.lane && Array.isArray(got.lane.clips)) {
        try {
          await loadFx();
          for (const [id, pic] of Object.entries(got.lane.pictures || {})) fxPictures.keepPicture(id, pic);
          if (gen === join.gen && join.key === want) join.lane = got.lane;
        } catch { /* one colour at a time, then */ }
      }
      join.colours = String(got.colours || "");
      join.house = String(got.house || "");
      join.fps = Number(got.fps) || 10;
    } catch { /* asked again with the next show */ }
  }

  function joinFrame() {
    if (!join.on) return;
    const t = join.colours ? target(join.samples, performance.now()) : null;
    const shown = performance.now() - join.since;
    const level = Math.max(0, Math.min(1, (shown - join.warnMs) / FADE_IN_MS));
    const colourOf = (list, at) => {
      const k = Math.floor(at * join.fps);
      return k >= 0 && (k + 1) * 6 <= list.length ? [0, 2, 4].map((i) => parseInt(list.slice(k * 6 + i, k * 6 + i + 2), 16)) : null;
    };
    let rgb = "rgb(0, 0, 0)";
    const c = t !== null && level > 0 ? colourOf(join.colours, t) : null;
    if (c) rgb = `rgb(${c.map((v) => Math.round(v * level)).join(", ")})`;
    const box = $("pp-join");
    if (box.style.backgroundColor !== rgb) box.style.backgroundColor = rgb;
    // The show's Phones lane, drawn on the screen (its main colour all round it).
    const screen = $("pp-join-screen"), lane = t !== null && level > 0 && fx ? join.lane : null;
    screen.hidden = !lane;
    if (lane) {
      const { w: gw, h: gh } = { w: screen.width, h: screen.height };
      const main = join.house ? colourOf(join.house, t) : null;
      const frame = fx.withVoiceLevels(lane.voice || null, () => fx.withMusicLevels(lane.loudness || null,
        () => fx.phoneScreen(lane.clips, t, main, lane.level ?? 1)));
      const ctx = screen.getContext("2d");
      if (!img) img = ctx.createImageData(gw, gh);
      for (let i = 0, n = gw * gh; i < n; i++) {
        img.data[i * 4] = frame[i * 3] * level; img.data[i * 4 + 1] = frame[i * 3 + 1] * level;
        img.data[i * 4 + 2] = frame[i * 3 + 2] * level; img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      // Above and below it, the colours of its own top and bottom rows, so it carries on to the edges.
      const row = (y) => {
        const c = [0, 0, 0];
        for (let x = 0; x < gw; x++) for (let j = 0; j < 3; j++) c[j] += frame[(y * gw + x) * 3 + j] * level / gw;
        return `rgb(${c.map(Math.round).join(", ")})`;
      };
      box.style.background = `linear-gradient(${row(0)} 50%, ${row(gh - 1)} 50%)`;
    } else if (box.style.backgroundImage) {
      box.style.background = "";
      box.style.backgroundColor = rgb;
    }
    const warning = shown < join.warnMs;
    const text = warning ? say_(w, "join_warn") : t === null ? say_(w, "join_waiting") : "";
    if ($("pp-join-text").textContent !== text) $("pp-join-text").textContent = text;
    $("pp-join-text").classList.toggle("pp-join-warning", warning);
    join.raf = requestAnimationFrame(joinFrame);
  }

  async function keepAwake() {
    try { if (join.on && !document.hidden && navigator.wakeLock) join.wake = await navigator.wakeLock.request("screen"); } catch { /* fine without */ }
  }

  function joinShow() {
    join.on = true;
    join.since = performance.now();
    // Told already, in the welcome's warning, that the screen flashes: straight to the colours.
    join.warnMs = joinWarned() ? 0 : WARN_MS;
    join.gen++;
    join.samples = []; join.key = ""; join.colours = "";
    $("pp-join").classList.toggle("pp-soft", matchMedia("(prefers-reduced-motion: reduce)").matches);
    iconLabel($("pp-join-leave"), "x", say_(w, "join_leave"));
    $("pp-join").hidden = false;
    keepAwake();
    joinPoll(join.gen);
    join.raf = requestAnimationFrame(joinFrame);
    drawJoin();
  }

  function leaveShow(message = "") {
    join.on = false;
    join.gen++;
    clearTimeout(join.timer);
    cancelAnimationFrame(join.raf);
    try { join.wake?.release(); } catch { /* already let go */ }
    join.wake = null;
    $("pp-join").hidden = true;
    if (message) say(message);
    drawJoin();
  }

  function pressJoin() {
    if (preview) { say("This is a preview. On visitors' phones, this lights up the screen with the show.", true); return; }
    if (join.on) leaveShow();
    else joinShow();
  }

  // The card under the bar shows only while something in it does.
  function drawMore() {
    $("pp-more").hidden = ["pp-listen", "pp-admin-ctl"].every((id) => $(id).hidden);
  }

  function drawJoin() {
    const st = last;
    const offered = !!(st && st.open && st.phones && !st.locked);
    const btn = $("pp-join-btn");
    btn.hidden = !(join.on || (offered && !!st.now && st.phones.now));
    iconLabel(btn, "phone", say_(w, "join_short"));
    btn.setAttribute("aria-label", say_(w, "join").replace(/^[^\p{L}\p{N}]+/u, ""));
    btn.title = btn.getAttribute("aria-label");
    drawMore();
  }

  function drawAdmin(st = last) {
    const on = !!st?.admin;
    $("pp-admin").hidden = !(adminOpen || (on && adminOpen !== null));
    if ($("pp-admin").hidden) return;
    $("pp-admin-pin").hidden = on;
    $("pp-admin-out").hidden = !on;
    if (on) $("pp-admin-text").textContent = "🔓 Admin: this phone skips Nearby, the opening hours, the listening PIN, the limits and cool-downs, and can queue Coming soon shows.";
    else if (!$("pp-admin-text").dataset.said) $("pp-admin-text").textContent = "";
    $("pp-admin-text").hidden = !$("pp-admin-text").textContent;
  }

  function tapTitle() {
    if (preview || !key) return;
    const t = tapsDone(taps, Date.now());
    taps = t.times;
    if (!t.done) return;
    adminOpen = true;
    $("pp-admin-text").textContent = "";
    delete $("pp-admin-text").dataset.said;
    drawAdmin();
    if (!last?.admin) $("pp-admin-input").focus();
  }

  async function unlockAdmin() {
    const pin = $("pp-admin-input").value.trim();
    $("pp-admin-input").value = "";
    if (!pin) return;
    try {
      const res = await fetch("api/admin", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: key, pin }),
      });
      if (!res.ok) {
        $("pp-admin-text").textContent = (await res.text()) || "That didn't work.";
        $("pp-admin-text").dataset.said = "1";
        $("pp-admin-text").hidden = false;
        return;
      }
      keepAdmin((await res.json()).pass);
      delete $("pp-admin-text").dataset.said;
      stopWatching();
      Object.assign(where, { state: "idle", text: "", pos: null });
      refresh();
    } catch {
      $("pp-admin-text").textContent = "Can't reach the lights right now.";
      $("pp-admin-text").dataset.said = "1";
      $("pp-admin-text").hidden = false;
    }
  }

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
      $("pp-picture").src = `picture?code=${encodeURIComponent(key)}&v=${look.picture}${lookParam}`;
    }
    pictureShown = look.picture || 0;
    $("pp-picture").hidden = !look.picture;
    $("pp-header").classList.toggle("pp-banner", !!look.picture);
    // The phone's bar above the page, in the page's own background.
    const bg = getComputedStyle(document.body).backgroundColor;
    if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
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
        method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() },
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

  // Listen: a small button in the bar, with its details underneath while listening (or asking for the PIN).
  function drawListen() {
    const st = last;
    const me = listener.state;
    const offered = !!(st && st.open && st.listen && !st.locked);
    const btn = $("pp-listen-btn");
    // Nothing on: nothing to hear yet, so no button (Start on a show with no speaker still starts listening).
    btn.hidden = !(me.on || (offered && !!st.now && canStart(needsLocation, where)));
    const playing = me.on && me.state !== "tap";
    iconLabel(btn, playing ? "soundoff" : "headphones", say_(w, playing ? "listening_short" : "listen_short"));
    btn.setAttribute("aria-pressed", String(playing));
    btn.setAttribute("aria-label", say_(w, playing ? "listen_stop" : "listen").replace(/^[^\p{L}\p{N}]+/u, ""));
    // Says it's only this phone's sound: Stop on its own looked like it would stop the show.
    btn.title = say_(w, playing ? "listen_stop" : "listen_hint").replace(/^[^\p{L}\p{N}]+/u, "");
    const panel = $("pp-listen");
    panel.hidden = !(me.on || me.state === "pin" || me.message);
    drawMore();
    if (panel.hidden) return;
    const text = {
      off: "", pin: "", starting: "listen_loading", loading: "listen_loading", tap: "listen_tap",
      playing: me.name ? "listen_on" : "listen_nothing", idle: "listen_nothing",
    }[me.state];
    if (text) iconLabel($("pp-listen-text"), "headphones", say_(w, text, { name: me.name }));
    else $("pp-listen-text").textContent = "";
    $("pp-listen-text").hidden = !text;
    $("pp-pin").hidden = me.state !== "pin";
    $("pp-pin-label").textContent = say_(w, "pin_ask");
    iconLabel($("pp-pin-ok"), "check", say_(w, "pin_ok"));
    $("pp-listen-msg").textContent = me.message;
    $("pp-listen-msg").hidden = !me.message;
    $("pp-listen-tip").textContent = say_(w, "listen_lock");
    const listening = me.on && ["playing", "idle", "loading"].includes(me.state);
    $("pp-listen-tip").hidden = !(listening && nudgeOpen);
    // Music ahead / behind, tucked behind a link while listening.
    $("pp-nudge-open").hidden = !listening;
    $("pp-nudge-open").textContent = say_(w, "out_of_time");
    $("pp-nudge-open").setAttribute("aria-expanded", String(nudgeOpen));
    $("pp-nudge").hidden = !(listening && nudgeOpen);
    $("pp-nudge-label").textContent = say_(w, "nudge_label");
    iconLabel($("pp-nudge-earlier"), "left", say_(w, "nudge_earlier"));
    iconLabel($("pp-nudge-later"), "right", say_(w, "nudge_later"), true);
    const nw = nudgeWord(listener.nudge);
    $("pp-nudge-value").textContent = say_(w, nw.key, { seconds: nw.seconds });
    $("pp-nudge-hint").textContent = say_(w, "nudge_hint");
  }

  // What's on and how far through, the queue under it.
  let artShown = "";
  function drawBar(st, view) {
    $("pp-now").textContent = view.now;
    // Its cover art (or a tile in its colours), drawn again only when what's on changes.
    const n = st.now;
    // (No picture of its own: a tile with its first letter, as in the list. Covers turned off: none.)
    const art = n && n.name && ("kind" in n || "colours" in n) ? `${n.kind}:${n.id}:${n.cover}:${n.name}` : "";
    if (art !== artShown) {
      artShown = art;
      const pic = art ? coverOf({ kind: n.kind, id: n.id, name: n.name || "", cover: n.cover || 0, colours: n.colours || [] }, st) : null;
      $("pp-now-art").replaceChildren(...(pic ? [pic] : []));
      $("pp-now-art").hidden = !pic;
    }
    // Your own pick stays in sight while the shows scroll: playing, or where it is in the queue.
    const yours = view.mine[0];
    $("pp-now-yours").textContent = yours ? yours.text : "";
    $("pp-now-yours").hidden = !yours;
    drawProgress();
    // Your admin phone: skip a visitor's pick, or stop everything.
    $("pp-admin-ctl").hidden = !(st.admin && st.now);
    $("pp-admin-skip").hidden = !st.now?.visitor;
    drawMore();
    const q = queueView(st, w, queueOpen);
    $("pp-queue-box").hidden = !q.rows.length;
    $("pp-queue-head").textContent = q.head;
    $("pp-queue").replaceChildren(...q.rows.map((r) => {
      const li = el("li", r.yours ? "pp-yours" : "");
      const pick = (st.choices || []).find((c) => c.kind === r.kind && c.id === r.ref);
      const art = coverOf({ kind: r.kind, id: r.ref, name: r.name, cover: pick?.cover || 0, colours: pick?.colours || [] }, st);
      if (art) li.append(art);
      const text = el("div", "pp-text");
      text.append(el("div", "pp-name", r.name));
      const meta = el("div", "pp-when");
      meta.append(el("span", "pp-place", `${r.place}.`), document.createTextNode(` ${r.when}`));
      text.append(meta);
      li.append(text);
      if (!r.yours && r.id && st.admin) {
        const b = iconLabel(el("button"), "x", "Remove");
        b.type = "button";
        b.setAttribute("aria-label", `Remove: ${r.name}`);
        b.addEventListener("click", () => send("api/admin/remove", { id: r.id }));
        li.append(b);
      }
      if (r.yours && r.id) {
        const b = iconLabel(el("button"), "x", say_(w, "cancel"));
        b.type = "button";
        b.setAttribute("aria-label", `${say_(w, "cancel")}: ${r.name}`);
        b.addEventListener("click", () => send("api/cancel", { id: r.id }));
        li.append(b);
      }
      return li;
    }));
    $("pp-queue-more").textContent = q.more;
    $("pp-queue-more").hidden = !q.more;
    $("pp-queue-more").setAttribute("aria-expanded", String(queueOpen));
  }

  // A show's cover art from its song, or a tile in its colours with its first letter (none if covers are off).
  function coverOf(c, st) {
    if (st.look?.covers === false) return null;
    if (c.cover) {
      const img = el("img", "pp-cover");
      img.alt = "";
      img.loading = "lazy";
      img.src = `cover?${new URLSearchParams({ kind: c.kind, id: c.id, code: key, v: String(c.cover) })}`;
      img.addEventListener("error", () => img.remove());
      return img;
    }
    const tile = el("span", "pp-cover pp-tile", [...c.name.trim()].find((ch) => /[\p{L}\p{N}]/u.test(ch))?.toLocaleUpperCase() || "♪");
    tile.setAttribute("aria-hidden", "true");
    // Its palette's colours, or two picked from its name (as in the app's Library).
    let h = 0;
    for (const ch of c.name) h = (h * 31 + ch.codePointAt(0)) % 360;
    const cols = c.colours?.length ? c.colours : [`hsl(${h}, 55%, 42%)`, `hsl(${(h + 50) % 360}, 60%, 32%)`];
    tile.style.background = cols.length === 1 ? cols[0] : `linear-gradient(135deg, ${cols.join(", ")})`;
    return tile;
  }

  // A show's colours as a row of small dots, the colours it plays on the house (none without a palette).
  function dotsOf(c) {
    const cols = (c.dots || []).filter((x) => /^#[0-9a-f]{6}$/i.test(x));
    if (!cols.length) return null;
    const row = el("span", "pp-dots");
    row.setAttribute("aria-hidden", "true");
    for (const col of cols) {
      const d = el("span", "pp-dot");
      d.style.background = col;
      row.append(d);
    }
    return row;
  }

  function drawProgress() {
    const p = progressOf(last?.now, Date.now() - gotAt);
    $("pp-progress").hidden = p === null;
    if (p !== null) $("pp-progress-fill").style.width = `${(p * 100).toFixed(1)}%`;
  }

  // The welcome, the first time a phone opens the page (or from How this works at the bottom).
  let tourAt = -1, tourChecked = false;
  function maybeTour(st) {
    $("pp-tour-again").hidden = !st.open || st.look?.tour === false;
    iconLabel($("pp-tour-again"), "", say_(w, "tour_again"));
    if (tourChecked || !st.open) return;
    tourChecked = true;
    let seen = false;
    try { seen = localStorage.getItem(TOUR_KEY) === "1"; } catch { /* private browsing: show it */ }
    if (!preview && st.look?.tour !== false && !seen) openTour();
  }
  function openTour() {
    tourAt = 0;
    document.body.classList.add("pp-tour-open");
    drawTour();
    $("pp-tour").querySelector("h1")?.focus();
  }
  function closeTour() {
    tourAt = -1;
    $("pp-tour").hidden = true;
    document.body.classList.remove("pp-tour-open");
    try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* shown again next time */ }
    if (last) render(last);
  }
  const tourButton = (cls, ico, words, go, after = false) => {
    const b = iconLabel(el("button", cls), ico, words, after);
    b.type = "button";
    b.addEventListener("click", go);
    return b;
  };
  function drawTour() {
    if (tourAt < 0 || !last) return;
    const st = last, plan = tourPlan(st, w), step = plan.steps[tourAt];
    const box = el("div", "pp-tour-in");
    const top = el("div", "pp-tour-top");
    const dots = el("div", "pp-tour-dots");
    dots.setAttribute("aria-label", say_(w, "tour_step", { step: tourAt + 1, count: plan.steps.length }));
    plan.steps.forEach((_, k) => dots.append(el("span", k === tourAt ? "pp-on" : k < tourAt ? "pp-done" : "")));
    top.append(dots);
    const last_ = tourAt === plan.steps.length - 1;
    const next = () => { if (last_) closeTour(); else { tourAt++; drawTour(); } };
    // No Skip past the warning: it's the one thing everyone should read.
    if (!(step === "welcome" && plan.warning)) top.append(tourButton("pp-link-btn pp-tour-skip", "", say_(w, "tour_skip"), closeTour));
    box.append(top);
    const head = el("h1", "", "");
    head.id = "pp-tour-head";
    head.tabIndex = -1;
    const foot = el("div", "pp-tour-foot");
    const row = el("div", "pp-tour-buttons");
    if (tourAt > 0) row.append(tourButton("", "left", say_(w, "tour_back"), () => { tourAt--; drawTour(); }));
    if (step === "welcome") {
      if (!$("pp-picture").hidden && $("pp-picture").src) {
        const pic = el("img", "pp-tour-picture");
        pic.src = $("pp-picture").src;
        pic.alt = "";
        box.append(pic);
      }
      head.textContent = $("pp-title").textContent;
      box.append(head, el("p", "pp-tour-text", [say_(w, "tour_intro"), plan.listen || plan.join ? say_(w, "tour_intro_more") : ""].filter(Boolean).join(" ")));
      if (plan.warning) {
        const warn = el("div", "pp-card pp-tour-warning");
        warn.append(el("p", "", say_(w, "warning")));
        if (plan.join) warn.append(el("p", "pp-tour-phone", say_(w, "tour_flash_phone")));
        box.append(warn);
      }
      row.append(tourButton("primary", plan.warning ? "check" : "", say_(w, plan.warning ? "tour_accept" : last_ ? "tour_done" : "tour_next"), () => {
        if (plan.warning) {
          acceptedText = say_(w, "warning");
          try { localStorage.setItem(ACCEPTED_KEY, acceptedText); } catch { /* kept for this visit */ }
          if (plan.join) try { localStorage.setItem(JOIN_WARNED_KEY, say_(w, "tour_flash_phone")); } catch { /* the usual warning on joining */ }
        }
        next();
      }, !plan.warning));
      foot.append(row, el("p", "pp-tour-once", say_(w, "tour_once")));
    } else if (step === "pick") {
      head.textContent = say_(w, "tour_pick_head");
      const word = say_(w, plan.word);
      box.append(head, el("p", "pp-tour-text", say_(w, plan.text, { button: bare(word) })));
      // One of your own shows, with the button visitors will see.
      const c = st.choices[0];
      const eg = el("div", "pp-row pp-tour-example");
      const art = coverOf(c, st);
      if (art) eg.append(art);
      const t = el("div", "pp-text");
      t.append(el("div", "pp-name", c.name));
      eg.append(t);
      const fake = iconLabel(el("span", "pp-tour-fake primary"), BUTTON_ICON[plan.word], word);
      fake.setAttribute("aria-hidden", "true");
      eg.append(fake);
      box.append(eg);
      if (plan.rules.length) {
        const ul = el("ul", "pp-tour-rules");
        for (const r of plan.rules) ul.append(el("li", "", r));
        box.append(ul);
      }
      row.append(tourButton("primary", last_ ? "" : "right", say_(w, last_ ? "tour_done" : "tour_next"), next, true));
      foot.append(row);
    } else {
      head.textContent = say_(w, "tour_join_head");
      box.append(head, el("p", "pp-tour-text", say_(w, "tour_join_hint")));
      if (plan.listen) {
        const card = el("section", "pp-card pp-tour-card");
        card.append(el("h2", "", say_(w, "tour_listen_head")), el("p", "", say_(w, "tour_listen")));
        const on = listener.state.on;
        const b = tourButton(on ? "pp-taken" : "", on ? "check" : "headphones", say_(w, on ? "tour_listening" : "listen_short"), () => {
          pressListen();
          // A listening PIN is asked for at the top of the page.
          if (st.listen?.pin) closeTour();
          else setTimeout(drawTour, 300);
        });
        b.disabled = on;
        card.append(b);
        box.append(card);
      }
      if (plan.join) {
        const card = el("section", "pp-card pp-tour-card");
        card.append(el("h2", "", say_(w, "tour_join_card_head")), el("p", "", say_(w, "tour_join_card")));
        card.append(tourButton("", "phone", say_(w, "tour_join_card_head"), () => { closeTour(); joinShow(); }));
        box.append(card);
      }
      row.append(tourButton("primary", "", say_(w, "tour_done"), closeTour));
      foot.append(row);
      if (installOffer && !runningAsApp(window)) foot.append(tourButton("pp-link-btn", "install", say_(w, "install"), install));
    }
    box.append(foot);
    $("pp-tour").replaceChildren(box);
    $("pp-tour").hidden = false;
  }

  function pressListen() {
    if (preview) {
      say("This is a preview. On visitors' phones, this plays the music.", true);
      return;
    }
    const me = listener.state;
    if (me.state === "tap") listener.resume();
    else if (me.on) listener.stop();
    else listener.begin("", !!last?.listen?.pin);
  }

  function sendPin() {
    const pin = $("pp-pin-input").value.trim();
    $("pp-pin-input").value = "";
    if (preview) { say("This is a preview. On visitors' phones, this plays the music.", true); return; }
    listener.begin(pin, true);
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
    if (reloadIfUpdated(st.boot)) return;
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
    drawInstall();
    maybeTour(st);
    // A pass that no longer works (the admin PIN changed, or was taken off): forget it.
    if (adminPass && !st.admin) keepAdmin("");
    drawAdmin(st);
    iconLabel($("pp-retry"), "again", say_(w, "try_again"));
    iconLabel($("pp-accept"), "check", say_(w, "accept"));
    for (const [id, key] of [["pp-closed-text", "closed"], ["pp-closed-hint", "closed_hint"],
      ["pp-soon-head", "soon_head"], ["pp-none", "no_shows"], ["pp-warning-text", "warning"]]) {
      $(id).textContent = say_(w, key);
    }
    $("pp-where-text").textContent = whereText(where, w).text;
    // The flashing lights warning, and (if you ask for it) a press to accept it before Start.
    $("pp-warning").hidden = !st.open || !warningShown(st.look);
    $("pp-warning").classList.toggle("pp-slim", !mustAccept(st.look, accepted()));
    $("pp-accept").hidden = !mustAccept(st.look, accepted());
    const closed = comeBackText(st.hours, w);
    $("pp-hours").textContent = closed;
    $("pp-hours").hidden = !closed;
    needsLocation = !!st.needs_location;
    // Outside opening hours nobody's asked for their location: there's nothing to start yet.
    if (needsLocation && where.state === "idle" && st.open && (!closed || st.listen) && !document.hidden) watchWhere();
    if (!needsLocation && where.state !== "idle") { // e.g. Nearby only turned off: start afresh if it comes back
      stopWatching();
      Object.assign(where, { state: "idle", text: "", pos: null });
    }
    if (!needsLocation) $("pp-where").hidden = true;
    const startable = !closed && canStart(needsLocation, where) && !mustAccept(st.look, accepted());
    const view = describe(st);
    $("pp-closed").hidden = !view.closed;
    $("pp-open").hidden = view.closed;
    // Listening turned off (or the page closed) while a phone listens: it stops.
    if (listener.state.on && !(st.open && st.listen)) listener.stop(say_(w, "listen_off"));
    drawListen();
    // Joining turned off (or the page closed) while this phone's in the show: it leaves.
    if (join.on && !(st.open && st.phones)) leaveShow(say_(w, "join_off"));
    drawJoin();
    if (view.closed) return;
    drawBar(st, view);
    $("pp-block").textContent = view.block;
    $("pp-block").hidden = !view.block;
    $("pp-coming").textContent = view.coming;
    $("pp-coming").hidden = !view.coming;
    $("pp-bar").hidden = (!!view.coming || !!closed) && !st.now && !view.mine.length && $("pp-listen-btn").hidden
      && $("pp-join-btn").hidden;
    $("pp-pick").hidden = !view.choices.length;
    $("pp-none").hidden = view.choices.length > 0 || view.soon.length > 0;
    $("pp-soon-head").hidden = !view.soon.length;
    $("pp-soon").replaceChildren(...view.soon.map((c) => {
      // On your admin phone they're full strength, with + Queue to try one out before its date.
      const row = el("div", st.admin ? "pp-row" : "pp-row pp-later");
      const art = coverOf(c, st);
      if (art) row.append(art);
      const text = el("div", "pp-text");
      const hint = el("div", "pp-hint");
      const dots = dotsOf(c);
      if (dots) hint.append(dots);
      hint.append(el("span", "pp-len", c.detail));
      text.append(el("div", "pp-name", c.name), hint);
      row.append(text);
      if (st.admin) {
        const label = c.taken === "queued" ? "queued_btn" : c.taken === "playing" ? "playing_btn" : "queue_btn";
        const b = iconLabel(el("button", c.taken ? "pp-taken" : "primary"), BUTTON_ICON[label], say_(w, label));
        b.type = "button";
        b.disabled = busy || !!c.taken;
        b.setAttribute("aria-label", `${bare(say_(w, label))}: ${c.name}`);
        b.addEventListener("click", () => send("api/request", { kind: c.kind, id: c.id }));
        row.append(b);
      }
      return row;
    }));
    $("pp-pick-hint").textContent = say_(w, st.vote ? "vote_hint" : "pick_hint");
    $("pp-pick-hint").hidden = !startable;
    $("pp-pick-head").textContent = say_(w, startable ? (st.vote ? "vote_head" : "pick_head") : "shows_head");
    $("pp-block").hidden = !view.block || !startable;
    // Buttons for your headings, once there are two or more.
    const heads = headingsOf(view.choices);
    if (heading && !heads.includes(heading)) heading = "";
    $("pp-chips").hidden = heads.length < 2;
    $("pp-chips").setAttribute("aria-label", say_(w, startable ? "pick_head" : "shows_head"));
    $("pp-chips").replaceChildren(...["", ...heads].map((h) => {
      const b = el("button", "", h || say_(w, "all_shows"));
      b.type = "button";
      b.setAttribute("aria-pressed", String(heading === h));
      b.addEventListener("click", () => { heading = h; render(last); });
      return b;
    }));
    const nowName = st.now?.name || "";
    const queued = new Set((st.queue || []).map((r) => `${r.kind}:${r.ref}`));
    const picked = view.choices.filter((c) => !heading || c.group === heading);
    const word = startWord(st);
    const rows = picked.map((c) => {
      const row = el("div", "pp-row");
      const art = coverOf(c, st);
      if (art) row.append(art);
      const text = el("div", "pp-text");
      text.append(el("div", "pp-name", c.name));
      // Shows already waiting or on now can't be picked again; their button says so instead.
      const status = c.taken ? "" : c.name === nowName ? say_(w, "row_playing")
        : queued.has(`${c.kind}:${c.id}`) ? say_(w, "row_queued") : "";
      const phone = st.listen && c.speaker === false ? say_(w, "on_phone") : "";
      const vote = voteOf(c, st);
      const detail = [c.detail, status].filter(Boolean).join(" · ");
      const dots = dotsOf(c);
      if (detail || phone || dots) {
        // The dots and how long it lasts stay together on one line.
        const hint = el("div", "pp-hint");
        // How long it lasts stays in one piece (its dots may sit on the line above on a narrow phone).
        if (dots) hint.append(dots);
        if (detail) hint.append(el("span", "pp-len", phone ? `${detail} ·` : detail), " ");
        if (phone) hint.append(iconLabel(el("span", "pp-inline-ico"), "headphones", phone));
        text.append(hint);
      }
      if (vote?.text) {
        // Its votes on a line of their own, so they never run under the button on a narrow phone.
        const votes = el("div", "pp-hint pp-votes", vote.text);
        if (vote.leading) votes.append(" · ", el("b", "pp-leading", say_(w, "vote_leading")));
        text.append(votes);
      }
      row.append(text);
      if (startable) {
        const label = c.taken === "queued" ? "queued_btn" : c.taken === "playing" ? "playing_btn"
          : c.taken === "recent" ? "recent_btn" : c.taken === "late" ? "late_btn"
            : vote ? (vote.mine ? "voted_btn" : "vote_btn") : word;
        const words = say_(w, label, { minutes: minutes(c.again_in || 60) });
        const b = iconLabel(el("button", c.taken ? "pp-taken" : vote?.mine ? "pp-voted" : "primary"), BUTTON_ICON[label], words);
        b.type = "button";
        b.disabled = !!view.block || busy || !!c.taken;
        b.setAttribute("aria-label", `${bare(words)}: ${c.name}`);
        if (vote) b.setAttribute("aria-pressed", String(vote.mine));
        b.addEventListener("click", () => {
          // Pressing your vote again takes it back.
          if (vote?.mine) { send("api/cancel", { vote: true }); return; }
          // Started in the press itself: phones only play sound that a press starts.
          if (!preview && listensToo(c, st, listener.state.on)) listener.begin("", !!st.listen?.pin);
          send("api/request", { kind: c.kind, id: c.id });
        });
        row.append(b);
      }
      return row;
    });
    // Shows under one of your headings go in a box with it; ones before any heading stand on their own.
    const out = [];
    let box = null, under = null;
    picked.forEach((c, k) => {
      if (!c.group) { out.push(rows[k]); box = null; under = null; return; }
      if (c.group !== under) {
        box = el("section", "pp-group");
        const h = el("h3", "pp-group-name", c.group);
        box.append(h);
        out.push(box);
        under = c.group;
      }
      box.append(rows[k]);
    });
    $("pp-choices").replaceChildren(...out);
  }

  async function refresh() {
    try {
      const res = await fetch(`api/state?ticket=${encodeURIComponent(me)}&code=${encodeURIComponent(key)}${lookParam}`,
        { cache: "no-store", headers: adminHeaders() });
      if (!res.ok) throw new Error();
      gotAt = Date.now();
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
        method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ ...body, ...(needsLocation ? where.pos : {}), ticket: me, code: key }),
      });
      if (res.ok) {
        gotAt = Date.now();
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
  $("pp-title").addEventListener("click", tapTitle);
  $("pp-install").addEventListener("click", install);
  $("pp-tour-again").addEventListener("click", openTour);
  // The buttons whose words are fixed in the page get their icons once.
  for (const [id, ico] of [["pp-admin-ok", "unlock"], ["pp-admin-out", "lock"], ["pp-admin-close", "x"],
    ["pp-admin-skip", "skip"], ["pp-admin-stop", "stop"]]) iconLabel($(id), ico, $(id).textContent);
  $("pp-admin-skip").addEventListener("click", () => send("api/admin/skip", {}));
  $("pp-admin-stop").addEventListener("click", () => {
    if (confirm("Stop the lights and clear the queue?")) send("api/admin/stop", {});
  });
  $("pp-admin-ok").addEventListener("click", unlockAdmin);
  $("pp-admin-input").addEventListener("keydown", (e) => { if (e.key === "Enter") unlockAdmin(); });
  $("pp-admin-close").addEventListener("click", () => { adminOpen = null; drawAdmin(); });
  $("pp-admin-out").addEventListener("click", () => { keepAdmin(""); adminOpen = null; drawAdmin(); refresh(); });
  $("pp-listen-btn").addEventListener("click", pressListen);
  $("pp-join-btn").addEventListener("click", pressJoin);
  $("pp-join-leave").addEventListener("click", () => leaveShow());
  document.addEventListener("visibilitychange", keepAwake);
  $("pp-pin-ok").addEventListener("click", sendPin);
  $("pp-nudge-earlier").addEventListener("click", () => listener.shift(1));
  $("pp-nudge-open").addEventListener("click", () => { nudgeOpen = !nudgeOpen; drawListen(); });
  $("pp-queue-more").addEventListener("click", () => { queueOpen = !queueOpen; if (last) render(last); });
  setInterval(() => { if (!document.hidden && last) drawProgress(); }, 1000);
  $("pp-nudge-later").addEventListener("click", () => listener.shift(-1));
  $("pp-pin-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendPin(); });
  $("pp-accept").addEventListener("click", () => {
    acceptedText = say_(w, "warning");
    try { localStorage.setItem(ACCEPTED_KEY, acceptedText); } catch { /* kept for this visit */ }
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
