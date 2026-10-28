"""Scenes: one-tap looks for the whole house that play until something else is chosen.

A scene is saved as house-scenes/<id>.json in the config folder:
  {"name": "Candy cane glow", "mode": "basic",
   "lights": {"<light id>": {"effect": "chase", "params": {...}}, ...},
   "all": {"effect": "rainbow", "params": {...}}}      # only when Same for every light is on
A light with no entry stays off. The editor bakes the scene's frames, one seamless time round, into
house-scenes/<id>.gshow (the same layout as a show's), and the player plays them round and round.
"""
from .playlists import _EFFECT, _clean_params

MODES = ("basic",)
MAX_LIGHTS = 200
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
    out = {"name": clean_name(body.get("name")), "mode": mode, "lights": {}}
    for light_id, look in lights.items():
        # Light ids can be IP addresses or Govee device codes, so only their size is checked.
        if not isinstance(light_id, str) or not 0 < len(light_id) <= 128 or not light_id.isprintable():
            raise SceneError("bad light id")
        out["lights"][light_id] = _clean_look(look)
    if body.get("all") is not None:
        out["all"] = _clean_look(body["all"])
    return out
