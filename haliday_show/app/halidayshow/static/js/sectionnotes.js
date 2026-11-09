// Notes for a song's sections, written from what was measured in each (analysis.js measureSections),
// so Generate's AI option and Describe it know what happens where. Never over notes or names you
// wrote: a section's notes are written
// only when it has none or the last ones were written for you ("autoNotes"), and only names Detect
// gave are changed (a name you type marks the section "named").

import { parseLyrics, singingRuns } from "./lyrics.js";
import { SOUNDS, soundsIn } from "./sounds.js";
import { fmtTime } from "./timeline.js";

// The names Detect gives, which a description may replace with better ones.
const AUTO_NAME = /^(Part [A-Z]|Song|Intro|Outro|Chorus|Verse|Bridge)$/;
export const autoNamed = (sec) => !sec.named && AUTO_NAME.test(sec.label || "");

// Can this section's notes be (re)written for you?
export const notesFree = (sec) => !sec.notes || !!sec.autoNotes;

const at = (t) => fmtTime(Math.round(t), false);

const r1 = (t) => Math.round(t * 10) / 10;
const lowerFirst = (s) => s[0].toLowerCase() + s.slice(1);
const listed = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);
const TWINKLY = new Set(["sleighbells", "bells", "mallets", "harp", "piano"]);
const WASHY = new Set(["choir", "strings", "organ"]);
const ONE = { choir: "a ", organ: "an ", piano: "a ", harp: "a ", synth: "a ", guitar: "a " }; // "you can hear a choir"

// What else is known about each section, from what's kept with the song: what can be heard in it
// (sounds.js), the singing (its vocals part's level), the drums (drumhits.js) and the lines sung (its
// lined-up lyrics). One object per section, with only what's known:
// {heard: [sound key], mood: [key], singing: "all"|"some"|"none", singingStarts: [s], singingStops: [s],
//  drums: "in"|"none", drumsStart: s, crashes: [s], lyrics: [line]}.
export function sectionFacts(sections, { sounds = null, voice = null, drums = null, lyrics = null } = {}) {
  const runs = voice?.values?.length ? singingRuns(voice).filter(([a, b]) => b - a >= 1) : null;
  const hits = drums ? [...(drums.kick || []), ...(drums.snare || [])].sort((a, b) => a - b) : null;
  const text = lyrics ? parseLyrics(lyrics.text) : [];
  const lines = lyrics && Array.isArray(lyrics.lines) && lyrics.lines.length === text.length
    ? text.map((l, i) => ({ start: Number(lyrics.lines[i].start) || 0, text: l.text })) : null;
  return sections.map((sec) => {
    const { start, end } = sec, len = end - start, out = {};
    if (sounds) {
      const found = soundsIn(sounds, start, end);
      const heard = found.filter((k) => !SOUNDS[k].mood).slice(0, 3), mood = found.filter((k) => SOUNDS[k].mood).slice(0, 2);
      if (heard.length) out.heard = heard;
      if (mood.length) out.mood = mood;
    }
    if (runs) {
      const inside = runs.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a);
      const sung = inside.reduce((n, [a, b]) => n + b - a, 0) / Math.max(len, 0.001);
      out.singing = sung > 0.85 ? "all" : sung < 0.1 ? "none" : "some";
      if (out.singing === "some") {
        // Only changes well inside the section: one at its very edge is just where it starts or ends.
        const starts = inside.map(([a]) => a).filter((t) => t > start + 1), stops = inside.map(([, b]) => b).filter((t) => t < end - 1);
        if (starts.length) out.singingStarts = starts.slice(0, 3).map(r1);
        if (stops.length) out.singingStops = stops.slice(0, 3).map(r1);
      }
    }
    if (hits) {
      const here = hits.filter((t) => t >= start && t < end);
      if (here.length >= Math.max(2, len / 4)) {
        out.drums = "in";
        const before = hits.some((t) => t >= start - 2 && t < start);
        if (!before && here[0] > start + 2) out.drumsStart = r1(here[0]);
      } else if (len >= 4) out.drums = "none";
      const crashes = (drums.crash || []).filter((t) => t >= start && t < end);
      if (crashes.length) out.crashes = crashes.slice(0, 4).map(r1);
    }
    if (lines) {
      const sung = lines.filter((l) => l.start >= start && l.start < end).map((l) => l.text.slice(0, 80));
      if (sung.length) out.lyrics = sung.slice(0, 3);
    }
    return out;
  });
}

// Traits with each section's facts (sectionFacts) added, for the notes and the AI.
export const withFacts = (traits, facts) => traits.map((t, i) => (t && facts?.[i] && Object.keys(facts[i]).length ? { ...t, facts: facts[i] } : t));

// The facts as words for a note, and the lighting they suggest.
function factWords(f) {
  const said = [], light = [];
  if (!f) return { said, light };
  if (f.heard) said.push(`you can hear ${listed(f.heard.map((k) => (ONE[k] || "") + lowerFirst(SOUNDS[k].label)))}`);
  if (f.mood) said.push(`feels ${listed(f.mood.map((k) => lowerFirst(SOUNDS[k].label)))}`);
  if (f.singing === "all") said.push("singing all through");
  else if (f.singing === "none") said.push("no singing");
  const starts = f.singingStarts || [], stops = f.singingStops || [];
  if (starts.length === 1 && stops.length === 1 && stops[0] > starts[0]) said.push(`singing from ${at(starts[0])} to ${at(stops[0])}`);
  else {
    for (const t of starts) said.push(`singing starts at ${at(t)}`);
    for (const t of stops) said.push(`singing stops at ${at(t)}`);
  }
  if (f.drums === "none") said.push("no drums");
  if (f.drumsStart !== undefined) said.push(`drums come in at ${at(f.drumsStart)}`);
  for (const t of f.crashes || []) said.push(`crash at ${at(t)}`);
  if (f.lyrics) said.push(`sung: "${f.lyrics[0].slice(0, 40)}${f.lyrics[0].length > 40 ? "…" : ""}"`);
  const twinkly = (f.heard || []).find((k) => TWINKLY.has(k)), washy = (f.heard || []).find((k) => WASHY.has(k));
  if (twinkly) light.push(`twinkles for the ${lowerFirst(SOUNDS[twinkly].label)}`);
  if (washy) light.push(`slow washes for the ${lowerFirst(SOUNDS[washy].label)}`);
  if (f.drumsStart !== undefined) light.push("bring everything in when the drums start");
  if (f.singingStops?.length) light.push("drop to a soft glow when the singing stops");
  if (f.crashes?.length) light.push("flash on the crashes");
  return { said, light };
}

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
  // What's known beyond the loudness (sounds, singing, drums, words) comes before the hit times.
  const facts = factWords(trait.facts), first = !parts.length;
  parts.push(...facts.said);
  if (first && parts.length) parts[0] = parts[0][0].toUpperCase() + parts[0].slice(1);
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
  light.push(...facts.light.filter((l) => !(l === "flash on the crashes" && trait.hits.length)));
  // Notes are kept to 300 characters: the smaller details give way first, so the lighting tips fit.
  const note = () => `${parts.length ? `${parts.join("; ")}. ` : ""}${light.join("; ")}.`;
  for (const minor of [/^sung: /, /^crash at /, /^feels /, /^like the /, /^big hit at /, /^goes quiet at /]) {
    for (let k = parts.length - 1; k > 0 && note().length > 300; k--) if (minor.test(parts[k])) parts.splice(k, 1);
  }
  return note().slice(0, 300);
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
// A section's facts (sectionFacts) as the AI is told them, in words it reads without a key.
function aiFacts(f) {
  if (!f) return {};
  const label = (k) => SOUNDS[k].label;
  return {
    ...(f.heard ? { can_hear: f.heard.map(label) } : {}), ...(f.mood ? { mood: f.mood.map(label) } : {}),
    ...(f.singing ? { singing: f.singing } : {}), ...(f.singingStarts ? { singing_starts: f.singingStarts } : {}),
    ...(f.singingStops ? { singing_stops: f.singingStops } : {}), ...(f.drums ? { drums: f.drums } : {}),
    ...(f.drumsStart !== undefined ? { drums_come_in: f.drumsStart } : {}), ...(f.crashes ? { cymbal_crashes: f.crashes } : {}),
    ...(f.lyrics ? { lyrics: f.lyrics } : {}),
  };
}

export function aiRequest(sections, traits, song) {
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
            ...aiFacts(t.facts),
          },
        };
      }),
    },
  };
}

// On your own device (notesworker.js): a small model writes one section at a time, from that section's
// facts in plain words (the rule note) and the shape of the whole song. It only writes notes: its names
// for sections were too often wrong, so renaming is left to Claude or Home Assistant. One item per section
// it may write: {index, messages} (a chat for the model).
const DEVICE_SYSTEM = "You write short notes for someone designing a Christmas or Halloween light show to a song on their "
  + "house. Write plain British English, in one or two short sentences: what this part of the song is like, then how to "
  + "light it. Keep times as m:ss. Only mention instruments, singing or words you are given; never make them up.";
export function devicePrompts(sections, traits, song) {
  const shape = sections.map((sec, i) => {
    const t = traits[i] || {};
    const level = t.alone ? "" : t.level < 0.35 ? "quiet" : t.level < 0.7 ? "medium" : "loud";
    return `${sec.label} ${at(sec.start)}-${at(sec.end)}${level ? ` (${level})` : ""}`;
  }).join("; ");
  const head = `Song: ${song.name || "unknown"}${song.tempo ? `, ${Math.round(song.tempo)} BPM` : ""}.\nIts parts: ${shape}.`;
  const out = [];
  sections.forEach((sec, i) => {
    if (!traits[i] || !notesFree(sec)) return;
    const [facts, ideas = ""] = ruleNote(traits[i], sec, sections).replace(/\.$/, "").split(". ");
    const lines = [head, "", `Write about the part called ${sec.label}, from ${at(sec.start)} to ${at(sec.end)}.`,
      `What was heard in it: ${facts}.`, ...(ideas ? [`Lighting ideas: ${ideas}.`] : []), "",
      "Write in your own words, in one or two sentences under 250 characters: what this part is like, then how to light it. "
        + "Don't copy the lists above.", "", "Reply in exactly this form:",
      "Notes: <your notes>"];
    out.push({ index: i, messages: [{ role: "system", content: DEVICE_SYSTEM }, { role: "user", content: lines.join("\n") }] });
  });
  return out;
}

// The model's answers (one {index, text} per section) as a reply describeWithAI understands. One that
// just copies the lists it was given back is left out (the rules' note stays), and a long one ends at
// the last whole sentence that fits in 300 characters.
export function fromDevice(written) {
  const sections = [];
  for (const { index, text } of written || []) {
    const t = String(text || "");
    // "Notes: …" as asked; small models often leave the label off, so a short answer of whole sentences
    // (no label, no lists) is taken as it is.
    const labelled = /Notes:\s*([\s\S]*)/i.exec(t)?.[1];
    const plain = t.trim().replace(/^[\s"'#*]+/, "");
    const bare = labelled == null && plain.length <= 400 && /[.!]["'”]?$/.test(plain) && !/^[A-Z][a-z]+( [a-z]+)?:/.test(plain) ? plain : "";
    let notes = (labelled ?? bare).split(/\n\s*\n|\n\s*(?:Name|Lighting ideas?):/i)[0];
    notes = notes.replace(/\*\*|__/g, "").replace(/^[\s"'<#*]+|[\s"'>*]+$/g, "").replace(/\s+/g, " ").trim();
    if (!notes || /lighting ideas?:|what was heard/i.test(notes) || (notes.match(/;/g) || []).length >= 3) continue;
    if (notes.length > 300) {
      const cut = notes.slice(0, 300), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
      notes = end > 40 ? cut.slice(0, end + 1) : `${cut.slice(0, 299).replace(/\s+\S*$/, "")}…`;
    }
    sections.push({ index, notes, name: "" });
  }
  return { sections };
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
