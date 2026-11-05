// Show health (the pre-show check's Shows, and Library → Shows → Check all shows): what in a saved
// show won't play the way you'd expect, worked out without opening it. Nothing is changed for you.
// Pure, so it can be tested in node: how each track's clips fit, and whether the bake is up to date,
// come in from the editor.

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// One show's problems: [{level, text, fix, resave?}]. `track(t)` says what a track plays on:
// {kind: "light" | "house" | "group" | "missing", name}. `fit(clip, t)` gives {level: "ok" | "limited" |
// "no", reasons} (a promise, as fits are worked out a few at a time). `ready` is false for a show with
// no frames saved, `current` false for one saved before your lights, groups or tracing changed.
export async function showProblems(show, { track, fit, ready = true, current = true }) {
  const out = [];
  if (!ready || !current) {
    out.push({ level: "warn", resave: true,
      text: ready ? "Saved before a change to your lights, groups or house tracing, so it plays as it was then."
        : "Not ready to play yet: its frames haven't been saved.",
      fix: "Press Fix to save it again as things are now." });
  }
  for (const t of show.tracks || []) {
    const clips = t.clips || [];
    if (!clips.length) continue;
    const what = track(t);
    if (what.kind === "group") continue; // a group lane fits whatever its lights are
    if (what.kind === "missing") {
      out.push({ level: "warn", text: `${plural(clips.length, "effect")} on a light you've removed, so ${clips.length === 1 ? "it doesn't" : "they don't"} play.`,
        fix: "Open the show and remove that track, or add the light back under Setup → Devices." });
      continue;
    }
    const fits = await Promise.all(clips.map((c) => fit(c, t)));
    const no = fits.filter((f) => f.level === "no"), part = fits.filter((f) => f.level === "limited");
    const on = what.kind === "house" ? "the House lane" : what.name;
    if (no.length) {
      out.push({ level: "fail", text: `${plural(no.length, "clip")} won't show on ${on}. ${no[0].reasons[0] || ""}`.trim(),
        fix: "Open the show: they're hatched red on the timeline. Change their effect, or move them to another light." });
    }
    if (part.length) {
      out.push({ level: "warn", text: `${plural(part.length, "clip")} only partly show${part.length === 1 ? "s" : ""} on ${on}. ${part[0].reasons[0] || ""}`.trim(),
        fix: "Open the show to see them: they have an orange corner on the timeline." });
    }
  }
  return out;
}

// The lines for a list of shows: one "fine" line for all the shows with nothing wrong, then each
// problem, named after its show and carrying its id (for Open and Fix).
export function healthLines(results) {
  const fine = results.filter((r) => !r.problems.length);
  const out = [];
  for (const r of results) {
    for (const p of r.problems) out.push({ ...p, text: `${r.name}: ${p.text}`, show: r.id, name: r.name });
  }
  const order = ["fail", "warn", "ok", "info"];
  out.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  if (fine.length) {
    out.push({ level: "ok", text: fine.length === results.length
      ? (results.length === 1 ? `${fine[0].name} is fine.` : `All ${results.length} shows are fine.`)
      : `${fine.length === 1 ? fine[0].name : plural(fine.length, "other show")} ${fine.length === 1 ? "is" : "are"} fine.` });
  }
  if (!results.length) out.push({ level: "info", text: "No shows to check." });
  return out;
}
