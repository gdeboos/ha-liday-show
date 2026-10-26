"""Playlists: shows to play back to back, round and round, with a pause between them.

Kept in settings with the palettes and presets. A playlist can also have a schedule (see schedule.py). A show that's been deleted stays in the list and is
skipped when the playlist plays, so putting it back (from an export, say) brings it back.
"""
import math
import re
from datetime import date

from .storage import Storage, valid_id

MAX_PLAYLISTS = 50
MAX_SHOWS = 100
MAX_GAP_S = 600
MAX_OFFSET_MIN = 180

_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_DAY = re.compile(r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")


def valid_day(md: str) -> bool:
    if not _DAY.match(md):
        return False
    try:
        date(2000, int(md[:2]), int(md[3:]))  # a leap year, so 29 February is allowed
    except ValueError:
        return False
    return True


def clean_schedule(s) -> dict | None:
    """A schedule as stored, or None if it isn't one."""
    if not isinstance(s, dict):
        return None
    start, end = str(s.get("start", "")), str(s.get("end", ""))
    days, frm, to = s.get("days"), str(s.get("from") or ""), str(s.get("to") or "")
    if not (_TIME.match(start) or start == "sunset") or not _TIME.match(end) or start == end:
        return None
    offset = s.get("offset", 0)
    if not isinstance(offset, int) or isinstance(offset, bool) or not -MAX_OFFSET_MIN <= offset <= MAX_OFFSET_MIN:
        return None
    if not isinstance(days, list) or not all(isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6
                                             for d in days):
        return None
    if bool(frm) != bool(to) or (frm and not (valid_day(frm) and valid_day(to))):
        return None
    out = {"on": bool(s.get("on")), "start": start, "end": end, "days": sorted(set(days)), "from": frm, "to": to}
    if start == "sunset":
        out["offset"] = offset  # minutes after sunset (before, if negative)
    return out


def clean(p, strict: bool = True) -> dict | None:
    """A playlist as stored, or None if it isn't one. Not strict, a broken schedule is dropped
    rather than the whole playlist, so a hand-edited file never loses its shows."""
    if not isinstance(p, dict):
        return None
    pid, name, shows = str(p.get("id", "")), str(p.get("name", "")).strip()[:60], p.get("shows")
    if not valid_id(pid) or not name or not isinstance(shows, list) or len(shows) > MAX_SHOWS \
            or not all(isinstance(s, str) and valid_id(s) for s in shows):
        return None
    try:
        gap = float(p.get("gap", 5))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(gap):
        return None
    out = {"id": pid, "name": name, "shows": shows, "gap": round(min(max(gap, 0), MAX_GAP_S), 1)}
    if p.get("schedule") is not None:  # playlists from before schedules have none
        if (schedule := clean_schedule(p["schedule"])) is not None:
            out["schedule"] = schedule
        elif strict:
            return None
    return out


def load(storage: Storage) -> list[dict]:
    return [p for p in (clean(x, strict=False) for x in storage.load_settings().get("playlists", [])) if p]


def find(storage: Storage, ref: str) -> dict | None:
    """A playlist by its id, or else by its name (any case)."""
    ref = ref.strip()
    found = load(storage)
    return next((p for p in found if p["id"] == ref), None) \
        or next((p for p in found if p["name"].lower() == ref.lower()), None)
