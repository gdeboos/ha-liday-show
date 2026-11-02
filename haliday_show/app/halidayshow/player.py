"""Play a baked show, following the browser's audio clock.

The browser plays the song and posts its position; the player keeps a monotonic
start time and nudges it when the reported position drifts too far.
"""
import asyncio
import logging
import math
import time

from .baked import Baked
from .output import Output, address, linked

log = logging.getLogger(__name__)

# Keeping the lights in time with the browser. Each sync arrives with some network jitter, so
# small differences are eased out a little at a time; jumping on every one made long effects
# like rainbow visibly skip every second or so. Only a big difference (a seek) jumps.
RESYNC_S = 0.25
DEADBAND_S = 0.03
EASE = 0.2


class Player:
    def __init__(self, output: Output):
        self.output = output
        self.baked: Baked | None = None
        self.show_id: str | None = None
        self.devices: dict = {}
        self.start = 0.0  # monotonic time of position 0
        self.offset = 0.0  # seconds to shift lights against audio (+ = lights later)
        self.length: float | None = None  # loop the frames for this long (a playlist's block)
        self.level = 100  # a scene's brightness, 1-100 (Home Assistant's light); shows play at 100
        self._dim: bytes | None = None
        self._task: asyncio.Task | None = None
        # React to music (react.py): a callable giving each frame's look, level and flash, and the baked
        # loops of the scenes picked for strong bass and treble. None while nothing reacts.
        self.react = None
        self.variants: dict[str, Baked] = {}

    @property
    def playing(self) -> bool:
        return self._task is not None and not self._task.done()

    def position(self) -> float:
        return time.monotonic() - self.start if self.playing else 0.0

    def status(self) -> dict:
        return {"playing": self.playing, "show": self.show_id,
                "position": round(self.position(), 3),
                # A scene loops with no end (length is infinite): report one time round.
                "duration": self.length if self.length and math.isfinite(self.length)
                else (self.baked.duration if self.baked else 0)}

    async def play(self, show_id: str | None, baked: Baked, devices: dict, position: float = 0.0,
                   offset: float = 0.0, length: float | None = None):
        """devices maps a track's device id to its stored config (ip, reverse, gradient, protocol, brightness).

        Planned devices (no IP yet) are skipped. With `length`, the frames play round and round
        for that many seconds (a playlist's building block) rather than once; an infinite length
        (a scene) goes round until it's stopped.
        """
        devices = {k: d for k, d in devices.items() if linked(d)}
        await self.stop(release=False)
        self.react, self.variants = None, {}
        self.baked, self.show_id, self.devices, self.offset = baked, show_id, devices, offset
        self.length = length
        claimed = set()
        for t in baked.tracks:
            d = devices.get(t.device)
            if d:
                # Never more than the light has now: a bake from before its count went down (0.2.207
                # cut Per bulb lights to their realtime reach) would otherwise overrun it.
                segments = min(t.segments, int(d.get("segments") or t.segments))
                self.output.claim(address(d), segments, reverse=d.get("reverse", False),
                                  gradient=d.get("gradient", False),
                                  protocol=d.get("protocol", "standard"),
                                  brightness=d.get("brightness", 100))
                claimed.add(address(d))
        for ip in set(self.output.devices) - claimed:
            self.output.release(ip)
        self.start = time.monotonic() - position
        self._task = asyncio.create_task(self._run())

    def drop(self, ids: set[str]):
        """Stops sending to these lights (props just packed away) and lets them go, mid-show too."""
        if not self.playing:
            return  # the next show or scene starts without them anyway
        for i in ids & set(self.devices):
            d = self.devices.pop(i)
            if not any(address(o) == address(d) for o in self.devices.values()):
                self.output.release(address(d))

    def sync(self, position: float) -> float:
        """Return the drift seen (player minus browser), re-anchoring if needed."""
        if not self.playing:
            return 0.0
        drift = self.position() - position
        if abs(drift) > RESYNC_S:
            self.start = time.monotonic() - position
        elif abs(drift) > DEADBAND_S:
            self.start += drift * EASE
        return drift

    def set_level(self, level: int):
        """Dims every frame from the next one on (a scene's brightness). Only scales baked frames."""
        self.level = max(0, min(100, int(level)))
        self._dim = None if self.level >= 100 else bytes(v * self.level // 100 for v in range(256))

    def _react_table(self, react) -> bytes:
        """Each colour value scaled by the scenes' brightness and the music's level, then lifted towards
        white by the beat's flash."""
        scale = (self.level / 100) * (react.level / 100)
        return bytes(min(255, round(v * scale + (255 - v * scale) * react.flash)) for v in range(256))

    @staticmethod
    def _variant_frame(baked: Baked, t, elapsed: float) -> bytes | None:
        """This light's frame from another scene's loop (strong bass or treble), at the same moment."""
        mine = next((x for x in baked.tracks if x.device == t.device and x.segments == t.segments), None)
        if mine is None or not baked.frames:
            return None
        return baked.track_frame(mine, int(max(elapsed, 0) * baked.fps) % baked.frames)

    async def stop(self, release: bool = True):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if release:
            self.output.release_all()

    async def _run(self):
        b = self.baked
        frame_s = 1.0 / b.fps
        last = -1
        while True:
            elapsed = time.monotonic() - self.start - self.offset
            idx = int(elapsed * b.fps)
            if self.length is not None:
                if elapsed >= self.length:
                    break
                idx %= max(b.frames, 1)
            elif idx >= b.frames:
                break
            react = self.react() if self.react else None
            key = (idx, react) if react else idx
            if idx >= 0 and key != last:
                # Reacting, a frame also goes out when the level, flash or look move with the music,
                # even on a loop that's a still picture. The frames are only picked, scaled and mixed,
                # never worked out here.
                table = self._react_table(react) if react else self._dim
                source = self.variants.get(react.look) if react else None
                for t in b.tracks:
                    d = self.devices.get(t.device)
                    if d:
                        dev = self.output.devices.get(address(d))
                        if dev:
                            frame = self._variant_frame(source, t, elapsed) if source else None
                            frame = frame or b.track_frame(t, idx)
                            dev.update(frame.translate(table) if table else frame)
                last = key
            await asyncio.sleep(frame_s / 4)
        log.info("%s finished", f"show {self.show_id}" if self.show_id else "block")
        self.output.release_all()
