"""Scenes: one-tap looks for the whole house that play until something else is chosen.

A scene is saved as house-scenes/<id>.json in the config folder:
  {"name": "Candy cane glow", "mode": "basic",
   "lights": {"<light id>": {"effect": "chase", "params": {...}}, ...},
   "all": {"effect": "rainbow", "params": {...}}}      # only when Same for every light is on
A light with no entry stays off. An Advanced scene, edited in the Show editor, is instead
  {"name", "mode": "advanced", "loop": 20, "tracks": [...]}, its tracks as a show's (the House lane
  as device "@house"), going round every `loop` seconds. The editor bakes the scene's frames, one seamless time round, into
house-scenes/<id>.gshow (the same layout as a show's), and the player plays them round and round.
Either kind may still have a "schedule" from before 0.2.231, kept as it is; the Schedule tab's entries
(schedule.py) are what play scenes by themselves now.
"""
import math

from .playlists import _EFFECT, _clean_params, clean_schedule

MODES = ("basic", "advanced")
MAX_LIGHTS = 200
MAX_LOOP_S = 600
MAX_CLIPS = 4000
MAX_LIST = 64
MAX_NAME = 80


class SceneError(ValueError):
    pass


def _clean_look(look) -> dict:
    if not isinstance(look, dict):
        raise SceneError("each light needs an effect")
    effect, params = look.get("effect"), _clean_params(look.get("params", {}))
    if not isinstance(effect, str) or not _EFFECT.match(effect) or params is None:
        raise SceneError("an effect's settings aren't right")
    return {"effect": effect, "params": params}


def clean_name(name) -> str:
    if not isinstance(name, str) or not name.strip():
        raise SceneError("give the scene a name")
    return " ".join(name.split())[:MAX_NAME]


def _clean_value(v, depth: int = 0):
    """A clip setting: a number, a short word, true/false, or a short list or group of those."""
    if depth > 3:
        raise SceneError("an effect's settings aren't right")
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and math.isfinite(v):
        return v
    if isinstance(v, str) and len(v) <= 200:
        return v
    if isinstance(v, list) and len(v) <= MAX_LIST:
        return [_clean_value(x, depth + 1) for x in v]
    if isinstance(v, dict) and len(v) <= MAX_LIST and all(isinstance(k, str) and len(k) <= 40 for k in v):
        return {k: _clean_value(x, depth + 1) for k, x in v.items()}
    raise SceneError("an effect's settings aren't right")


def _clean_tracks(tracks, loop: float) -> list:
    if not isinstance(tracks, list) or len(tracks) > MAX_LIGHTS * 4:
        raise SceneError("too many lights")
    out, count = [], 0
    for tr in tracks:
        if not isinstance(tr, dict) or not isinstance(tr.get("clips"), list):
            raise SceneError("bad track")
        device = tr.get("device")
        if not isinstance(device, str) or not 0 < len(device) <= 200 or not device.isprintable():
            raise SceneError("bad light id")
        clips = []
        for c in tr["clips"]:
            count += 1
            if count > MAX_CLIPS:
                raise SceneError("too many effects")
            if not isinstance(c, dict) or not isinstance(c.get("effect"), str) or not _EFFECT.match(c["effect"]):
                raise SceneError("an effect isn't right")
            start, end = c.get("start"), c.get("end")
            if not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in (start, end)) \
                    or not 0 <= start < end <= loop + 0.01:
                raise SceneError("an effect runs outside the loop")
            clip = {}
            for k, v in c.items():
                if not isinstance(k, str) or len(k) > 40:
                    raise SceneError("an effect's settings aren't right")
                clip[k] = _clean_value(v)
            clips.append(clip)
        out.append({"device": device, "clips": clips})
    return out


def clean_scene(body) -> dict:
    """A scene as it's saved, from what the editor sent. Raises SceneError saying what's wrong."""
    if not isinstance(body, dict):
        raise SceneError("expected a scene")
    mode = body.get("mode", "basic")
    if mode not in MODES:
        raise SceneError("unknown scene mode")
    lights = body.get("lights", {})
    if not isinstance(lights, dict) or len(lights) > MAX_LIGHTS:
        raise SceneError("too many lights")
    if mode == "advanced":
        loop = body.get("loop")
        if not isinstance(loop, (int, float)) or isinstance(loop, bool) or not math.isfinite(loop) \
                or not 0.5 <= loop <= MAX_LOOP_S:
            raise SceneError(f"a scene loops every 0.5 to {MAX_LOOP_S} seconds")
        return _with_schedule(body, {"name": clean_name(body.get("name")), "mode": mode, "loop": round(float(loop), 3),
                                     "tracks": _clean_tracks(body.get("tracks", []), loop)})
    out = {"name": clean_name(body.get("name")), "mode": mode, "lights": {}}
    for light_id, look in lights.items():
        # Light ids can be IP addresses or Govee device codes, so only their size is checked.
        if not isinstance(light_id, str) or not 0 < len(light_id) <= 128 or not light_id.isprintable():
            raise SceneError("bad light id")
        out["lights"][light_id] = _clean_look(look)
    if body.get("all") is not None:
        out["all"] = _clean_look(body["all"])
    return _with_schedule(body, out)


def _with_schedule(body: dict, out: dict) -> dict:
    if body.get("schedule") is not None:
        schedule = clean_schedule(body["schedule"])
        if schedule is None:
            raise SceneError("the scene's schedule isn't right")
        out["schedule"] = schedule
    return out
