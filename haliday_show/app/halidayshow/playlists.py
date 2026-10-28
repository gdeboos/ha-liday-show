"""Playlists: shows to play back to back, round and round, with building blocks between them.

A playlist's "items" are what plays, in order: {"type": "show", "id"}, or a block with its own "id" and
"seconds": "pause" (the lights as they normally are), "off" (every light dark), "colour" (every light
one "colour") or "effect" (an "effect" from effects.js with its "params", on every light). The editor
bakes each block's frames like a show's (storage.save_block); the player loops them for the block's
length. Playlists from before blocks have only "shows" and "gap", read as each show followed by a
pause. "shows" and "gap" are still kept, worked out from the items, for older versions and for
visitors' picks on the public page.

Kept in settings with the palettes and presets. A playlist's own "schedule" is from before 0.2.232 and
unused now: schedule.py has the schedule's entries. A show that's been deleted stays in the list and is
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
MAX_ITEMS = 200
MAX_BLOCK_S = 3600
BLOCKS = ("pause", "off", "colour", "effect", "scene")  # a scene block plays one of your scenes (scenelib.py)

_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
_EFFECT = re.compile(r"^[a-z][a-z0-9]{0,29}$")
_PARAM = re.compile(r"^[a-zA-Z][a-zA-Z0-9]{0,29}$")
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


def _clean_params(params) -> dict | None:
    """An effect block's settings: a few short names with numbers or short words (colours, choices)."""
    if not isinstance(params, dict) or len(params) > 20:
        return None
    out = {}
    for k, v in params.items():
        if not isinstance(k, str) or not _PARAM.match(k) or isinstance(v, bool):
            return None
        if isinstance(v, (int, float)) and math.isfinite(v):
            out[k] = v
        elif isinstance(v, str) and len(v) <= 40:
            out[k] = v
        else:
            return None
    return out


def clean_item(it) -> dict | None:
    if not isinstance(it, dict):
        return None
    kind, iid = it.get("type"), str(it.get("id", ""))
    if not valid_id(iid):
        return None
    if kind == "show":
        return {"type": "show", "id": iid}
    if kind not in BLOCKS:
        return None
    try:
        seconds = float(it.get("seconds"))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(seconds) or not 0 < seconds <= MAX_BLOCK_S:
        return None
    out = {"type": kind, "id": iid, "seconds": round(seconds, 1)}
    if kind == "colour":
        if not isinstance(it.get("colour"), str) or not _COLOUR.match(it["colour"]):
            return None
        out["colour"] = it["colour"].lower()
    if kind == "effect":
        params = _clean_params(it.get("params", {}))
        if not isinstance(it.get("effect"), str) or not _EFFECT.match(it["effect"]) or params is None:
            return None
        out["effect"], out["params"] = it["effect"], params
    if kind == "scene":
        if not isinstance(it.get("scene"), str) or not valid_id(it["scene"]):
            return None
        out["scene"] = it["scene"]
    return out


def from_shows(shows: list, gap: float) -> list[dict]:
    """A playlist from before blocks: each show, then its pause."""
    items = []
    for k, sid in enumerate(shows):
        items.append({"type": "show", "id": sid})
        if gap > 0:
            items.append({"type": "pause", "id": f"pause-{k + 1}", "seconds": gap})
    return items


def clean(p, strict: bool = True) -> dict | None:
    """A playlist as stored, or None if it isn't one. Not strict, a broken schedule (or block) is
    dropped rather than the whole playlist, so a hand-edited file never loses its shows."""
    if not isinstance(p, dict):
        return None
    pid, name = str(p.get("id", "")), str(p.get("name", "")).strip()[:60]
    if not valid_id(pid) or not name:
        return None
    if p.get("items") is not None:
        raw = p["items"]
        if not isinstance(raw, list) or len(raw) > MAX_ITEMS:
            return None
        items = [clean_item(x) for x in raw]
        if None in items:
            if strict:
                return None
            items = [x for x in items if x]
        seen: set[str] = set()
        for k, x in enumerate(items):
            if x["type"] != "show" and x["id"] in seen:
                if strict:
                    return None
                items[k] = None  # in the file: keep the first, drop the copy
            elif x["type"] != "show":
                seen.add(x["id"])
        items = [x for x in items if x]
    else:
        shows = p.get("shows")
        if not isinstance(shows, list) or not all(isinstance(s, str) and valid_id(s) for s in shows):
            return None
        try:
            gap = float(p.get("gap", 5))
        except (TypeError, ValueError):
            return None
        if not math.isfinite(gap):
            return None
        items = from_shows(shows, round(min(max(gap, 0), MAX_GAP_S), 1))
    shows = [x["id"] for x in items if x["type"] == "show"]
    if len(shows) > MAX_SHOWS:
        return None
    # For older versions and visitors' picks: the pause after the first show, if it has one.
    after = next((items[k + 1] for k, x in enumerate(items[:-1]) if x["type"] == "show"), None)
    gap = min(after["seconds"], MAX_GAP_S) if after and after["type"] == "pause" else 0
    out = {"id": pid, "name": name, "shows": shows, "gap": gap, "items": items}
    if p.get("schedule") is not None:  # playlists from before schedules have none
        if (schedule := clean_schedule(p["schedule"])) is not None:
            out["schedule"] = schedule
        elif strict:
            return None
    return out


def without_show(items: list, show_id: str) -> list:
    """Items with a show taken out, and the pause after it too where that would leave two pauses
    together (or one at the start)."""
    out = []
    drop_pause = False
    for x in items:
        if isinstance(x, dict) and x.get("type") == "show" and x.get("id") == show_id:
            drop_pause = not out or (isinstance(out[-1], dict) and out[-1].get("type") == "pause")
            continue
        if drop_pause and isinstance(x, dict) and x.get("type") == "pause":
            drop_pause = False
            continue
        drop_pause = False
        out.append(x)
    return out


def block_ids(found: list[dict]) -> set[str]:
    """Every block in these playlists that has frames to bake (a pause has none)."""
    return {x["id"] for p in found for x in p["items"] if x["type"] in ("off", "colour", "effect")}


def load(storage: Storage) -> list[dict]:
    return [p for p in (clean(x, strict=False) for x in storage.load_settings().get("playlists", [])) if p]


def find(storage: Storage, ref: str) -> dict | None:
    """A playlist by its id, or else by its name (any case)."""
    ref = ref.strip()
    found = load(storage)
    return next((p for p in found if p["id"] == ref), None) \
        or next((p for p in found if p["name"].lower() == ref.lower()), None)
