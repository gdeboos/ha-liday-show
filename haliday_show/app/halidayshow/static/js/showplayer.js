// The Show player: a page left open on a computer with speakers. When a playlist, the schedule or an
// automation starts a show with no speaker, HA-liday Show offers its song here; this page plays it
// from the right point and keeps telling HA-liday Show where it is, so the lights follow the music.

// What to do next, from HA-liday Show's status and what this page is playing ({started, src} or
// null). "started" counts show starts, so a playlist playing the same show again loads it again.
export function plan(st, current) {
  if (!st?.playing || !st.song) return current ? { action: "stop" } : { action: "wait" };
  const src = `api/audio/file?source=${encodeURIComponent(st.song.source)}&path=${encodeURIComponent(st.song.path)}`;
  if (!current || current.started !== st.started || current.src !== src) {
    return { action: "load", started: st.started, src, position: st.position || 0 };
  }
  return { action: "sync" };
}

// Still the same start of the same song, after waiting for it to load?
export const stillWanted = (st, step) => !!(st?.playing && st.song && st.started === step.started);

const LOAD_TIMEOUT_MS = 15000;

const $ = (id) => document.getElementById(id);
const OFFSET_KEY = "halidayshow.showPlayerOffset";

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: opts.json ? { "Content-Type": "application/json" } : {},
    body: opts.json ? JSON.stringify(opts.json) : undefined });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

export function start() {
  const audio = new Audio();
  audio.preload = "auto";
  let current = null, latency = 0, wakeLock = null, busy = false, running = false;
  const offset = () => (Number($("sp-offset").value) || 0) / 1000;
  try { $("sp-offset").value = localStorage.getItem(OFFSET_KEY) || "0"; } catch { /* private mode */ }
  $("sp-offset").addEventListener("change", () => {
    try { localStorage.setItem(OFFSET_KEY, $("sp-offset").value); } catch { /* private mode */ }
  });
  const say = (text) => { $("sp-now").textContent = text; };

  const keepAwake = async () => {
    try { if ("wakeLock" in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch { /* not allowed */ }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { wakeLock = null; keepAwake(); }
  });

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const st = await api("api/player");
      const step = plan(st, current);
      if (step.action === "stop") {
        audio.pause();
        current = null;
      } else if (step.action === "load") {
        current = null; // set once it's really playing, so a failed load is tried again next tick
        audio.pause();
        audio.src = step.src;
        let timer;
        try {
          await new Promise((ok, fail) => {
            audio.addEventListener("loadedmetadata", ok, { once: true });
            audio.addEventListener("error", () => fail(new Error("this browser couldn't load the song")), { once: true });
            timer = setTimeout(() => fail(new Error("the song took too long to load")), LOAD_TIMEOUT_MS);
          });
        } finally { clearTimeout(timer); }
        // Where the lights are now, as the song took a moment to load; skip it if it's over already.
        const now = await api("api/player");
        if (!stillWanted(now, step)) return;
        audio.currentTime = Math.max(now.position + offset(), 0);
        await audio.play();
        current = { started: step.started, src: step.src, show: now.show };
      } else if (step.action === "sync" && !audio.paused) {
        const sent = performance.now();
        await api("api/player/sync", { method: "POST", json: { show: current.show, position: audio.currentTime - offset() + latency } });
        const half = (performance.now() - sent) / 2000;
        latency = latency * 0.8 + half * 0.2;
      }
      if (current && !audio.paused) {
        say(`♪ Playing ${st.name || current.show}${st.playlist ? ` (playlist: ${st.playlist.name})` : ""}`);
      } else if (current && st.song) say(`${st.name || current.show}: the song has finished; the lights are finishing too.`);
      else say(st.playing && !st.song ? `${st.name || st.show} is playing on a speaker or from the editor, so there's nothing to play here.`
        : "Waiting for a show. Leave this page open.");
      $("sp-error").textContent = "";
    } catch (e) {
      current = null;
      audio.pause();
      $("sp-error").textContent = e.name === "NotAllowedError" ? "Press Start again so this browser lets the page play sound."
        : `Couldn't reach HA-liday Show or play the song (trying again): ${e.message}`;
      if (e.name === "NotAllowedError") $("sp-start").hidden = false;
    } finally {
      busy = false;
    }
  }

  $("sp-start").addEventListener("click", async () => {
    // Browsers only play sound after a press on the page, so this unlocks it for the songs to come.
    audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
    try { await audio.play(); } catch { /* the first song will try again */ }
    $("sp-start").hidden = true;
    $("sp-running").hidden = false;
    keepAwake();
    if (running) return; // pressed again after the browser refused sound: the loop is already going
    running = true;
    tick();
    setInterval(tick, 1000);
  });
}
