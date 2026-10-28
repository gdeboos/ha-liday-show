"""The schedule: entries that play a playlist, a show or a scene by themselves at set times.

Kept in settings as "schedule": a list of entries, highest priority first. Each is
{"id", "play": {"type": "playlist" | "show" | "scene", "id"}} plus its times, as playlists.clean_schedule
checks them: {"on", "start": "HH:MM" or "sunset" (with "offset" minutes after it, or before if
negative), "end": "HH:MM", "days": [0-6, Monday first], "from": "MM-DD", "to": "MM-DD"}. With a sunset
start, a morning end (before 12:00) is the next morning and a day the sun sets after the end is
skipped. Sunset is worked out for the place in settings ("location"), else Home Assistant's; with
neither, a sunset entry doesn't play. The dates are optional and come round every year; "from" after
"to" wraps over New Year (1 Dec to 6 Jan). An end before the start runs past midnight, counted as part
of the day it started. Times are HA-liday Show's own clock (the TZ setting Home Assistant gives apps).

Until 0.2.233 each playlist and scene had one "schedule" of its own. The first time there's no
"schedule" list, one is made from those (playlists in list order, then scenes by name), and the old
fields are left where they are, unused, so an older version still finds them.

Two lanes, as before: playlists and shows in one, scenes in the other. A show entry plays that one
show round and round. At the start time the scheduler starts the playlist (or show), even over
something else playing; at the end time the show that's on finishes and it stops, unless another
entry whose time it now is plays the same thing, which then carries on without a restart. If you stop
it or play something else in the meantime, it leaves it be until the next start. One at a time: where
times overlap, the entry higher in the list goes first, and another starts once it's done. After a
restart during the scheduled time, or turning an entry on during its time, it starts straight away;
changing the times during it just moves its end. A visitor's show from the public page that's playing
at the start time finishes first. An entry whose playlist, show or scene has been deleted is skipped.

A scene entry puts the scene on at its start (or, with a show or playlist on, it waits for it:
runner.want_scene), and off at its end, with the same rules. Times are the local clock as written, so
on the night the clocks change a stretch over 01:00-02:00 runs an hour longer or shorter.
"""
import asyncio
import logging
from datetime import date, datetime, timedelta

from . import playlists
from .ha import HAError
from .runner import Runner, RunnerError
from .storage import Storage, valid_id
from .sun import sunset_local

log = logging.getLogger(__name__)

TICK_S = 15
HA_LOCATION_EVERY_S = 3600
HA_LOCATION_RETRY_S = 60  # Home Assistant may still be starting

Where = tuple[float, float] | None  # latitude and longitude, for sunset


def in_dates(s: dict, d: date) -> bool:
    if not s["from"]:
        return True
    md = f"{d.month:02d}-{d.day:02d}"
    return s["from"] <= md <= s["to"] if s["from"] <= s["to"] else md >= s["from"] or md <= s["to"]


def start_on(s: dict, d: date, where: Where) -> datetime | None:
    """When the schedule starts on day d: its time, or sunset plus its offset (None without a place,
    or where the sun doesn't set that day)."""
    if s["start"] != "sunset":
        return datetime.combine(d, datetime.strptime(s["start"], "%H:%M").time())
    if not where:
        return None
    # The sunset that falls on day d on this machine's clock (one far from the place can see its
    # sunset land on the day before or after).
    sunset = next((x for k in (0, -1, 1) if (x := sunset_local(d + timedelta(days=k), *where)) and x.date() == d), None)
    return sunset + timedelta(minutes=s.get("offset", 0)) if sunset else None


def _window(s: dict, d: date, where: Where = None) -> tuple[datetime, datetime] | None:
    """The window that starts on day d, if the schedule plays that day."""
    if d.weekday() not in s["days"] or not in_dates(s, d):
        return None
    if (start := start_on(s, d, where)) is None:
        return None
    end = datetime.combine(d, datetime.strptime(s["end"], "%H:%M").time())
    if s["start"] == "sunset":
        # Sunset moves, so "end before start" can't mean the next day: a morning end is the next
        # morning, any other is that evening, and an evening the sun sets after the end is skipped.
        if end.hour < 12:
            end += timedelta(days=1)
        if end <= start:
            return None
    elif end <= start:
        end += timedelta(days=1)
    return start, end


def window_at(s: dict, now: datetime, where: Where = None) -> tuple[datetime, datetime] | None:
    """The scheduled stretch going on at `now`, if any (yesterday's can run past midnight)."""
    if not s.get("on"):
        return None
    for d in (now.date(), now.date() - timedelta(days=1)):
        w = _window(s, d, where)
        if w and w[0] <= now < w[1]:
            return w
    return None


def next_start(s: dict, now: datetime, where: Where = None) -> datetime | None:
    """When it next starts, or None if it's off or never plays."""
    if not s.get("on") or not s["days"]:
        return None
    for k in range(367):
        w = _window(s, now.date() + timedelta(days=k), where)
        if w and w[0] > now:
            return w[0]
    return None


MAX_ENTRIES = 100
MAX_ID = 64
KINDS = ("playlist", "show", "scene")


def clean_entry(e) -> dict | None:
    """A schedule entry as stored, or None if it isn't one."""
    if not isinstance(e, dict) or not valid_id(str(e.get("id", ""))):
        return None
    play = e.get("play")
    if not isinstance(play, dict) or play.get("type") not in KINDS or not valid_id(str(play.get("id", ""))):
        return None
    times = playlists.clean_schedule(e)
    if times is None:
        return None
    return {"id": str(e["id"]), "play": {"type": play["type"], "id": str(play["id"])}, **times}


def _from_old(storage: Storage) -> list[dict]:
    """Entries made from the schedules playlists and scenes each had before the Schedule tab."""
    out, used = [], set()

    def add(kind, item):
        times = playlists.clean_schedule(item.get("schedule"))
        if times is None:
            return
        # Ids are at most 64 characters (storage.valid_id), so a long name is cut to fit.
        base = f"{kind}-{item['id']}"[:MAX_ID - 4].rstrip("-")
        eid, n = base, 2
        while eid in used:
            eid, n = f"{base}-{n}", n + 1
        used.add(eid)
        out.append({"id": eid, "play": {"type": kind, "id": item["id"]}, **times})

    for p in playlists.load(storage):
        add("playlist", p)
    for sc in sorted(storage.list_scenes(), key=lambda x: str(x.get("name", "")).lower()):
        add("scene", sc)
    return out


def load_entries(storage: Storage) -> list[dict]:
    """The schedule, highest priority first (moving old schedules across the first time)."""
    settings = storage.load_settings()
    if not isinstance(settings.get("schedule"), list):
        settings["schedule"] = _from_old(storage)
        storage.save_settings(settings)
        log.info("schedule: moved %d schedule(s) from playlists and scenes", len(settings["schedule"]))
    return [e for e in (clean_entry(x) for x in settings["schedule"]) if e]


def show_playlist(show_id: str, name: str) -> dict:
    """What a show entry plays: that show round and round, as a playlist of one."""
    return {"id": f"show-{show_id}", "name": name, "shows": [show_id], "gap": 0,
            "items": [{"type": "show", "id": show_id}]}


class Scheduler:
    def __init__(self, storage: Storage, runner: Runner):
        self.storage, self.runner = storage, runner
        # Each evening's run is known by the day it started, so changing the times during it moves its
        # end (or ends it) rather than counting as a new run.
        self.handled: dict[str, date] = {}  # entry id -> the day whose run was already dealt with
        self.running: tuple[str, date, str] | None = None  # the entry it started, that run's day, what plays
        self.scene_handled: dict[str, date] = {}  # the same, for scene entries
        self.scene_running: tuple[str, date, str] | None = None
        self.ha_where: Where = None  # Home Assistant's location, checked every hour
        self._ha_checked: float | None = None

    def where(self) -> tuple[Where, str | None]:
        """Where sunset is worked out for, and who said: "you" (typed in) or "ha"."""
        loc = self.storage.load_settings().get("location")
        if isinstance(loc, dict) and isinstance(loc.get("lat"), (int, float)) and isinstance(loc.get("lon"), (int, float)):
            return (float(loc["lat"]), float(loc["lon"])), "you"
        return (self.ha_where, "ha") if self.ha_where else (None, None)

    async def refresh_ha_location(self):
        ha = self.runner.ha
        loop = asyncio.get_running_loop()
        wait = HA_LOCATION_EVERY_S if self.ha_where else HA_LOCATION_RETRY_S
        if not ha or not ha.available or (self._ha_checked and loop.time() - self._ha_checked < wait):
            return
        self._ha_checked = loop.time()
        try:
            config = await ha.config()
            self.ha_where = (float(config["latitude"]), float(config["longitude"]))
        except (HAError, KeyError, TypeError, ValueError) as e:
            log.warning("couldn't read Home Assistant's location for sunset times: %s", e)

    def state(self, now: datetime | None = None) -> dict:
        now = now or datetime.now()
        where, source = self.where()
        nexts = {}
        for e in load_entries(self.storage):
            if (n := next_start(e, now, where)):
                nexts[e["id"]] = n.isoformat(timespec="minutes")
        sunset = sunset_local(now.date(), *where) if where else None
        return {"now": now.isoformat(timespec="minutes"), "next": nexts,
                "scheduled": self.running[0] if self.running else None,
                "scene_scheduled": self.scene_running[0] if self.scene_running else None,
                "location": {"lat": where[0], "lon": where[1], "source": source} if where else None,
                "sunset": sunset.strftime("%H:%M") if sunset else None}

    def _target(self, e: dict) -> tuple[str, dict] | None:
        """What a playlist or show entry plays, as the runner knows it, or None if it's gone."""
        kind, ref = e["play"]["type"], e["play"]["id"]
        if kind == "playlist":
            p = next((p for p in playlists.load(self.storage) if p["id"] == ref), None)
            return (p["id"], p) if p else None
        show = self.storage.load_show(ref)
        if show is None:
            return None
        p = show_playlist(ref, str(show.get("name") or ref))
        return p["id"], p

    def _windows(self, entries: list[dict], now: datetime) -> dict[str, tuple[datetime, datetime]]:
        where, _ = self.where()
        return {e["id"]: w for e in entries if (w := window_at(e, now, where))}

    async def tick(self, now: datetime | None = None):
        now = now or datetime.now()
        entries = load_entries(self.storage)
        try:
            await self.tick_playlists(now, [e for e in entries if e["play"]["type"] != "scene"])
        finally:  # scenes keep to their times whatever a playlist ran into
            await self.tick_scenes(now, [e for e in entries if e["play"]["type"] == "scene"])

    async def tick_scenes(self, now: datetime, entries: list[dict]):
        windows = self._windows(entries, now)
        current = (self.runner.scene or {}).get("id")
        if self.scene_running:
            eid, day, sid = self.scene_running
            if current != sid:
                # Turned off, or another scene put on: leave every current stretch be until next time.
                self.scene_running = None
                for other, w in windows.items():
                    self.scene_handled[other] = w[0].date()
            elif eid not in windows or windows[eid][0].date() != day:
                if (follow := self._follow_on(entries, windows, sid, self.scene_handled)):
                    self.scene_running = follow
                    return
                log.info("schedule: scene %s's time is up", sid)
                self.scene_running = None
                await self.runner.stop_scene(sid)
        if self.scene_running:
            return
        for e in entries:
            w, sid = windows.get(e["id"]), e["play"]["id"]
            if not w or self.scene_handled.get(e["id"]) == w[0].date():
                continue
            self.scene_handled[e["id"]] = w[0].date()
            if current == sid:  # already on: carry on, and turn it off at the end time
                self.scene_running = (e["id"], w[0].date(), sid)
                return
            try:
                await self.runner.want_scene(sid)
            except RunnerError as err:
                log.warning("schedule: couldn't put on scene %s: %s", sid, err)
                continue
            log.info("schedule: scene %s on until %s", sid, w[1].strftime("%H:%M"))
            self.scene_running = (e["id"], w[0].date(), sid)
            return

    def _follow_on(self, entries, windows, target: str, handled: dict) -> tuple[str, date, str] | None:
        """Another entry whose time it is that plays the same thing, so it carries on unbroken."""
        for e in entries:
            w = windows.get(e["id"])
            same = e["play"]["id"] == target if e["play"]["type"] == "scene" else (
                (t := self._target(e)) is not None and t[0] == target)
            if w and same and handled.get(e["id"]) != w[0].date():
                handled[e["id"]] = w[0].date()
                return e["id"], w[0].date(), target
        return None

    async def tick_playlists(self, now: datetime, entries: list[dict]):
        windows = self._windows(entries, now)
        playing = (self.runner.playlist or {}).get("id")
        if self.running:
            eid, day, target = self.running
            if playing != target:
                # Stopped, or something else put on: leave every current stretch alone until next time.
                self.running = None
                for other, w in windows.items():
                    self.handled[other] = w[0].date()
            elif eid not in windows or windows[eid][0].date() != day:
                if (follow := self._follow_on(entries, windows, target, self.handled)):
                    self.running = follow
                    return
                log.info("schedule: %s's time is up; finishing the show that's on", target)
                self.running = None
                await self.runner.finish_playlist()
        # Let the last show end before the next playlist, and never cut off a visitor's show: the
        # playlist starts at the next tick after it.
        if self.running or self.runner.finishing or self.runner.public_now:
            return
        for e in entries:
            w = windows.get(e["id"])
            if not w or self.handled.get(e["id"]) == w[0].date():
                continue
            self.handled[e["id"]] = w[0].date()
            if (target := self._target(e)) is None:
                log.warning("schedule: %s %s isn't there any more; skipping it", e["play"]["type"], e["play"]["id"])
                continue
            if playing == target[0]:  # already put on by hand: carry on, and stop it at the end time
                self.running = (e["id"], w[0].date(), target[0])
                return
            try:
                await self.runner.play_playlist(target[1])
            except RunnerError as err:
                log.warning("schedule: couldn't start %s: %s", target[1]["name"], err)
                continue
            log.info("schedule: started %s until %s", target[1]["name"], w[1].strftime("%H:%M"))
            self.running = (e["id"], w[0].date(), target[0])
            return

    async def run(self):
        while True:
            try:
                await self.refresh_ha_location()
                await self.tick()
            except Exception:  # keep the schedule going whatever one tick hits
                log.exception("schedule tick failed")
            await asyncio.sleep(TICK_S)
