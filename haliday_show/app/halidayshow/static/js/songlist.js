// Library → Songs: every song in your songs folder, whether Detect has been run on it, and which shows
// use it. Worked out here without the page, so it can be tested; app.js draws the rows.

export const songKey = (ref) => `${ref.source}:${ref.path}`;

const base = (path) => path.split("/").pop();
const title = (path) => base(path).replace(/\.[^.]+$/, "");
const folder = (path) => path.split("/").slice(0, -1).join("/");

// songs as /api/songs lists them; shows as /api/shows does (each with its song's path). Sorted by
// name, each row says what Detect found and which shows use it.
export function songRows(songs, shows) {
  const users = new Map();
  for (const s of shows) if (s.song) users.set(s.song, [...(users.get(s.song) || []), s.name]);
  return [...songs]
    .sort((a, b) => title(a.path).localeCompare(title(b.path), undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path))
    .map((s) => {
      const usedBy = (users.get(s.path) || []).sort((a, b) => a.localeCompare(b));
      const found = s.detected
        ? [s.tempo ? `${Math.round(s.tempo)} BPM` : "no steady beat",
          `${s.sections} section${s.sections === 1 ? "" : "s"}`].join(", ")
        : "not detected yet";
      return {
        key: songKey(s), ref: { source: s.source, path: s.path }, size: s.size, modified: s.modified,
        name: title(s.path), file: base(s.path), folder: folder(s.path),
        detected: !!s.detected, found, usedBy,
        uses: usedBy.length ? `Used by ${usedBy.join(", ")}` : "Not used by any show",
      };
    });
}

// Rows whose name, folder or show names contain every word typed.
export function filterRows(rows, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const text = `${r.file} ${r.folder} ${r.usedBy.join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
