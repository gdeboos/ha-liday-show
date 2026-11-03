"""Live music effects (effects.js, group Live music): scene lights that follow what a WLED with a
microphone hears (livemusic.py).

The editor bakes each such light at every level, 0 to 100 % in steps of 5, into the scene's live set
(house-scenes/<id>.live.gshow: one track per light, naming what it follows). Each frame time the player
picks the frame for the level it hears, gliding as React to music does; with no music for a few seconds
(or no WLED heard) the light plays the scene's own bake, where the effect draws its idle glow. Only
baked frames are picked, never worked out here.
"""
from .baked import Baked, decode

LEVELS = 21  # 0, 5 ... 100 %
FOLLOWS = ("loudness", "bass", "mid", "treble")
GLIDE_S = 0.15  # how quickly a level follows the music
QUIET_S = 4.0  # this long below "Counts as music from" and the lights go back to their idle look


def load(blob: bytes | None) -> Baked | None:
    """A scene's live set, or None if there isn't one or it isn't one (it's then just not used)."""
    if not blob:
        return None
    try:
        live = decode(blob)
    except (ValueError, KeyError, TypeError):  # a damaged file (say, from a backup) is just not used
        return None
    if live.frames != LEVELS or not live.tracks or any(t.kind != "level" or t.follows not in FOLLOWS for t in live.tracks):
        return None
    return live


class Follower:
    """The levels the live lights show now: {follows: 0-100}, gliding, or None for the idle look."""

    def __init__(self, threshold: int = 15):
        self.threshold = threshold
        self.levels = {k: 0.0 for k in FOLLOWS}
        self.last_music = -1e9
        self.last_time: float | None = None

    def step(self, heard: dict | None, now: float) -> dict | None:
        # At most a tenth of a second at a time, so after a pause it still glides up rather than jumping.
        dt = 0.0 if self.last_time is None else min(0.1, max(0.0, now - self.last_time))
        self.last_time = now
        if heard and heard.get("loudness", 0) >= self.threshold:
            self.last_music = now
        if not heard or now - self.last_music >= QUIET_S:
            self.levels = {k: 0.0 for k in FOLLOWS}  # start from dark when the music comes back
            return None
        for k in FOLLOWS:
            target = float(heard.get(k, 0) or 0)
            self.levels[k] += (target - self.levels[k]) * min(1.0, dt / GLIDE_S) if dt else 0
        return {k: round(v) for k, v in self.levels.items()}


def frame_index(level: float) -> int:
    """Which of the live set's frames shows a level (0-100)."""
    return max(0, min(LEVELS - 1, round(level / 5)))
