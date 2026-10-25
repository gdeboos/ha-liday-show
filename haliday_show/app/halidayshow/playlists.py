"""Playlists: shows to play back to back, round and round, with a pause between them.

Kept in settings with the palettes and presets. A show that's been deleted stays in the list and is
skipped when the playlist plays, so putting it back (from an export, say) brings it back.
"""
import math

from .storage import Storage, valid_id

MAX_PLAYLISTS = 50
MAX_SHOWS = 100
MAX_GAP_S = 600


def clean(p) -> dict | None:
    """A playlist as stored, or None if it isn't one."""
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
    return {"id": pid, "name": name, "shows": shows, "gap": round(min(max(gap, 0), MAX_GAP_S), 1)}


def load(storage: Storage) -> list[dict]:
    return [p for p in (clean(x) for x in storage.load_settings().get("playlists", [])) if p]


def find(storage: Storage, ref: str) -> dict | None:
    """A playlist by its id, or else by its name (any case)."""
    ref = ref.strip()
    found = load(storage)
    return next((p for p in found if p["id"] == ref), None) \
        or next((p for p in found if p["name"].lower() == ref.lower()), None)
