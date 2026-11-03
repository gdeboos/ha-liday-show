"""Live music effects (effects.js, group Live music): scene lights that follow what a WLED with a
microphone hears (livemusic.py).

The editor bakes each such light into the scene's live set (house-scenes/<id>.live.gshow: one track per
light, naming its kind, what it follows and how many frames are its own):
  - "level" (Level meter): the light at every level, 0 to 100 % in steps of 5. The player picks the
    frame for the level it hears, gliding as React to music does.
  - "burst" (Beat burst): its burst from start to end, ending dark. The player starts it again on each
    beat the WLED hears, as bright as the level it follows (burst_scale).
With no music for a few seconds (or no WLED heard) the light plays the scene's own bake, where the
effect draws its idle glow. Only baked frames are picked and scaled, never worked out here.
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
    def fits(t):
        if t.follows not in FOLLOWS:
            return False
        if t.kind == "level":
            return t.count in (0, LEVELS)  # (sets from before bursts don't say)
        return t.kind == "burst" and 1 <= t.count <= live.frames
    if live.frames < LEVELS or not live.tracks or not all(fits(t) for t in live.tracks):
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
        return {**{k: round(v) for k, v in self.levels.items()}, "beat_at": heard.get("beat_at")}


class Bursts:
    """When the bursts started: on each new beat heard. All of a scene's bursts start together."""

    def __init__(self):
        self.seen, self.start, self.primed = None, -1e9, False

    def index(self, beat_at, now: float, fps: int, count: int) -> int:
        """Which of a burst's frames shows now: the last (dark) once it's over, until the next beat."""
        if not self.primed:  # a beat heard before the scene started doesn't set one off
            self.seen, self.primed = beat_at, True
        if beat_at is not None and beat_at != self.seen:
            self.seen, self.start = beat_at, now
        return max(0, min(count - 1, int((now - self.start) * fps)))


def burst_scale(level: float) -> float:
    """How bright a burst plays for the level it follows (as effects.js burstStrength): never quite off."""
    return 0.3 + 0.7 * max(0.0, min(100.0, level)) / 100


def frame_index(level: float) -> int:
    """Which of the live set's frames shows a level (0-100)."""
    return max(0, min(LEVELS - 1, round(level / 5)))
