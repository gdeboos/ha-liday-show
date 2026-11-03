"""Live music effects (liveeffects.py): the live set and the levels the player shows."""
from halidayshow import baked, liveeffects


def _set(tracks=None, frames=21):
    tracks = tracks or [{"device": "w", "segments": 2, "kind": "level", "follows": "treble"}]
    return baked.encode(1, tracks, [bytes(sum(t["segments"] for t in tracks) * 3)] * frames)


def test_a_live_set_is_checked_before_use():
    live = liveeffects.load(_set())
    assert live.tracks[0].follows == "treble" and live.frames == 21
    for bad in (None, b"", b"nonsense", _set(frames=20), _set([{"device": "w", "segments": 2}]),
                _set([{"device": "w", "segments": 2, "kind": "level", "follows": "vocals"}])):
        assert liveeffects.load(bad) is None


def test_levels_glide_with_the_music_and_go_idle_when_it_stops():
    f = liveeffects.Follower(threshold=15)
    assert f.step(None, 0.0) is None  # no WLED heard: idle
    loud = {"loudness": 80, "bass": 100, "mid": 40, "treble": 0}
    first = f.step(loud, 1.0)  # just heard: gliding up from dark
    assert 0 < first["bass"] < 100 and first["treble"] == 0
    later = f.step(loud, 1.05)
    assert first["bass"] < later["bass"] < 100
    for k in range(10):
        last = f.step(loud, 1.1 + k * 0.1)
    assert last["bass"] == 100
    quiet = {"loudness": 5, "bass": 0, "mid": 0, "treble": 0}
    assert f.step(quiet, 3.0) is not None  # quiet for a moment: still showing (last heard at 2.0)
    assert f.step(quiet, 2.0 + liveeffects.QUIET_S + 0.1) is None  # quiet for a while: idle again
    assert liveeffects.frame_index(0) == 0 and liveeffects.frame_index(52) == 10 and liveeffects.frame_index(140) == 20
