"""Play a baked show, following the browser's audio clock.

The browser plays the song and posts its position; the player keeps a monotonic
start time and nudges it when the reported position drifts too far.
"""
import asyncio
import logging
import math
import time

from . import liveeffects
from .baked import Baked
from .output import Output, address, linked

log = logging.getLogger(__name__)

# Keeping the lights in time with the browser. Each sync arrives with some network jitter, so
# small differences are eased out a little at a time; jumping on every one made long effects
# like rainbow visibly skip every second or so. Only a big difference (a seek) jumps.
RESYNC_S = 0.25
DEADBAND_S = 0.03
EASE = 0.2
# A playlist's building block that has run its time holds its last picture this long before the lights
# are let go, so the next block can carry straight on: letting a Govee light out of realtime and taking
# it back made it flash between scenes.
HOLD_S = 2.0


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
        self._let_go: asyncio.TimerHandle | None = None  # the lights' release after a block, if due
        # React to music (react.py): a callable giving each frame's look, level and flash, and the baked
        # loops of the scenes picked for strong bass and treble. None while nothing reacts.
        self.react = None
        self.variants: dict[str, Baked] = {}
        # Live music effects (liveeffects.py): the scene's live set, its tracks by light, and a callable
        # giving the levels heard now ({follows: 0-100}, or None for the idle look).
        self.live: Baked | None = None
        self.live_tracks: dict = {}
        self.live_step = None
        self.bursts = liveeffects.Bursts()
        self.spectra: dict = {}  # Spectrum bars lights, put together region by region
        self.sent: dict[str, bytes] = {}  # each light's last frame as it went out, for frame_now()

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
        self.live, self.live_tracks, self.live_step = None, {}, None
        self.bursts = liveeffects.Bursts()
        self.spectra = {}
        self.sent = {}
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

    def frame_now(self) -> tuple[list[dict], bytes] | None:
        """What's on the lights this moment, for the editor's live preview: each track's frame as it
        last went out (scaled and live effects and all), or, for a light with no address yet, the
        baked frame at this point. None when nothing's playing."""
        b = self.baked
        if not self.playing or b is None or not b.frames:
            return None
        elapsed = time.monotonic() - self.start - self.offset
        idx = max(0, int(elapsed * b.fps))
        idx = idx % b.frames if self.length is not None else min(idx, b.frames - 1)
        parts, tracks = [], []
        for t in b.tracks:
            frame = self.sent.get(t.device)
            if frame is None or len(frame) != t.size:
                frame = b.track_frame(t, idx)
                frame = frame.translate(self._dim) if self._dim else frame
            parts.append(frame)
            tracks.append({"device": t.device, "segments": t.segments})
        return tracks, b"".join(parts)

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

    def _live_pick(self, lt, heard: dict) -> tuple[int, int]:
        """A live light's frame now, and how bright (in twentieths): a level's own frame at full, or a
        burst's frame scaled by the level it follows."""
        if lt.kind == "burst":
            k = self.bursts.index(heard.get("beat_at"), time.monotonic(), self.live.fps, lt.count)
            return k, round(liveeffects.burst_scale(heard[lt.follows]) * 20)
        if lt.kind == "spectrum":
            return self._spectrum(lt).indexes(heard.get("bands")), 20
        return liveeffects.frame_index(heard[lt.follows]), 20

    def _spectrum(self, lt) -> "liveeffects.Spectrum":
        if lt.device not in self.spectra:
            self.spectra[lt.device] = liveeffects.Spectrum(lt)
        return self.spectra[lt.device]

    @staticmethod
    def _scale_table(twentieths: int) -> bytes:
        return bytes(v * twentieths // 20 for v in range(256))

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
        if self._let_go:
            self._let_go.cancel()
            self._let_go = None
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
            heard = self.live_step() if self.live_step else None
            # Only the live frames actually shown count, so a gliding level sends no more than it changes.
            shown = {d: self._live_pick(lt, heard) for d, lt in self.live_tracks.items()} if heard else None
            key = (idx, react, tuple(shown.values()) if shown else None)
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
                            lt = self.live_tracks.get(t.device) if heard else None
                            if lt is not None and lt.segments == t.segments:
                                # A light on a live effect: its frame for the level it follows, or its
                                # burst's frame since the last beat, as bright as the level says.
                                k, scale = shown[t.device]
                                frame = self._spectrum(lt).frame(self.live, k) if lt.kind == "spectrum" else self.live.track_frame(lt, k)
                                if scale < 20:
                                    frame = frame.translate(self._scale_table(scale))
                            else:
                                frame = self._variant_frame(source, t, elapsed) if source else None
                                frame = frame or b.track_frame(t, idx)
                            out = frame.translate(table) if table else frame
                            self.sent[t.device] = out
                            dev.update(out)
                last = key
            await asyncio.sleep(frame_s / 4)
        log.info("%s finished", f"show {self.show_id}" if self.show_id else "block")
        if self.length is not None and math.isfinite(self.length):
            # A block: the next one may follow straight on (play() then keeps the lights it shares).
            self._let_go = asyncio.get_running_loop().call_later(HOLD_S, self._release_held)
        else:
            self.output.release_all()

    def _release_held(self):
        self._let_go = None
        if not self.playing:
            self.output.release_all()
