// Words for a playlist's schedule. Times are HA-liday Show's clock, sent as "YYYY-MM-DDTHH:MM" with
// no time zone, so they're compared as written rather than in this browser's time zone.

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const DEFAULT_SCHEDULE = { on: true, start: "17:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6], from: "", to: "" };

const parts = (iso) => {
  const [d, t] = iso.split("T");
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day, time: t.slice(0, 5) };
};
const dayNumber = ({ y, m, day }) => Date.UTC(y, m - 1, day) / 86400000;
const weekday = (p) => DAYS[(new Date(Date.UTC(p.y, p.m - 1, p.day)).getUTCDay() + 6) % 7];

// "today at 17:00", "tomorrow at 17:00", or "on Sat 31 Oct at 17:00".
export function whenNext(nextIso, nowIso) {
  const n = parts(nextIso), now = parts(nowIso);
  const ahead = dayNumber(n) - dayNumber(now);
  const day = ahead === 0 ? "today" : ahead === 1 ? "tomorrow" : `on ${weekday(n)} ${n.day} ${MONTHS[n.m - 1]}`;
  return `${day} at ${n.time}`;
}

// "sunset", "20 minutes after sunset", "1 hour before sunset".
export function describeStart(s) {
  if (s.start !== "sunset") return s.start;
  const m = Math.abs(s.offset || 0);
  if (!m) return "sunset";
  const amount = m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minute${m === 1 ? "" : "s"}`;
  return `${amount} ${s.offset < 0 ? "before" : "after"} sunset`;
}

// "17:00 to 22:00 every day", "20:00 to 01:00 (the next day) on Fri and Sat, 25 Oct to 31 Oct",
// "sunset to 22:00 every day".
export function describeSchedule(s) {
  const days = s.days.length === 7 ? "every day"
    : s.days.length === 5 && [0, 1, 2, 3, 4].every((d) => s.days.includes(d)) ? "on weekdays"
      : s.days.length === 2 && s.days.includes(5) && s.days.includes(6) ? "at weekends"
        : s.days.length ? `on ${s.days.map((d) => DAYS[d]).join(", ").replace(/, ([^,]*)$/, " and $1")}` : "on no days";
  const late = s.start !== "sunset" && s.end <= s.start ? " (the next day)" : "";
  const md = (x) => `${Number(x.slice(3))} ${MONTHS[Number(x.slice(0, 2)) - 1]}`;
  const dates = s.from ? `, ${md(s.from)} to ${md(s.to)}` : "";
  return `${describeStart(s)} to ${s.end}${late} ${days}${dates}`;
}

export { MONTHS };
