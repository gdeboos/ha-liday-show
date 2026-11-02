"""React to music: a scene that follows what a WLED with a microphone hears (livemusic.py).

The scene's baked loop plays as usual. Each frame, the live numbers decide three things, and the player
only scales, mixes and picks between baked frames:
  - how bright it is: louder is brighter, down to the scene's quietest level;
  - a flash on each beat, dying away over a quarter of a second;
  - which look: the scene itself, or the scene picked for strong bass or strong treble (held at least
    a second, so it doesn't flicker between them).
After a few quiet seconds (or with no WLED heard at all) it glides back to the plain scene at normal
brightness. Saved on a scene as its optional `react` setting.
"""
import re
from typing import NamedTuple

DEFAULTS = {"on": False, "quiet": 20, "flash": True, "strength": 60, "bass": "", "treble": "", "quietSecs": 4}
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
STRONG = 70  # a band this loud (0-100), and well above the other, counts as strong
LEAD = 10
HOLD_S = 1.0  # a bass or treble look stays at least this long
FLASH_S = 0.25
GLIDE_S = 0.15  # how quickly brightness follows the music


def clean(body) -> dict:
    """A scene's react setting as saved; raises ValueError saying what's wrong."""
    if not isinstance(body, dict):
        raise ValueError("React to music needs its settings")
    out = dict(DEFAULTS)
    out["on"] = body.get("on", False) is True

    def number(key, lo, hi):
        v = body.get(key, DEFAULTS[key])
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
            raise ValueError(f"React to music: {key} must be {lo} to {hi}")
        return round(v)

    out["quiet"], out["strength"], out["quietSecs"] = number("quiet", 0, 100), number("strength", 10, 100), number("quietSecs", 1, 60)
    out["flash"] = body.get("flash", True) is not False
    for key in ("bass", "treble"):
        v = body.get(key) or ""
        if not isinstance(v, str) or (v and not _ID.match(v)):
            raise ValueError(f"React to music: the {key} scene isn't one of yours")
        out[key] = v
    return out


class Out(NamedTuple):
    look: str  # "plain", "bass" or "treble"
    level: float  # 0-100, on top of the scenes' own brightness
    flash: float  # 0-1, how far towards white


class Reactor:
    def __init__(self, cfg: dict, threshold: int = 15):
        self.cfg, self.threshold = cfg, threshold
        self.level = 100.0
        self.last_music = -1e9
        self.last_time: float | None = None
        self.look, self.look_until = "plain", -1e9
        self.flash_at, self.seen_beat = -1e9, None

    def step(self, levels: dict | None, now: float) -> Out:
        """levels: {loudness, bass, treble 0-100, beat_at (when the last beat was heard)} or None."""
        cfg = self.cfg
        dt = 0.0 if self.last_time is None else max(0.0, now - self.last_time)
        self.last_time = now
        loud = levels["loudness"] if levels else 0
        if levels and loud >= self.threshold:
            self.last_music = now
        silent = not levels or now - self.last_music >= cfg["quietSecs"]
        target = 100.0 if silent else cfg["quiet"] + (100 - cfg["quiet"]) * loud / 100
        self.level += (target - self.level) * min(1.0, dt / GLIDE_S) if dt else 0
        if silent:
            self.look = "plain"
        else:
            bass, treble = levels.get("bass", 0), levels.get("treble", 0)
            strong = ("bass" if cfg["bass"] and bass >= STRONG and bass >= treble + LEAD
                      else "treble" if cfg["treble"] and treble >= STRONG and treble >= bass + LEAD else None)
            if strong:
                self.look, self.look_until = strong, now + HOLD_S
            elif now >= self.look_until:
                self.look = "plain"
        beat = levels.get("beat_at") if levels else None
        if cfg["flash"] and beat is not None and beat != self.seen_beat:
            self.seen_beat, self.flash_at = beat, beat
        flash = cfg["strength"] / 100 * max(0.0, 1 - (now - self.flash_at) / FLASH_S) if cfg["flash"] and not silent else 0.0
        return Out(self.look, self.level, flash)
