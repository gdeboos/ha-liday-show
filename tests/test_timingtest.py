import io
import struct
import wave

from halidayshow import timingtest
from halidayshow.baked import decode


def test_the_lights_flash_white_on_each_beat():
    b = decode(timingtest.baked([{"id": "a", "segments": 2}, {"id": "b", "segments": 3}], seconds=3))
    assert b.fps == timingtest.FPS and b.frames == 3 * timingtest.FPS
    lit = [i / b.fps for i in range(b.frames) if b.track_frame(b.tracks[1], i) == b"\xff" * 9]
    assert lit[0] == 1.0 and lit[-1] < 2 + timingtest.FLASH_S and all(t % 1 < timingtest.FLASH_S for t in lit)
    assert b.track_frame(b.tracks[0], 0) == bytes(6)  # dark before the first beat


def test_the_beeps_come_on_the_same_beats():
    with wave.open(io.BytesIO(timingtest.song_bytes(seconds=3))) as w:
        rate, data = w.getframerate(), w.readframes(w.getnframes())
    loud = [i / rate for i in range(len(data) // 2) if abs(struct.unpack_from("<h", data, i * 2)[0]) > 1000]
    assert 1.0 <= loud[0] < 1.01 and loud[-1] < 2 + timingtest.BEEP_S
    assert not [t for t in loud if t % 1 > timingtest.BEEP_S]
    assert timingtest.song_path().read_bytes()[:4] == b"RIFF"
