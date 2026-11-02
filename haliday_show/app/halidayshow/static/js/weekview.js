// The Schedule tab's week view: what plays when over seven days (schedule.py's week()), laid out as a
// row per day along one time axis. Each stretch sits on the day it starts, so one running past midnight
// runs past the axis's 24:00. Positions are percentages, so the page only has to draw them.

import { DAYS, MONTHS } from "./schedule.js";

// "2026-11-07T17:30" as hours after the start of `day` ("2026-11-07"): 17.5, or 25 for 01:00 the next day.
function hoursFrom(day, iso) {
  const [d, t] = iso.split("T");
  const days = (Date.parse(`${d}T00:00Z`) - Date.parse(`${day}T00:00Z`)) / 86400000;
  const [h, m] = t.split(":").map(Number);
  return days * 24 + h + m / 60;
}

const clock = (iso) => iso.split("T")[1].slice(0, 5);
const span = ([a, b]) => `${clock(a)}–${clock(b)}`;

// week: {days, slots} from /api/schedule/week; nameOf(entry id) -> what that row plays; today: "YYYY-MM-DD".
export function weekLayout(week, nameOf, today) {
  const at = week.slots.map((s) => [hoursFrom(s.day, s.start), hoursFrom(s.day, s.end)]);
  let from = at.length ? Math.floor(Math.min(...at.map((x) => x[0]))) : 16;
  let to = at.length ? Math.ceil(Math.max(...at.map((x) => x[1]))) : 24;
  if (to - from < 4) { from = Math.max(0, Math.min(from, to - 4)); to = from + Math.max(4, to - from); }
  const pc = (h) => ((h - from) / (to - from)) * 100;
  const ticks = [];
  for (let h = Math.ceil(from / 2) * 2; h < to; h += 2) ticks.push({ left: pc(h), label: `${String(h % 24).padStart(2, "0")}:00` });
  const days = week.days.map((day) => {
    const date = new Date(`${day}T00:00Z`);
    const bars = week.slots.map((s, k) => [s, at[k]]).filter(([s]) => s.day === day).map(([s, [a, b]]) => {
      const inside = (part) => {
        const pa = hoursFrom(day, part[0]), pb = hoursFrom(day, part[1]);
        return { left: ((pa - a) / (b - a)) * 100, width: ((pb - pa) / (b - a)) * 100 };
      };
      const notes = [];
      if (s.covered.length) notes.push(`a row higher up plays ${s.covered.map(span).join(", ")}`);
      if (s.waits?.length) notes.push(`waits while a playlist or show plays ${s.waits.map(span).join(", ")}`);
      return { entry: s.entry, lane: s.lane, left: pc(a), width: pc(b) - pc(a), name: nameOf(s.entry),
        covered: s.covered.map(inside), waits: (s.waits || []).map(inside),
        title: [`${nameOf(s.entry)} · ${clock(s.start)}–${clock(s.end)}`, ...notes].join(" · ") };
    });
    return { day, today: day === today, bars,
      label: `${DAYS[(date.getUTCDay() + 6) % 7]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` };
  });
  return { from, to, ticks, days };
}
