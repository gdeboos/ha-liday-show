"""The pre-show check's timing test: every light flashes white once a second while phones listening on
the visitors' page beep with it, so you can tell whether the two land together and set the phones'
timing for everyone (public settings "listen_offset").

It plays like a show (the player and phones listening follow it the same way) but is made here, as a
test pattern is, rather than baked by the editor: it's the same flash on every light, and nothing of
it is saved.
"""
import io
import math
import struct
import tempfile
import wave
from pathlib import Path

from .baked import encode

TIMING_ID = "_timing_test"
NAME = "Timing test"
SECONDS = 30
FPS = 40
FLASH_S = 0.12
BEEP_S = 0.08
BEEP_HZ = 1000
RATE = 22050


def beats(seconds: float = SECONDS) -> list[float]:
    """When the flashes and beeps come: every whole second, from one second in."""
    return [float(k) for k in range(1, int(seconds))]


def baked(devices: list[dict], seconds: float = SECONDS) -> bytes:
    """Every light white for FLASH_S on each beat, dark between."""
    tracks = [{"device": d["id"], "segments": int(d["segments"])} for d in devices]
    on = b"".join(b"\xff\xff\xff" * t["segments"] for t in tracks)
    off = bytes(len(on))
    frames = [on if (t := i / FPS) >= 1 and t % 1 < FLASH_S else off for i in range(int(seconds * FPS))]
    return encode(FPS, tracks, frames)


def song_bytes(seconds: float = SECONDS) -> bytes:
    """A WAV of short beeps on each beat (faded in and out over 5 ms, so they don't click)."""
    n, beep, fade = int(seconds * RATE), int(BEEP_S * RATE), int(0.005 * RATE)
    samples = bytearray(n * 2)
    for b in beats(seconds):
        start = int(b * RATE)
        for i in range(min(beep, n - start)):
            env = min(1.0, i / fade, (beep - i) / fade)
            v = int(12000 * env * math.sin(2 * math.pi * BEEP_HZ * i / RATE))
            struct.pack_into("<h", samples, (start + i) * 2, v)
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(samples))
    return out.getvalue()


def song_path() -> Path:
    """The beeps, written once to the temporary folder (never into backups), as phones are sent a file."""
    p = Path(tempfile.gettempdir()) / f"haliday-timing-test-{SECONDS}s.wav"
    if not p.is_file():
        tmp = p.with_suffix(".part")
        tmp.write_bytes(song_bytes())
        tmp.replace(p)
    return p
