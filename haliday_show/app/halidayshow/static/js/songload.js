// Fetching a song to decode, and saying in plain words why it didn't load (the browser's own
// "Unable to decode audio data" tells the user nothing they can act on).

export class SongMissing extends Error {}
export class SongServerError extends Error {}

// Whether an error is the connection dropping, rather than an answer: the browser's "Failed to fetch"
// (Wi-Fi blipped, the computer woke from sleep) or Home Assistant saying the app's away for a moment
// (restarting after an update).
export const lostTouch = (err) => (err instanceof TypeError && /fetch|load failed|network/i.test(err.message))
  || [502, 503, 504].includes(err?.status);

// fn() again after a short wait each time the connection drops, up to `waits.length` more times (about
// a minute in all: long enough for the app to restart after an update).
export async function retrying(fn, { waits = [2000, 5000, 15000, 30000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!lostTouch(e) || i >= waits.length) throw e;
      await sleep(waits[i]);
    }
  }
}

// What to say for an error that may just be the connection dropping.
export const plainError = (err) => (lostTouch(err)
  ? "lost touch with HA-liday Show (it may have been restarting, or the connection dropped). Try again"
  : err?.message || String(err));

export async function fetchSong(url, get = fetch, retry = {}) {
  const res = await retrying(async () => {
    const r = await get(url);
    if ([502, 503, 504].includes(r.status)) throw Object.assign(new SongServerError(`HTTP ${r.status}`), { status: r.status });
    return r;
  }, retry);
  if (res.status === 404) throw new SongMissing("not found");
  if (!res.ok) throw new SongServerError(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

export function songLoadMessage(err) {
  if (err instanceof SongMissing) return "Couldn't load the song: the file has gone from your songs folder. Pick it again under Song.";
  if (err?.name === "EncodingError") return "Couldn't load the song: this browser can't play that file. Try it as an MP3 or WAV.";
  return "Couldn't load the song: HA-liday Show didn't answer. Check it's running, then pick the song again.";
}
