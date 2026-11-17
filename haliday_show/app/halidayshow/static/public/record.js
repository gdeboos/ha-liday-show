// Visitors film the display with their phone's camera. The camera is drawn onto a canvas with a small
// watermark, and the canvas is what's recorded, so flipping between the back and front cameras mid-way
// keeps one video. The soundtrack is the song as this phone hears it (Listen), never the microphone.
// The video stays on the phone: it's never sent anywhere.

export const WATERMARK = "Made with HA-liday Show";
export const MAX_SECONDS = 5 * 60; // long videos fill a phone's memory; stops by itself here
const LONG_SIDE = 1280;

// MP4 where the phone can make it (iPhone, newer Chrome), else WebM.
export const MIME_CHOICES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus", "video/webm"];

export function pickMime(supported) {
  return MIME_CHOICES.find((m) => { try { return supported(m); } catch { return false; } }) || "";
}

export const extOf = (mime) => (String(mime).startsWith("video/mp4") ? "mp4" : "webm");

export function fileName(title, when, mime) {
  const name = String(title || "").normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
    .toLowerCase().slice(0, 40) || "light-show";
  const p = (n) => String(n).padStart(2, "0");
  return `${name}-${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}.${extOf(mime)}`;
}

// The part of a w × h picture that fills a dw × dh frame without stretching (like object-fit: cover).
export function coverRect(w, h, dw, dh) {
  if (!(w > 0 && h > 0 && dw > 0 && dh > 0)) return { sx: 0, sy: 0, sw: w || 0, sh: h || 0 };
  const scale = Math.max(dw / w, dh / h);
  const sw = dw / scale, sh = dh / scale;
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
}

// The recording's size: the camera's own shape, its long side at most 1280.
export function frameSize(w, h) {
  if (!(w > 0 && h > 0)) return { w: 720, h: 1280 };
  const k = Math.min(1, LONG_SIDE / Math.max(w, h));
  return { w: Math.round(w * k / 2) * 2, h: Math.round(h * k / 2) * 2 };
}

export const recClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function canRecord(win = globalThis) {
  return !!(win.isSecureContext && win.MediaRecorder && win.navigator?.mediaDevices?.getUserMedia
    && win.HTMLCanvasElement?.prototype?.captureStream);
}

// The camera, the canvas and the recording. song() gives the playing <audio> to record from, or null.
export function makeRecorder({ canvas, cam, song, onChange }) {
  const ctx2d = canvas.getContext("2d");
  let facing = "environment", stream = null, frame = 0, rec = null, chunks = [], started = 0, timer = 0;
  let audioCtx = null, songSource = null, songOut = null, mime = "", gen = 0;
  const me = { open: false, recording: false, seconds: 0, withSong: false, error: "", blob: null, mime: "" };
  const changed = () => onChange?.(me);

  function draw() {
    frame = requestAnimationFrame(draw);
    const vw = cam.videoWidth, vh = cam.videoHeight;
    if (!vw || !vh) return;
    if (!canvas.width) Object.assign(canvas, (({ w, h }) => ({ width: w, height: h }))(frameSize(vw, vh)));
    const W = canvas.width, H = canvas.height;
    const r = coverRect(vw, vh, W, H);
    ctx2d.drawImage(cam, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
    const size = Math.round(Math.max(W, H) * 0.022);
    ctx2d.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx2d.textAlign = "right";
    ctx2d.textBaseline = "bottom";
    ctx2d.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx2d.shadowBlur = size * 0.4;
    ctx2d.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx2d.fillText(WATERMARK, W - size, H - size);
    ctx2d.shadowBlur = 0;
  }

  async function camera() {
    const mine = ++gen;
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    if (mine !== gen || !me.open) { next.getTracks().forEach((t) => t.stop()); return; }
    stream?.getTracks().forEach((t) => t.stop());
    stream = next;
    cam.srcObject = stream;
    await cam.play().catch(() => {});
  }

  async function open() {
    Object.assign(me, { open: true, error: "", blob: null });
    canvas.width = 0;
    changed();
    try {
      await camera();
      cancelAnimationFrame(frame);
      draw();
    } catch (e) {
      me.error = e?.name === "NotAllowedError" ? "denied" : "camera";
      changed();
    }
  }

  async function flip() {
    facing = facing === "environment" ? "user" : "environment";
    try { await camera(); } catch { facing = facing === "environment" ? "user" : "environment"; }
  }

  // The song as this phone plays it, for the video. Where the browser can copy an element's sound
  // (captureStream: Chrome, Android, Edge) that's used, as it leaves what you hear alone. Elsewhere
  // (Safari, Firefox) the song is routed through Web Audio, to the speaker and to the video; an element
  // can only be routed once, so that route is kept for the visit.
  function songTrack() {
    const el = song?.();
    if (!el || el.paused) return null;
    if (typeof el.captureStream === "function") {
      try {
        const track = el.captureStream().getAudioTracks()[0];
        if (track) return track;
      } catch { /* fall back to Web Audio */ }
    }
    try {
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (!songSource) {
        songSource = audioCtx.createMediaElementSource(el);
        songSource.connect(audioCtx.destination);
        songOut = audioCtx.createMediaStreamDestination();
        songSource.connect(songOut);
      }
      if (audioCtx.state !== "running") audioCtx.resume?.().catch(() => {});
      return songOut.stream.getAudioTracks()[0] || null;
    } catch {
      return null;
    }
  }

  function start() {
    if (me.recording || !canvas.width) return;
    mime = pickMime((m) => MediaRecorder.isTypeSupported(m));
    const out = canvas.captureStream(30);
    const audio = songTrack();
    if (audio) out.addTrack(audio);
    me.withSong = !!audio;
    chunks = [];
    rec = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 6_000_000 });
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = () => {
      out.getVideoTracks().forEach((t) => t.stop());
      clearInterval(timer);
      const type = rec.mimeType || mime || "video/webm";
      Object.assign(me, { recording: false, blob: chunks.length ? new Blob(chunks, { type }) : null, mime: type });
      chunks = [];
      changed();
    };
    rec.start(1000);
    started = performance.now();
    Object.assign(me, { recording: true, seconds: 0, blob: null });
    timer = setInterval(() => {
      me.seconds = (performance.now() - started) / 1000;
      if (me.seconds >= MAX_SECONDS) stop();
      changed();
    }, 250);
    changed();
  }

  function stop() {
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function close() {
    gen++;
    if (rec && rec.state !== "inactive") { rec.onstop = null; rec.stop(); }
    clearInterval(timer);
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    cam.srcObject = null;
    Object.assign(me, { open: false, recording: false, seconds: 0, blob: null });
    changed();
  }

  // Back to the camera after a video, to make another.
  function again() {
    Object.assign(me, { blob: null, seconds: 0 });
    changed();
  }

  return { get state() { return me; }, open, flip, start, stop, again, close };
}
