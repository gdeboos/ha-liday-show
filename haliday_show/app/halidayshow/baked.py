"""Baked show file: every frame precomputed by the editor.

Layout (big endian):
  b"GVSF"  magic
  u8       format version (1)
  u32      header length
  bytes    header JSON: {"fps": 40, "frames": N, "tracks": [{"device": id, "segments": n}, ...]}
           (a scene's live set also gives each track "kind" and "follows"; liveeffects.py)
  N frames, each the tracks' r g b bytes concatenated in track order (segments * 3 per track)

Files baked before 0.2.207 may also list Govee scenes in the header ("scenes"); they're no longer
played, and start-up blanks those frames (migrate.drop_govee_scenes).
"""
import json
import struct
from dataclasses import dataclass
from pathlib import Path

MAGIC = b"GVSF"
VERSION = 1
MAX_FPS = 60


class BakedError(ValueError):
    pass


@dataclass
class Track:
    device: str
    segments: int
    offset: int  # byte offset inside a frame
    kind: str = ""  # a scene's live set (liveeffects.py): "level" or "burst"
    follows: str = ""  # and what it follows: loudness, bass, mid or treble
    count: int = 0  # and how many of the frames are its own
    regions: list | None = None  # Spectrum: each LED's region, and each region's bands [first, last + 1)
    bands: list | None = None

    @property
    def size(self) -> int:
        return self.segments * 3


@dataclass
class Baked:
    fps: int
    frames: int
    tracks: list[Track]
    data: bytes
    stride: int

    @property
    def duration(self) -> float:
        return self.frames / self.fps

    def track_frame(self, track: Track, index: int) -> bytes:
        start = index * self.stride + track.offset
        return self.data[start: start + track.size]


def encode(fps: int, tracks: list[dict], frames: list[bytes], extra: dict | None = None) -> bytes:
    """Used by tests and tooling; the editor writes the same layout in JS. `extra` adds header fields."""
    head = {"fps": fps, "frames": len(frames), "tracks": tracks, **(extra or {})}
    header = json.dumps(head).encode()
    return MAGIC + struct.pack(">BI", VERSION, len(header)) + header + b"".join(frames)


def decode(blob: bytes) -> Baked:
    if len(blob) < 9 or blob[:4] != MAGIC:
        raise BakedError("not a baked show file")
    version, hlen = struct.unpack(">BI", blob[4:9])
    if version != VERSION:
        raise BakedError(f"unsupported baked format version {version}")
    try:
        header = json.loads(blob[9: 9 + hlen])
        fps, frames = int(header["fps"]), int(header["frames"])
        raw_tracks = header["tracks"]
    except (ValueError, KeyError, TypeError) as e:
        raise BakedError(f"bad header: {e}") from e
    if not 1 <= fps <= MAX_FPS or frames < 0:
        raise BakedError("bad fps or frame count")
    tracks, offset = [], 0
    for t in raw_tracks:
        segments = int(t["segments"])
        if not 1 <= segments <= 4096:  # see server.MAX_MATRIX
            raise BakedError("segment count must be 1-4096")
        tracks.append(Track(str(t["device"]), segments, offset, str(t.get("kind") or ""), str(t.get("follows") or ""),
                            int(t.get("count") or 0), t.get("regions"), t.get("bands")))
        offset += segments * 3
    data = blob[9 + hlen:]
    if len(data) != frames * offset:
        raise BakedError(f"expected {frames * offset} bytes of frames, got {len(data)}")
    return Baked(fps, frames, tracks, data, offset)


def read_header(path: Path) -> dict | None:
    """A baked file's header only, without reading its frames; None if it isn't one."""
    try:
        with path.open("rb") as f:
            head = f.read(9)
            if len(head) < 9 or head[:4] != MAGIC:
                return None
            _, hlen = struct.unpack(">BI", head[4:9])
            if hlen > 16 * 1024 * 1024:
                return None
            header = json.loads(f.read(hlen))
    except (OSError, ValueError):
        return None
    return header if isinstance(header, dict) else None


_HEX = set("0123456789abcdef")


def phone_colours(header: dict | None) -> dict | None:
    """What visitors' phones show (static/js/phones.js): {"fps", "colours"} ("rrggbb" each), or None for a
    bake from before 0.2.367 or one that isn't right."""
    phones = (header or {}).get("phones")
    if not isinstance(phones, dict):
        return None
    fps, colours = phones.get("fps"), phones.get("colours")
    if not (isinstance(fps, int) and 1 <= fps <= MAX_FPS and isinstance(colours, str) and len(colours) % 6 == 0
            and set(colours) <= _HEX):
        return None
    out = {"fps": fps, "colours": colours}
    # With a Phones lane using House colour: the house's own main colour, for phones to draw the lane with.
    house = phones.get("house")
    if isinstance(house, str) and len(house) == len(colours) and set(house) <= _HEX:
        out["house"] = house
    return out
