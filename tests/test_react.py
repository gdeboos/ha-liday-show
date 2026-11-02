import pytest

from halidayshow import react
from halidayshow.scenelib import SceneError, clean_scene


def lv(loud, beat_at=None, bass=0, treble=0):
    return {"loudness": loud, "bass": bass, "treble": treble, "beat_at": beat_at}


def test_react_settings_are_checked_with_defaults():
    assert react.clean({"on": True}) == {"on": True, "quiet": 20, "flash": True, "strength": 60,
                                         "bass": "", "treble": "", "quietSecs": 4}
    assert react.clean({"on": True, "quiet": 5, "bass": "red-pulse", "quietSecs": 10})["bass"] == "red-pulse"
    for bad in ("on", {"quiet": 150}, {"strength": 0}, {"quietSecs": 0}, {"bass": "Bad id!"}):
        with pytest.raises(ValueError):
            react.clean(bad)
    scene = clean_scene({"name": "Glow", "mode": "basic", "lights": {}, "react": {"on": True}})
    assert scene["react"]["on"] is True
    assert "react" not in clean_scene({"name": "Glow", "mode": "basic", "lights": {}})
    with pytest.raises(SceneError):
        clean_scene({"name": "Glow", "mode": "basic", "lights": {}, "react": {"quiet": "x"}})


def test_loudness_sets_brightness_and_a_beat_flashes():
    r = react.Reactor(react.clean({"on": True, "quiet": 20}), threshold=15)
    for k in range(40):  # settle at a steady loudness
        out = r.step(lv(100), k * 0.025)
    assert out.look == "plain" and out.level == pytest.approx(100, abs=2) and out.flash == 0
    for k in range(40):
        out = r.step(lv(50), 1 + k * 0.025)
    assert out.level == pytest.approx(60, abs=2)  # half way between the quietest 20% and full
    out = r.step(lv(50, beat_at=2.0), 2.0)
    assert out.flash == pytest.approx(0.6)
    assert r.step(lv(50, beat_at=2.0), 2.1).flash < 0.6  # dies away
    assert r.step(lv(50, beat_at=2.0), 2.4).flash == 0
    off = react.Reactor(react.clean({"on": True, "flash": False}), threshold=15)
    assert off.step(lv(50, beat_at=0.0), 0.0).flash == 0


def test_strong_bass_or_treble_switch_to_their_scenes_and_back():
    r = react.Reactor(react.clean({"on": True, "bass": "deep", "treble": "sparkle"}), threshold=15)
    assert r.step(lv(60, bass=85, treble=20), 0.0).look == "bass"
    assert r.step(lv(60, bass=30, treble=20), 0.5).look == "bass"  # held for at least a second
    assert r.step(lv(60, bass=30, treble=20), 1.6).look == "plain"
    assert r.step(lv(60, bass=20, treble=80), 1.7).look == "treble"
    plain = react.Reactor(react.clean({"on": True}), threshold=15)  # no scenes picked: never switches
    assert plain.step(lv(60, bass=95), 0.0).look == "plain"


def test_silence_glides_back_to_the_plain_scene_at_normal_brightness():
    r = react.Reactor(react.clean({"on": True, "quiet": 20, "quietSecs": 2, "bass": "deep"}), threshold=15)
    r.step(lv(60, bass=90), 0.0)
    for k in range(40):
        out = r.step(lv(5), 0.1 + k * 0.05)  # 2 s of quiet
    assert out.look == "plain"
    for k in range(40):
        out = r.step(lv(5), 2.2 + k * 0.05)
    assert out.level == pytest.approx(100, abs=2)
    assert r.step(None, 5.0).level == pytest.approx(100, abs=2)  # no WLED heard at all: plain too


def test_levels_move_in_whole_steps_so_a_steady_scene_isnt_resent_every_frame():
    r = react.Reactor({**react.DEFAULTS, "on": True})
    outs = [r.step({"loudness": 47, "bass": 0, "treble": 0, "beat_at": 9.97}, 10 + i / 40) for i in range(80)]
    assert all(o.level == int(o.level) for o in outs)
    assert all(round(o.flash * 20) == o.flash * 20 for o in outs)
    assert len({o for o in outs[-20:]}) == 1  # settled: the same every frame, so nothing new goes out
