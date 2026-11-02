"""Seasons: props that only go up for part of the year (Halloween, Christmas, your own).

A light can be tagged with seasons (a device's optional `seasons`, ids); untagged lights are all year.
Each season has an Out / Packed away switch (settings `seasons`). A light counts as packed away when
every season it's in that still exists is packed away; nothing is sent to it then. Shows pick a season
in the editor; that only changes which lanes they list, so it's the editor's business, not this one.
"""

import re

DEFAULT = [{"id": "halloween", "name": "Halloween", "out": True},
           {"id": "christmas", "name": "Christmas", "out": True}]
MAX_SEASONS = 20
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "season"


def load(settings: dict) -> list[dict]:
    """The seasons as saved, or Halloween and Christmas (both out) when there's nothing saved yet."""
    saved = settings.get("seasons")
    if not isinstance(saved, list):
        return [dict(s) for s in DEFAULT]
    try:
        return clean(saved)
    except ValueError:
        return [dict(s) for s in DEFAULT]


def clean(body) -> list[dict]:
    """[{id?, name, out?}] checked: names 1-40 characters and different, ids made from names when missing."""
    if not isinstance(body, list) or len(body) > MAX_SEASONS:
        raise ValueError(f"expected a list of up to {MAX_SEASONS} seasons")
    out, ids, names = [], set(), set()
    for s in body:
        if not isinstance(s, dict):
            raise ValueError("each season needs a name")
        name = " ".join(str(s.get("name") or "").split())[:40]
        if not name:
            raise ValueError("each season needs a name")
        if name.lower() in names:
            raise ValueError(f"there's already a season called {name}")
        sid = s.get("id")
        if sid is None:
            sid, n = slug(name), 2
            while sid in ids:
                sid, n = f"{slug(name)[:36]}-{n}", n + 1
        if not isinstance(sid, str) or not _ID.match(sid) or sid in ids:
            raise ValueError("each season needs its own id")
        ids.add(sid)
        names.add(name.lower())
        out.append({"id": sid, "name": name, "out": s.get("out", True) is not False})
    return out


def clean_tags(tags) -> list[str]:
    """A light's seasons: up to MAX_SEASONS ids, each once."""
    if tags is None:
        return []
    if not isinstance(tags, list) or len(tags) > MAX_SEASONS or not all(isinstance(t, str) and _ID.match(t) for t in tags):
        raise ValueError("a light's seasons are a list of season ids")
    return list(dict.fromkeys(tags))


def away(devices: list[dict], seasons: list[dict]) -> set[str]:
    """Ids of the lights that are packed away."""
    out_now = {s["id"]: s["out"] for s in seasons}
    gone = set()
    for d in devices:
        mine = [t for t in d.get("seasons") or [] if t in out_now]
        if mine and not any(out_now[t] for t in mine):
            gone.add(d["id"])
    return gone
