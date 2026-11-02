// The Schedule tab's week view: what plays when over seven days (schedule.py's week()), laid out as a
// row per day along one time axis. Each stretch sits on the day it starts, so one running past midnight
// runs past the axis's 24:00. Bars are what really plays (rows take turns, so they never overlap within
// a lane); strips under them mark a row's time spent waiting for another. Positions are percentages.

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
  const times = week.slots.flatMap((s) => [[s.day, s.start], [s.day, s.end], ...(s.plays ? [[s.day, s.plays[1]]] : [])])
    .map(([d, t]) => hoursFrom(d, t));
  let from = times.length ? Math.floor(Math.min(...times)) : 16;
  let to = times.length ? Math.ceil(Math.max(...times)) : 24;
  if (to - from < 4) { from = Math.max(0, Math.min(from, to - 4)); to = from + Math.max(4, to - from); }
  const pc = (h) => ((h - from) / (to - from)) * 100;
  const ticks = [];
  for (let h = Math.ceil(from / 2) * 2; h < to; h += 2) ticks.push({ left: pc(h), label: `${String(h % 24).padStart(2, "0")}:00` });
  const days = week.days.map((day) => {
    const date = new Date(`${day}T00:00Z`);
    const label = `${DAYS[(date.getUTCDay() + 6) % 7]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
    const mine = week.slots.filter((s) => s.day === day);
    const place = ([a, b]) => ({ left: pc(hoursFrom(day, a)), width: pc(hoursFrom(day, b)) - pc(hoursFrom(day, a)) });
    const bars = mine.filter((s) => s.plays).map((s) => {
      const [a, b] = s.plays.map((t) => hoursFrom(day, t));
      const notes = [];
      if (s.covered.length) notes.push(`(its time starts at ${clock(s.start)}; it waits for another row to finish)`);
      const waits = (s.waits || []).map(([x, y]) => {
        const pa = hoursFrom(day, x), pb = hoursFrom(day, y);
        return { left: ((pa - a) / (b - a)) * 100, width: ((pb - pa) / (b - a)) * 100 };
      });
      const parts = [`${nameOf(s.entry)} · ${label} · ${span(s.plays)}${notes.length ? ` ${notes[0]}` : ""}`];
      if (s.waits?.length) parts.push(`waits while a playlist or show plays ${s.waits.map(span).join(", ")}`);
      return { entry: s.entry, lane: s.lane, name: nameOf(s.entry), ...place(s.plays), waits, title: parts.join(" · ") };
    });
    const waiting = mine.flatMap((s) => s.covered.filter(() => !s.plays).map((c) => ({ entry: s.entry, lane: s.lane, ...place(c),
      title: `${nameOf(s.entry)} · ${label} · its time is ${clock(s.start)}–${clock(s.end)}, but another row is still playing, so it doesn't get a turn` }))
      .concat(s.plays ? s.covered.map((c) => ({ entry: s.entry, lane: s.lane, ...place(c),
        title: `${nameOf(s.entry)} · ${label} · waits ${span(c)} for another row to finish` })) : []));
    return { day, today: day === today, label, bars, waiting };
  });
  return { from, to, ticks, days };
}
