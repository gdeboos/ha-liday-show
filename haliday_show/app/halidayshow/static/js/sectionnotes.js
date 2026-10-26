// Notes for a song's sections, written from what was measured in each (analysis.js measureSections),
// so Generate's AI option and Describe it know what happens where. Never over notes or names you
// wrote: a section's notes are written
// only when it has none or the last ones were written for you ("autoNotes"), and only names Detect
// gave are changed (a name you type marks the section "named").

import { fmtTime } from "./timeline.js";

// The names Detect gives, which a description may replace with better ones.
const AUTO_NAME = /^(Part [A-Z]|Song|Intro|Outro|Chorus|Verse|Bridge)$/;
export const autoNamed = (sec) => !sec.named && AUTO_NAME.test(sec.label || "");

// Can this section's notes be (re)written for you?
export const notesFree = (sec) => !sec.notes || !!sec.autoNotes;

const at = (t) => fmtTime(Math.round(t), false);

// A section's note in plain words: what it sounds like, then how to light it.
export function ruleNote(trait, sec, sections) {
  const level = trait.alone ? "" : trait.level < 0.35 ? "Quiet" : trait.level < 0.7 ? "Medium" : "Loud";
  const sound = level ? [level] : [];
  if (trait.busy === "busy") sound.push("busy, lots of hits");
  else if (trait.busy === "sparse") sound.push("sparse");
  if (trait.tone === "bass") sound.push("bass-heavy");
  else if (trait.tone === "bright") sound.push("bright and tinkly");
  const said = sound.join(", ");
  const parts = said ? [said[0].toUpperCase() + said.slice(1)] : [];
  if (trait.shape === "builds") parts.push("builds up through it");
  else if (trait.shape === "fades") parts.push("fades away");
  for (const t of trait.hits) parts.push(`big hit at ${at(t)}`);
  for (const t of trait.drops) parts.push(`goes quiet at ${at(t)}`);
  const earlier = sections.find((s) => s !== sec && s.start < sec.start && s.label === sec.label);
  if (earlier) parts.push(`like the ${sec.label} at ${at(earlier.start)}`);
  const light = [trait.level < 0.35 ? "Keep it gentle: slow fades or a soft glow on a few lights"
    : trait.level < 0.7 ? "Steady movement on the beat on some of the lights"
      : "Everything on, moving and flashing on the beat"];
  if (trait.shape === "builds") light.push("add lights as it builds");
  if (trait.shape === "fades") light.push("let lights drop out as it fades");
  if (trait.hits.length) light.push("flash everything on the hit");
  if (trait.drops.length) light.push("go dark or very dim when it drops");
  return `${parts.length ? `${parts.join("; ")}. ` : ""}${light.join("; ")}.`.slice(0, 300);
}

// Sections with notes written where they're free (by `write(trait, sec, sections)`, the rules by
// default) and, for automatic names, any better ones `names` (index -> name) gives.
// After Detect finds sections afresh: names and notes you wrote on the old sections carry over to
// the new section that covers most of each old one (and its "named" and own-notes marks with them).
export function keepYours(fresh, old = []) {
  const out = fresh.map((s) => ({ ...s }));
  for (const o of old) {
    const yourNotes = o.notes && !o.autoNotes, yourName = !!o.named;
    if (!yourNotes && !yourName) continue;
    const overlap = (s) => Math.min(s.end, o.end) - Math.max(s.start, o.start);
    const best = out.reduce((b, s) => (overlap(s) > (b ? overlap(b) : 0) ? s : b), null);
    if (!best || overlap(best) < (o.end - o.start) / 2) continue;
    if (yourName && !best.named) Object.assign(best, { label: o.label, named: true });
    if (yourNotes && !(best.notes && !best.autoNotes)) {
      best.notes = o.notes;
      delete best.autoNotes;
    }
  }
  return out;
}

export function describeSections(sections, traits, { write = ruleNote, names = {} } = {}) {
  return sections.map((sec, i) => {
    let out = sec;
    if (names[i] && autoNamed(sec)) out = { ...out, label: String(names[i]).slice(0, 40) };
    if (traits[i] && notesFree(sec)) {
      const notes = String(write(traits[i], out, sections, i) || "").trim().slice(0, 300);
      if (notes) out = { ...out, notes, autoNotes: true };
    }
    return out;
  });
}

// What the AI is told: the song's name (it may know the song), and for each section its time, name,
// what was measured, and the notes you wrote (to leave alone, and for context). It writes notes only
// for "write" sections and names only for "rename" ones.
export function aiRequest(sections, traits, song) {
  const r1 = (t) => Math.round(t * 10) / 10;
  return {
    request: "Write notes for this song's sections: what each part is like and how to light it.",
    context: {
      song: { name: song.name || "", duration: r1(song.duration || sections[sections.length - 1]?.end || 0), tempo: song.tempo || null },
      sections: sections.map((sec, i) => {
        const t = traits[i] || {};
        return {
          index: i, start: r1(sec.start), end: r1(sec.end), name: sec.label,
          write: notesFree(sec), rename: autoNamed(sec),
          ...(notesFree(sec) ? {} : { your_notes: sec.notes }),
          measured: {
            ...(t.alone ? {} : { loudness: t.level }), shape: t.shape, busy: t.busy, tone: t.tone,
            big_hits: (t.hits || []).map(r1), goes_quiet: (t.drops || []).map(r1),
          },
        };
      }),
    },
  };
}

// The AI's reply checked: notes (up to 300 characters) only for sections it may write, names (up to
// 40) only for sections it may rename. Returns {notes: {index: text}, names: {index: name}}.
export function fromAI(reply, sections) {
  const notes = {}, names = {};
  for (const r of Array.isArray(reply?.sections) ? reply.sections : []) {
    // A real index only: Number(null), Number("") and Number(false) are all 0.
    const raw = r?.index;
    if (!(typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw)))) continue;
    const i = Number(raw), sec = sections[i];
    if (!Number.isInteger(i) || !sec) continue;
    const note = String(r.notes ?? "").trim().slice(0, 300);
    const name = String(r.name ?? "").trim().slice(0, 40);
    if (note && notesFree(sec)) notes[i] = note;
    if (name && autoNamed(sec) && name !== sec.label) names[i] = name;
  }
  return { notes, names };
}

// Sections described with the AI's notes and names, and the rules for any section it skipped:
// {sections, used}, used counting the AI's notes and names kept (0: its reply was no use).
export function describeWithAI(sections, traits, reply) {
  const { notes, names } = fromAI(reply, sections);
  const used = Object.keys(notes).length + Object.keys(names).length;
  return { used, sections: describeSections(sections, traits, {
    names, write: (t, sec, all, i) => notes[i] ?? ruleNote(t, sec, all),
  }) };
}
