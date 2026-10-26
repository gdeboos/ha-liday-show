// Big uploads. Home Assistant's ingress proxy turns away any request over 16 MB, so a bigger song,
// or a long show's baked frames, goes up in pieces that HA-liday Show joins back together
// (server.py _receive_part).

export const PART = 8 * 1024 * 1024;

// The pieces of a file of `size` bytes: [{start, end, done}].
export function parts(size, part = PART) {
  const out = [];
  for (let start = 0; start < size || !out.length; start += part) {
    const end = Math.min(size, start + part);
    out.push({ start, end, done: end >= size });
  }
  return out;
}

// Uploads `file` (a File or Blob) as `name` and returns where it was saved, {source, path}.
// api(path, opts) is the editor's fetch helper; progress(fraction) is called as pieces go up.
export async function uploadSong(api, file, name = file.name, progress = () => {}) {
  if (file.size <= PART) {
    const form = new FormData();
    form.append("file", file, name);
    const ref = await api("api/audio", { method: "POST", body: form });
    progress(1);
    return ref;
  }
  return sendParts(api, "api/audio/part", file, { name }, progress);
}

// Sends `blob` to `url` in pieces; `last` is added to the last piece's query (a song's name, say).
// Returns what the last piece's answer says.
export async function sendParts(api, url, blob, last = {}, progress = () => {}) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  let reply = null;
  for (const p of parts(blob.size)) {
    const q = new URLSearchParams({ upload: id, offset: String(p.start) });
    if (p.done) { q.set("done", "1"); for (const [k, v] of Object.entries(last)) q.set(k, v); }
    reply = await api(`${url}?${q}`, {
      method: "POST", body: blob.slice(p.start, p.end), headers: { "Content-Type": "application/octet-stream" },
    });
    progress(p.end / blob.size);
  }
  return reply;
}
