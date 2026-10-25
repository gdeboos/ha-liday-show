"""Playlists that play by themselves at set times.

A playlist's schedule: {"on", "start": "HH:MM", "end": "HH:MM", "days": [0-6, Monday first],
"from": "MM-DD", "to": "MM-DD"}. The dates are optional and come round every year; "from" after "to"
wraps over New Year (1 Dec to 6 Jan). An end before the start runs past midnight, counted as part of
the day it started. Times are HA-liday Show's own clock (the TZ setting Home Assistant gives apps).

At the start time the scheduler starts the playlist, even over something else playing; at the end
time the show that's on finishes and the playlist stops. If you stop it or play something else in
the meantime, it leaves it be until the next start. Only one playlist plays at a time: where times
overlap, the one higher in the list goes first, and another starts once it's done. After a restart
during the scheduled time, or turning a schedule on during its time, the playlist starts straight
away; changing the times during it just moves its end. Times are the local clock as written, so on the
night the clocks change a stretch over 01:00-02:00 runs an hour longer or shorter.
"""
import asyncio
import logging
from datetime import date, datetime, timedelta

from . import playlists
from .runner import Runner, RunnerError
from .storage import Storage

log = logging.getLogger(__name__)

TICK_S = 15
def _in_dates(s: dict, d: date) -> bool:
    if not s["from"]:
        return True
    md = f"{d.month:02d}-{d.day:02d}"
    return s["from"] <= md <= s["to"] if s["from"] <= s["to"] else md >= s["from"] or md <= s["to"]


def _window(s: dict, d: date) -> tuple[datetime, datetime] | None:
    """The window that starts on day d, if the schedule plays that day."""
    if d.weekday() not in s["days"] or not _in_dates(s, d):
        return None
    start = datetime.combine(d, datetime.strptime(s["start"], "%H:%M").time())
    end = datetime.combine(d, datetime.strptime(s["end"], "%H:%M").time())
    if end <= start:
        end += timedelta(days=1)
    return start, end


def window_at(s: dict, now: datetime) -> tuple[datetime, datetime] | None:
    """The scheduled stretch going on at `now`, if any (yesterday's can run past midnight)."""
    if not s.get("on"):
        return None
    for d in (now.date(), now.date() - timedelta(days=1)):
        w = _window(s, d)
        if w and w[0] <= now < w[1]:
            return w
    return None


def next_start(s: dict, now: datetime) -> datetime | None:
    """When it next starts, or None if it's off or never plays."""
    if not s.get("on"):
        return None
    for k in range(367):
        w = _window(s, now.date() + timedelta(days=k))
        if w and w[0] > now:
            return w[0]
    return None


class Scheduler:
    def __init__(self, storage: Storage, runner: Runner):
        self.storage, self.runner = storage, runner
        # Each evening's run is known by the day it started, so changing the times during it moves its
        # end (or ends it) rather than counting as a new run.
        self.handled: dict[str, date] = {}  # playlist id -> the day whose run was already dealt with
        self.running: tuple[str, date] | None = None  # the playlist it started, and that run's day

    def state(self, now: datetime | None = None) -> dict:
        now = now or datetime.now()
        nexts = {}
        for p in playlists.load(self.storage):
            if (n := next_start(p.get("schedule") or {}, now)):
                nexts[p["id"]] = n.isoformat(timespec="minutes")
        return {"now": now.isoformat(timespec="minutes"), "next": nexts,
                "scheduled": self.running[0] if self.running else None}

    async def tick(self, now: datetime | None = None):
        now = now or datetime.now()
        found = playlists.load(self.storage)
        windows = {p["id"]: w for p in found if (w := window_at(p.get("schedule") or {}, now))}
        playing = (self.runner.playlist or {}).get("id")
        if self.running:
            pid, day = self.running
            if playing != pid:
                # Stopped, or something else put on: leave every current stretch alone until next time.
                self.running = None
                for other, w in windows.items():
                    self.handled[other] = w[0].date()
            elif pid not in windows or windows[pid][0].date() != day:
                log.info("schedule: %s's time is up; finishing the show that's on", pid)
                self.running = None
                await self.runner.finish_playlist()
        if self.running or self.runner.finishing:  # let the last show end before the next playlist
            return
        for p in found:
            w = windows.get(p["id"])
            if not w or self.handled.get(p["id"]) == w[0].date():
                continue
            self.handled[p["id"]] = w[0].date()
            if playing == p["id"]:  # already put on by hand: carry on, and stop it at the end time
                self.running = (p["id"], w[0].date())
                return
            try:
                await self.runner.play_playlist(p)
            except RunnerError as e:
                log.warning("schedule: couldn't start %s: %s", p["name"], e)
                continue
            log.info("schedule: started %s until %s", p["name"], w[1].strftime("%H:%M"))
            self.running = (p["id"], w[0].date())
            return

    async def run(self):
        while True:
            try:
                await self.tick()
            except Exception:  # keep the schedule going whatever one tick hits
                log.exception("schedule tick failed")
            await asyncio.sleep(TICK_S)
