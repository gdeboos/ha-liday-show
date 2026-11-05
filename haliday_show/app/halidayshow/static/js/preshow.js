// The pre-show check's sums and words (Setup → Devices → Pre-show check). The server does the checks
// that need nobody looking (preshow.py); you then look at each light. Pure, so it can be tested in node.

export const LEVELS = ["ok", "info", "warn", "fail"]; // worst last

export const worst = (levels) => levels.reduce((w, l) => (LEVELS.indexOf(l) > LEVELS.indexOf(w) ? l : w), "ok");

const join = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

// The lines for what you saw: `seen` is {name, answer: "yes" | "no" | "skip"} for each light flashed.
export function lookLines(seen) {
  const of = (a) => seen.filter((s) => s.answer === a).map((s) => s.name);
  const out = [];
  const yes = of("yes"), no = of("no"), skip = of("skip");
  if (yes.length) out.push({ level: "ok", text: `You saw ${join(yes)} blink.` });
  for (const name of no) {
    out.push({ level: "fail", text: `You didn't see ${name} blink properly.`,
      fix: "Check it's plugged in. If only part of it lit, press Check segments in its window under Setup → Devices to see which part works." });
  }
  if (skip.length) out.push({ level: "warn", text: `${join(skip)} ${skip.length === 1 ? "wasn't" : "weren't"} looked at.`, fix: "Run the check again when you can see them." });
  return out;
}

// Every line the check ends with, by group: the server's, then what you saw added to the lights.
// The "How shows start tonight" line only counts on its own when there's nothing under it.
// Problems first, as the server lists them.
const ORDER = ["fail", "warn", "ok", "info"];
export function finalGroups(groups, seen) {
  return groups.map((g) => (g.key !== "lights" ? g : { ...g,
    items: [...g.items, ...lookLines(seen)].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level)) }));
}

export function tally(groups) {
  const lines = groups.flatMap((g) => (g.summary && !g.items.length ? [g.summary] : g.items));
  const count = (l) => lines.filter((x) => x.level === l).length;
  return { level: worst(lines.map((x) => x.level)), problems: count("fail"), warnings: count("warn") };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The headline once it's done.
export function headline({ level, problems, warnings }) {
  if (level === "fail") return `${plural(problems, "problem")} to fix before the show`;
  if (level === "warn") return `Ready, with ${plural(warnings, "thing")} to look at`;
  return "All good for tonight";
}

// When it was, in words: "today at 10:05", "tonight at 18:40", "yesterday at 18:40", "on Monday at
// 18:40", or the date if it's more than a week ago.
export function when(iso, now = new Date()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(at)) / 86400000);
  if (days === 0) return `${at.getHours() >= 17 ? "tonight" : "today"} at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  if (days > 1 && days < 7) return `on ${at.toLocaleDateString("en-GB", { weekday: "long" })} at ${time}`;
  return `on ${at.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
}

// Setup's line under the button: what the last check found, and when.
export function lastText(last, now = new Date()) {
  if (!last?.at) return "Not run yet. It checks every light, how tonight's shows start, and the sound.";
  const found = last.level === "fail" ? plural(last.problems, "problem")
    : last.level === "warn" ? plural(last.warnings, "thing") + " to look at" : "all good";
  return `Last checked ${when(last.at, now)}: ${found}.`;
}
