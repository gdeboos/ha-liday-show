"""Profiles: the lights you have now, and plans for next year (claude/profiles-plan.md).

A profile holds the house, not the shows: its own list of lights, house photo and tracing, light groups
and light roles. Songs, shows, scenes, playlists, the schedule and the visitors' page are shared.
devices.json stays the one list of every light, so a light in two profiles is the same light.

Saved in the settings as `profiles: [{id, name, lights, house?, light_groups?, light_roles?}]` and
`live_profile`. The live profile's house, groups and roles stay at the top of the settings, where they
always were, so older versions (and everything that plays) read the live one unchanged; the other
profiles keep theirs in their own entry. No `profiles` key means one profile, Now, with every light.
"""
from __future__ import annotations

import copy
import re
import secrets

FIRST = "now"
OWN = ("house", "light_groups", "light_roles")  # what each profile has its own of
MAX_PROFILES = 10
_ID = re.compile(r"^[a-z0-9-]{1,32}$")


def valid_id(pid) -> bool:
    return isinstance(pid, str) and bool(_ID.match(pid))


def load(settings: dict, devices: list[dict]) -> tuple[list[dict], str]:
    """Every profile (each with its lights in order) and the live one's id."""
    ids = [d["id"] for d in devices]
    known = set(ids)
    raw = settings.get("profiles")
    out = []
    if isinstance(raw, list):
        seen = set()
        for p in raw:
            if not isinstance(p, dict) or not valid_id(p.get("id")) or p["id"] in seen:
                continue
            seen.add(p["id"])
            lights = [x for x in p.get("lights") or [] if isinstance(x, str) and x in known]
            out.append({**p, "name": str(p.get("name") or "Profile")[:40], "lights": list(dict.fromkeys(lights))})
    if not out:
        return [{"id": FIRST, "name": "Now", "lights": ids}], FIRST
    live = settings.get("live_profile")
    if live not in {p["id"] for p in out}:
        live = out[0]["id"]
    # A light in no profile (added by an older version, say) is one of the live profile's.
    anywhere = {x for p in out for x in p["lights"]}
    for p in out:
        if p["id"] == live:
            p["lights"] += [x for x in ids if x not in anywhere]
    return out, live


def summary(settings: dict, devices: list[dict]) -> dict:
    profiles, live = load(settings, devices)

    def groups(p):
        own = settings.get("light_groups") if p["id"] == live else p.get("light_groups")
        return [g["id"] for g in own if isinstance(g, dict) and "id" in g] if isinstance(own, list) else []
    return {"live": live, "profiles": [{"id": p["id"], "name": p["name"], "lights": p["lights"],
                                        "groups": groups(p), "live": p["id"] == live} for p in profiles]}


def resolve(settings: dict, devices: list[dict], pid: str | None) -> str | None:
    """The profile asked for (None or "" for the live one), or None if there's no such profile."""
    profiles, live = load(settings, devices)
    if not pid:
        return live
    return pid if any(p["id"] == pid for p in profiles) else None


def lights(settings: dict, devices: list[dict], pid: str | None = None) -> list[dict]:
    """A profile's lights (the live one's by default), in its own order."""
    profiles, live = load(settings, devices)
    want = pid or live
    by_id = {d["id"]: d for d in devices}
    for p in profiles:
        if p["id"] == want:
            return [by_id[x] for x in p["lights"]]
    return []


def get(settings: dict, devices: list[dict], pid: str | None, key: str):
    """A profile's own house, light_groups or light_roles (None when it has none)."""
    profiles, live = load(settings, devices)
    if not pid or pid == live:
        return settings.get(key)
    return next((p.get(key) for p in profiles if p["id"] == pid), None)


def _write(settings: dict, profiles: list[dict], live: str):
    settings["profiles"] = profiles
    settings["live_profile"] = live


def put(settings: dict, devices: list[dict], pid: str | None, key: str, value):
    """Sets a profile's own house, light_groups or light_roles in `settings` (not saved)."""
    profiles, live = load(settings, devices)
    if not pid or pid == live:
        settings[key] = value
        return
    for p in profiles:
        if p["id"] == pid:
            p[key] = value
    _write(settings, profiles, live)


def save_lights(settings: dict, devices: list[dict], pid: str | None, mine: list[dict]) -> list[dict]:
    """A profile's lights saved as `mine`: each light's settings are shared, so they're updated in
    every profile; lights added join this profile only; lights left out leave it, and are deleted
    once they're in no profile. Returns every light (devices.json). `settings` gets the new lists
    (not saved), only once there's more than one profile."""
    profiles, live = load(settings, devices)
    if not isinstance(settings.get("profiles"), list) or not settings["profiles"]:
        return list(mine)  # one profile: the list is every light, as always
    want = pid or live
    ids = [d["id"] for d in mine]
    for p in profiles:
        if p["id"] == want:
            p["lights"] = ids
    used = {x for p in profiles for x in p["lights"]}
    new = {d["id"]: d for d in mine}
    out = [new.pop(d["id"], d) for d in devices if d["id"] in used]
    out += list(new.values())
    _write(settings, profiles, live)
    return out


def new_id(settings: dict, devices: list[dict]) -> str:
    taken = {p["id"] for p in load(settings, devices)[0]}
    while True:
        pid = "p" + secrets.token_hex(4)
        if pid not in taken:
            return pid


def add(settings: dict, devices: list[dict], name: str, copy_of: str | None) -> str:
    """A new profile, a copy of `copy_of`'s lights, house, groups and roles. Returns its id."""
    profiles, live = load(settings, devices)
    src = copy_of if any(p["id"] == copy_of for p in profiles) else live
    pid = new_id(settings, devices)
    entry = {"id": pid, "name": name, "lights": list(next(p["lights"] for p in profiles if p["id"] == src))}
    for key in OWN:
        value = get(settings, devices, src, key)
        if value is not None:
            entry[key] = copy.deepcopy(value)
    # Each saved profile keeps its own lights list from now on; the live one's own data stays at the top.
    for p in profiles:
        if p["id"] == live:
            for key in OWN:
                p.pop(key, None)
    _write(settings, profiles + [entry], live)
    return pid


def rename(settings: dict, devices: list[dict], pid: str, name: str) -> bool:
    profiles, live = load(settings, devices)
    if not any(p["id"] == pid for p in profiles):
        return False
    for p in profiles:
        if p["id"] == pid:
            p["name"] = name
    _write(settings, profiles, live)
    return True


def remove(settings: dict, devices: list[dict], pid: str) -> list[dict]:
    """Deletes a profile that isn't live. Returns every light left: its own lights that are in no
    other profile go too."""
    profiles, live = load(settings, devices)
    if pid == live or not any(p["id"] == pid for p in profiles):
        raise ValueError("the live profile can't be deleted")
    rest = [p for p in profiles if p["id"] != pid]
    used = {x for p in rest for x in p["lights"]}
    _write(settings, rest, live)
    return [d for d in devices if d["id"] in used]


def make_live(settings: dict, devices: list[dict], pid: str) -> str:
    """Makes `pid` the live profile; returns the one that was. Its house, groups and roles move to the
    top of the settings, and the old live one keeps its own in its entry."""
    profiles, live = load(settings, devices)
    if not any(p["id"] == pid for p in profiles):
        raise ValueError("no such profile")
    if pid == live:
        return live
    for p in profiles:
        if p["id"] == live:
            for key in OWN:
                if key in settings:
                    p[key] = settings[key]
                else:
                    p.pop(key, None)
    for p in profiles:
        if p["id"] == pid:
            for key in OWN:
                if key in p:
                    settings[key] = p.pop(key)
                else:
                    settings.pop(key, None)
    _write(settings, profiles, pid)
    return live
