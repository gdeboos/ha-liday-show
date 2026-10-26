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
        detected: !!s.detected, own: !!s.own, found, usedBy,
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

// Older edits, made before drafts, are named after their song: "carol (edit)", "carol (edit 2)".
const OLD_EDIT = /^(.*) \(edit(?: \d+)?\)$/;

// The rows grouped into families: each original song with the edits made from it (song files a draft
// made, or older "… (edit)" files) and its drafts with no file yet. An edit of an edit belongs to the
// first song. Drafts whose song has gone are left out (app.js lists them on their own).
export function songFamilies(rows, drafts) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const draftOf = new Map(); // a made file's key -> the draft that made it (the latest, if several)
  for (const d of drafts) {
    if (!d.made || !d.base) continue;
    const k = songKey(d.made), seen = draftOf.get(k);
    if (!seen || (d.modified || 0) > (seen.modified || 0)) draftOf.set(k, d);
  }
  const parentOf = (r) => {
    const d = draftOf.get(r.key);
    if (d && byKey.has(songKey(d.base)) && songKey(d.base) !== r.key) return byKey.get(songKey(d.base));
    const m = OLD_EDIT.exec(r.name);
    return m ? rows.find((x) => x !== r && x.folder === r.folder && x.name === m[1]) || null : null;
  };
  const rootOf = (r) => {
    const seen = new Set([r]);
    for (let p = parentOf(r); p && !seen.has(p); p = parentOf(p)) { seen.add(p); r = p; }
    return r;
  };
  const families = new Map();
  const family = (r) => {
    if (!families.has(r.key)) families.set(r.key, { original: r, edits: [], drafts: [] });
    return families.get(r.key);
  };
  for (const r of rows) {
    const root = rootOf(r);
    if (root === r) family(r);
    else family(root).edits.push({ row: r, draft: draftOf.get(r.key) || null, short: shortName(r.name, root.name) });
  }
  for (const d of drafts) {
    if (!d.base || !byKey.has(songKey(d.base))) continue;
    if (d.made && byKey.has(songKey(d.made)) && draftOf.get(songKey(d.made)) === d) continue; // shown with its file
    family(rootOf(byKey.get(songKey(d.base)))).drafts.push(d);
  }
  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
  const out = [...families.values()].sort((a, b) => byName(a.original.name, b.original.name));
  for (const f of out) {
    f.edits.sort((a, b) => byName(a.row.name, b.row.name));
    f.drafts.sort((a, b) => byName(a.name, b.name));
  }
  return out;
}

// An edit's name without its song's at the front ("Carol - SHORT" under "Carol" is "SHORT"), unless
// that leaves nothing useful.
export function shortName(name, original) {
  if (!name.toLowerCase().startsWith(original.toLowerCase())) return name;
  const rest = name.slice(original.length).replace(/^[\s_\-|·]+/, "").trim();
  return rest && !rest.startsWith("(") ? rest : name;
}

// Families for a filter ("all", "originals", "edits", "drafts") and the words typed in Find: a family
// shows when any of it matches, with only the parts the filter asks for.
export function filterFamilies(families, show, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text) => words.every((w) => text.toLowerCase().includes(w));
  const rowText = (r) => `${r.file} ${r.folder} ${r.usedBy.join(" ")}`;
  const out = [];
  for (const f of families) {
    const edits = show === "originals" || show === "drafts" ? [] : f.edits;
    const drafts = show === "originals" || show === "edits" ? [] : f.drafts;
    if (show === "edits" && !edits.length) continue;
    if (show === "drafts" && !drafts.length) continue;
    const any = !words.length || hit(rowText(f.original)) || edits.some((e) => hit(rowText(e.row)) || hit(e.draft?.name || ""))
      || drafts.some((d) => hit(d.name));
    if (any) out.push({ ...f, edits, drafts });
  }
  return out;
}

// "3 songs · 2 edits · 1 draft"
export function familyCount(families) {
  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const edits = families.reduce((t, f) => t + f.edits.length, 0), drafts = families.reduce((t, f) => t + f.drafts.length, 0);
  return [n(families.length, "song"), edits && n(edits, "edit"), drafts && n(drafts, "draft")].filter(Boolean).join(" · ");
}
