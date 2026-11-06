// The Lyrics window's waveform (lyrics.js): the song, the singer's level over it, and each word as a
// block under it. Drag a word to move it, or its left or right edge to stretch it; click anywhere else
// to play the song from there (click again to stop). Zoom with − and +, scroll with the bar under it
// (or the mouse wheel).

import { lineWords, moveWord } from "./lyrics.js";

const WAVE_H = 70, WORDS_Y = 78, WORDS_H = 30, HEIGHT = WORDS_Y + WORDS_H + 4;
const EDGE_PX = 7; // this close to a word's edge, a drag stretches it

// peaks: {rate, data} (0-1 a step); voice: the singer, or null; audio: an Audio of the song.
// lines() and setLines(lines, done) read and change the lines; done is true once a drag ends.
export function lyricStrip({ peaks, voice, duration, audio, lines, setLines }) {
  const el = Object.assign(document.createElement("div"), { className: "lyrics-strip" });
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "The song's waveform with each word under it: drag a word to move it, or its edges to stretch it");
  canvas.style.height = `${HEIGHT}px`;
  const bar = Object.assign(document.createElement("div"), { className: "row lyrics-strip-bar" });
  const mk = (text, title, on) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "ghost small", textContent: text, title });
    b.addEventListener("click", on);
    return b;
  };
  const scroll = Object.assign(document.createElement("input"), { type: "range", min: 0, step: 0.01, value: 0, className: "lyrics-strip-scroll" });
  scroll.setAttribute("aria-label", "Scroll along the song");
  let v0 = 0, span = Math.min(duration, 20), drag = null, picked = null, frame = 0;
  const fit = () => {
    span = Math.min(Math.max(span, 2), Math.max(duration, 2));
    v0 = Math.min(Math.max(v0, 0), Math.max(0, duration - span));
    scroll.max = Math.max(0, duration - span);
    scroll.value = v0;
  };
  const zoom = (by) => { const mid = v0 + span / 2; span *= by; v0 = mid - span / 2; fit(); draw(); };
  bar.append(mk("−", "Show more of the song", () => zoom(1.5)), mk("+", "Zoom in", () => zoom(1 / 1.5)), scroll);
  scroll.addEventListener("input", () => { v0 = Number(scroll.value); fit(); draw(); });
  el.append(canvas, bar);

  const width = () => canvas.clientWidth || 600;
  const xOf = (t) => ((t - v0) / span) * width();
  const tOf = (x) => v0 + (x / width()) * span;
  const words = () => lines().flatMap((l, i) => lineWords(l, voice).map((w, k) => ({ ...w, i, k })));
  const css = (name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

  function draw() {
    const dpr = window.devicePixelRatio || 1, w = width();
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(HEIGHT * dpr); }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, HEIGHT);
    const text = css("--text", "#222"), muted = css("--muted", "#888"), accent = css("--accent", "#0a7cc2");
    // The song.
    g.fillStyle = muted;
    g.globalAlpha = 0.45;
    for (let x = 0; x < w; x++) {
      const a = Math.floor(tOf(x) * peaks.rate), b = Math.max(a + 1, Math.floor(tOf(x + 1) * peaks.rate));
      let m = 0;
      for (let k = a; k < b && k < peaks.data.length; k++) if (peaks.data[k] > m) m = peaks.data[k];
      const h = m * (WAVE_H - 6);
      g.fillRect(x, WAVE_H / 2 - h / 2, 1, Math.max(h, 0.5));
    }
    g.globalAlpha = 1;
    // The singer: where the mouth has something to sing.
    if (voice?.values?.length) {
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x < w; x += 2) {
        const val = voice.values[Math.floor(tOf(x) * voice.fps)] ?? 0;
        const y = WAVE_H - 2 - (val / 100) * (WAVE_H - 8);
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    // Seconds along the top.
    g.fillStyle = muted;
    g.font = "10px system-ui, sans-serif";
    const every = span > 60 ? 10 : span > 20 ? 5 : 1;
    for (let s = Math.ceil(v0 / every) * every; s <= v0 + span; s += every) {
      g.fillRect(xOf(s), 0, 1, 4);
      g.fillText(`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`, xOf(s) + 2, 10);
    }
    // The words, each line in its own colour.
    g.font = "12px system-ui, sans-serif";
    g.textBaseline = "middle";
    for (const wd of words()) {
      const x0 = xOf(wd.start), x1 = xOf(wd.end);
      if (x1 < 0 || x0 > w) continue;
      const on = picked && picked.i === wd.i && picked.k === wd.k;
      g.fillStyle = `hsl(${(wd.i * 67) % 360} 65% ${on ? 62 : 74}%)`;
      g.fillRect(x0, WORDS_Y, Math.max(x1 - x0 - 1, 2), WORDS_H);
      if (on) { g.strokeStyle = text; g.lineWidth = 2; g.strokeRect(x0 + 1, WORDS_Y + 1, Math.max(x1 - x0 - 3, 1), WORDS_H - 2); }
      g.save();
      g.beginPath();
      g.rect(x0 + 2, WORDS_Y, Math.max(x1 - x0 - 4, 0), WORDS_H);
      g.clip();
      g.fillStyle = "#111";
      g.fillText(wd.word, x0 + 4, WORDS_Y + WORDS_H / 2);
      g.restore();
    }
    // Where the song is playing.
    if (!audio.paused || audio.currentTime > 0) {
      g.fillStyle = text;
      g.fillRect(xOf(audio.currentTime), 0, 1.5, HEIGHT);
    }
  }

  // Which word (and which part of it) is under x, y.
  function hit(x, y) {
    if (y < WORDS_Y - 2 || y > WORDS_Y + WORDS_H + 2) return null;
    let best = null;
    for (const wd of words()) {
      const x0 = xOf(wd.start), x1 = xOf(wd.end);
      if (x < x0 - EDGE_PX || x > x1 + EDGE_PX) continue;
      const part = Math.abs(x - x0) <= EDGE_PX && x < (x0 + x1) / 2 ? "start" : Math.abs(x - x1) <= EDGE_PX ? "end"
        : x >= x0 && x <= x1 ? "move" : null;
      if (part && (!best || part !== "move")) best = { ...wd, part };
    }
    return best;
  }

  const point = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = point(e);
    if (!drag) {
      const h = hit(x, y);
      canvas.style.cursor = !h ? "pointer" : h.part === "move" ? "grab" : "ew-resize";
      return;
    }
    const by = tOf(x) - drag.t, { start, end } = drag.word;
    const next = drag.part === "move" ? [start + by, end + by] : drag.part === "start" ? [Math.min(start + by, end - 0.05), end]
      : [start, Math.max(end + by, start + 0.05)];
    setLines(moveWord(drag.lines, drag.word.i, drag.word.k, next[0], next[1], voice, duration), false);
    drag.moved = true;
    draw();
  });
  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = point(e), h = hit(x, y);
    if (!h) {
      // Play from here, or stop.
      if (!audio.paused) audio.pause();
      else { audio.currentTime = Math.max(0, tOf(x)); audio.play(); tick(); }
      draw();
      return;
    }
    picked = { i: h.i, k: h.k };
    drag = { word: h, part: h.part, t: tOf(x), lines: lines(), moved: false };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = h.part === "move" ? "grabbing" : "ew-resize";
    draw();
  });
  const end = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) setLines(lines(), true);
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2);
    else { v0 += ((e.deltaX || e.deltaY) / width()) * span; fit(); draw(); }
  }, { passive: false });
  // While playing, the playhead moves, and the view follows it.
  function tick() {
    cancelAnimationFrame(frame);
    if (audio.paused) { draw(); return; }
    if (audio.currentTime > v0 + span * 0.9 || audio.currentTime < v0) { v0 = audio.currentTime - span * 0.1; fit(); }
    draw();
    frame = requestAnimationFrame(tick);
  }
  audio.addEventListener("play", tick);
  new ResizeObserver(() => draw()).observe(canvas);
  fit();
  return {
    el, draw,
    // Bring line i into view.
    show(i) {
      const l = lines()[i];
      if (!l) return;
      if (l.start < v0 || l.end > v0 + span) { v0 = l.start - Math.min(1, span * 0.1); fit(); }
      draw();
    },
  };
}
