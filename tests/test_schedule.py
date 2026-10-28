import asyncio
from datetime import datetime

import pytest

from halidayshow import baked, playlists
from halidayshow.output import Output
from halidayshow.player import Player
from halidayshow.runner import Runner
from halidayshow.schedule import Scheduler, next_start, window_at
from halidayshow.storage import Storage

EVENINGS = {"on": True, "start": "17:00", "end": "22:00", "days": list(range(7)), "from": "", "to": ""}
SUN_OCT_25 = datetime(2026, 10, 25, 12, 0)  # a Sunday


def at(h, m=0, day=25, month=10):
    return datetime(2026, month, day, h, m)


def test_schedule_validation():
    assert playlists.clean_schedule({**EVENINGS, "days": [6, 0, 0]})["days"] == [0, 6]
    for bad in ({**EVENINGS, "start": "25:00"}, {**EVENINGS, "end": "17:00"}, {**EVENINGS, "days": [7]},
                {**EVENINGS, "days": [True]}, {**EVENINGS, "from": "10-25"}, {**EVENINGS, "from": "02-30", "to": "03-01"},
                "evenings"):
        assert playlists.clean_schedule(bad) is None, bad
    assert playlists.clean_schedule({**EVENINGS, "from": "02-29", "to": "03-01"})
    # Playlists from before schedules load as they were; a broken schedule is refused.
    base = {"id": "p", "name": "P", "shows": [], "gap": 5}
    assert "schedule" not in playlists.clean(base)
    assert playlists.clean({**base, "schedule": EVENINGS})["schedule"] == EVENINGS
    assert playlists.clean({**base, "schedule": {"on": True}}) is None


def test_windows():
    assert window_at(EVENINGS, at(18)) == (at(17), at(22))
    assert window_at(EVENINGS, at(16, 59)) is None and window_at(EVENINGS, at(22)) is None
    assert window_at({**EVENINGS, "on": False}, at(18)) is None
    assert next_start(EVENINGS, at(18)) == at(17, day=26)
    assert next_start(EVENINGS, at(9)) == at(17)


def test_past_midnight_belongs_to_the_day_it_started():
    late = {**EVENINGS, "start": "20:00", "end": "01:00", "days": [5]}  # Saturdays
    assert window_at(late, at(0, 30, day=25)) == (at(20, day=24), at(1, day=25))  # Sunday 00:30
    assert window_at(late, at(23, day=25)) is None  # Sunday evening isn't scheduled


def test_days_and_dates_including_over_new_year():
    weekends = {**EVENINGS, "days": [5, 6]}
    assert window_at(weekends, at(18, day=25)) and not window_at(weekends, at(18, day=26))
    halloween = {**EVENINGS, "from": "10-25", "to": "10-31"}
    assert window_at(halloween, at(18, day=31)) and not window_at(halloween, at(18, day=1, month=11))
    assert next_start(halloween, at(23, day=31)) == datetime(2027, 10, 25, 17, 0)
    christmas = {**EVENINGS, "from": "12-01", "to": "01-06"}
    assert window_at(christmas, datetime(2027, 1, 6, 18)) and not window_at(christmas, datetime(2027, 1, 7, 18))
    assert not window_at(christmas, at(18, day=30, month=11)) and window_at(christmas, at(18, day=1, month=12))


@pytest.fixture
async def setup(tmp_path):
    storage = Storage(tmp_path / "config", tmp_path / "media")
    storage.save_devices([{"id": "a", "ip": "127.0.0.1", "segments": 1}])
    for s in ("one", "two"):
        storage.save_show(s, {"name": s.title(), "tracks": []})
        storage.save_baked(s, baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\xff\x00"] * 400))
    output = Output()
    output.start()
    runner = Runner(storage, Player(output), None)
    yield storage, runner, Scheduler(storage, runner)
    await runner.stop()
    await output.close()


def save(storage, *lists):
    settings = storage.load_settings()
    settings["playlists"] = list(lists)
    storage.save_settings(settings)


async def started(runner):
    """Let the playlist put its first show on."""
    for _ in range(50):
        if runner.player.playing:
            return
        await asyncio.sleep(0.02)


def pl(pid, schedule, shows=("one",)):
    return {"id": pid, "name": pid.title(), "shows": list(shows), "gap": 0, "schedule": schedule}


async def test_starts_at_the_start_and_finishes_the_show_at_the_end(setup):
    storage, runner, sched = setup
    save(storage, pl("night", EVENINGS))
    await sched.tick(at(16, 59))
    assert runner.status()["playlist"] is None
    await sched.tick(at(17))
    assert runner.status()["playlist"]["id"] == "night" and sched.state(at(17))["scheduled"] == "night"
    await started(runner)
    await sched.tick(at(22))
    assert runner.status()["playlist"]["finishing"] and runner.player.playing  # the 10 s show plays on
    await runner.player.stop(release=False)  # the show ends
    for _ in range(20):
        if runner.status()["playlist"] is None:
            break
        await asyncio.sleep(0.1)
    assert runner.status()["playlist"] is None


async def test_end_time_between_shows_stops_at_once(setup):
    storage, runner, sched = setup
    save(storage, pl("night", EVENINGS))
    await sched.tick(at(17))
    await started(runner)
    await runner.player.stop(release=False)  # into the pause
    await sched.tick(at(22))
    assert runner.status()["playlist"] is None


async def test_stopping_it_keeps_it_off_until_the_next_start(setup):
    storage, runner, sched = setup
    save(storage, pl("night", EVENINGS))
    await sched.tick(at(17))
    await runner.stop()
    await sched.tick(at(17, 1))
    await sched.tick(at(18))
    assert runner.status()["playlist"] is None
    await sched.tick(at(17, day=26))
    assert runner.status()["playlist"]["id"] == "night"


async def test_a_restart_during_the_evening_starts_it_again(setup):
    storage, runner, _ = setup
    save(storage, pl("night", EVENINGS))
    await Scheduler(storage, runner).tick(at(19))
    assert runner.status()["playlist"]["id"] == "night"


async def test_overlapping_playlists_take_turns_in_list_order(setup):
    storage, runner, sched = setup
    early = pl("early", {**EVENINGS, "end": "19:00"})
    late = pl("late", {**EVENINGS, "start": "18:00"}, shows=("two",))
    save(storage, early, late)
    await sched.tick(at(17))
    await started(runner)
    await sched.tick(at(18))
    assert runner.status()["playlist"]["id"] == "early"
    await sched.tick(at(19))  # early's time is up: its show finishes, then late starts
    assert runner.status()["playlist"]["finishing"]
    await runner.player.stop(release=False)
    await asyncio.sleep(0.4)
    await sched.tick(at(19, 0))
    assert runner.status()["playlist"]["id"] == "late"


async def test_turning_the_schedule_off_finishes_it(setup):
    storage, runner, sched = setup
    save(storage, pl("night", EVENINGS))
    await sched.tick(at(17))
    await started(runner)
    save(storage, pl("night", {**EVENINGS, "on": False}))
    await sched.tick(at(17, 1))
    assert runner.status()["playlist"]["finishing"]


async def test_changing_the_times_during_the_evening_moves_the_end(setup):
    storage, runner, sched = setup
    save(storage, pl("night", EVENINGS))
    await sched.tick(at(17))
    await started(runner)
    save(storage, pl("night", {**EVENINGS, "start": "16:00", "end": "23:00"}))  # earlier start, later end
    await sched.tick(at(21, 30))
    await sched.tick(at(22))
    assert runner.status()["playlist"] == {"id": "night", "name": "Night", "finishing": False}
    assert runner.player.show_id == "one"  # not restarted
    save(storage, pl("night", {**EVENINGS, "end": "22:30"}))
    await sched.tick(at(22, 30))
    assert runner.status()["playlist"]["finishing"]


async def test_a_playlist_put_on_by_hand_before_its_start_carries_on(setup):
    storage, runner, sched = setup
    save(storage, pl("night", EVENINGS, shows=("one", "two")))
    await runner.play_playlist(pl("night", EVENINGS, shows=("one", "two")))
    await started(runner)
    task = runner._playlist
    await sched.tick(at(17))
    assert runner._playlist is task  # not started again from the top
    await sched.tick(at(22))
    assert runner.status()["playlist"]["finishing"]


def test_a_broken_schedule_in_the_file_keeps_the_playlist(tmp_path):
    storage = Storage(tmp_path / "c", tmp_path / "m")
    save(storage, {"id": "p", "name": "P", "shows": ["one"], "gap": 5, "schedule": {"on": True}})
    assert playlists.load(storage) == [{"id": "p", "name": "P", "shows": ["one"], "gap": 5.0, "items": [
        {"type": "show", "id": "one"}, {"type": "pause", "id": "pause-1", "seconds": 5.0}]}]


SUNSET = {**EVENINGS, "start": "sunset", "offset": -15}


def test_sunset_schedule_validation():
    assert playlists.clean_schedule(SUNSET)["offset"] == -15
    assert "offset" not in playlists.clean_schedule({**EVENINGS, "offset": 30})  # only for sunset
    for bad in ({**SUNSET, "offset": 181}, {**SUNSET, "offset": "10"}, {**SUNSET, "offset": True},
                {**SUNSET, "start": "dusk"}):
        assert playlists.clean_schedule(bad) is None, bad


def test_sunset_windows(monkeypatch):
    # Sunset moves a minute a day; the window starts 15 minutes before it.
    monkeypatch.setattr("halidayshow.schedule.sunset_local",
                        lambda d, lat, lon: datetime(d.year, d.month, d.day, 16, 48 - (d.day - 25)))
    here = (51.5, -0.13)
    assert window_at(SUNSET, at(16, 40), here) == (at(16, 33), at(22))
    assert window_at(SUNSET, at(16, 30), here) is None
    assert next_start(SUNSET, at(18), here) == at(16, 32, day=26)
    assert window_at(SUNSET, at(16, 40)) is None and next_start(SUNSET, at(12)) is None  # no place, no sunset
    monkeypatch.setattr("halidayshow.schedule.sunset_local", lambda d, lat, lon: None)  # polar night
    assert next_start(SUNSET, at(12), here) is None


class FakeHA:
    available = True

    def __init__(self, config):
        self._config, self.asked = config, 0

    async def config(self):
        self.asked += 1
        return self._config


async def test_location_from_settings_else_home_assistant(setup, monkeypatch):
    storage, runner, sched = setup
    assert sched.where() == (None, None) and sched.state(at(12))["location"] is None
    runner.ha = FakeHA({"latitude": 51.5, "longitude": -0.13})
    await sched.refresh_ha_location()
    await sched.refresh_ha_location()  # once an hour is plenty
    assert runner.ha.asked == 1 and sched.where() == ((51.5, -0.13), "ha")
    settings = storage.load_settings()
    settings["location"] = {"lat": 40.7, "lon": -74.0}
    storage.save_settings(settings)
    assert sched.where() == ((40.7, -74.0), "you")
    st = sched.state(at(12))
    assert st["location"]["source"] == "you" and len(st["sunset"]) == 5


async def test_a_sunset_playlist_starts_at_sunset(setup, monkeypatch):
    storage, runner, sched = setup
    monkeypatch.setattr("halidayshow.schedule.sunset_local", lambda d, lat, lon: datetime(d.year, d.month, d.day, 16, 48))
    settings = storage.load_settings()
    settings["location"] = {"lat": 51.5, "lon": -0.13}
    settings["playlists"] = [pl("night", {**SUNSET, "offset": 0})]
    storage.save_settings(settings)
    await sched.tick(at(16, 47))
    assert runner.status()["playlist"] is None
    await sched.tick(at(16, 48))
    assert runner.status()["playlist"]["id"] == "night"


def test_sunset_end_times(monkeypatch):
    here = (51.5, -0.13)
    sunsets = {25: 16, 21: 21}  # 25 Oct about 16:48; 21 Jun about 21:21
    monkeypatch.setattr("halidayshow.schedule.sunset_local",
                        lambda d, lat, lon: datetime(d.year, d.month, d.day, sunsets.get(d.day, 16), 21 if d.day == 21 else 48))
    late = {**SUNSET, "offset": 0, "end": "01:00"}
    assert window_at(late, at(0, 30, day=26), here) == (at(16, 48), at(1, day=26))  # the next morning
    nine = {**SUNSET, "offset": 0, "end": "21:00"}
    assert window_at(nine, at(18), here) == (at(16, 48), at(21))
    midsummer = datetime(2026, 6, 21, 21, 30)
    assert window_at(nine, midsummer, here) is None and window_at(nine, midsummer.replace(hour=10), here) is None
    assert next_start(nine, datetime(2026, 6, 21, 12), here) == datetime(2026, 6, 22, 16, 48)


def test_sunset_on_another_day_on_this_clock_is_matched_to_the_right_day(monkeypatch):
    # A place far from this machine's time zone: its sunset for the 21st lands at 05:15 on the 22nd here.
    monkeypatch.setattr("halidayshow.schedule.sunset_local",
                        lambda d, lat, lon: datetime(d.year, d.month, d.day, 5, 15) + __import__("datetime").timedelta(days=1))
    from halidayshow.schedule import start_on
    assert start_on({**SUNSET, "offset": 0}, at(0).date(), (20.0, -157.0)) == at(5, 15)


async def test_home_assistant_location_retried_soon_after_a_failure(setup):
    _, runner, sched = setup

    class Flaky(FakeHA):
        async def config(self):
            self.asked += 1
            if self.asked == 1:
                from halidayshow.ha import HAError
                raise HAError("starting")
            return self._config
    runner.ha = Flaky({"latitude": 51.5, "longitude": -0.13})
    await sched.refresh_ha_location()
    assert sched.ha_where is None
    sched._ha_checked -= 61
    await sched.refresh_ha_location()
    assert sched.ha_where == (51.5, -0.13)


def test_playlist_items_and_what_older_versions_read():
    items = [{"type": "show", "id": "one"}, {"type": "pause", "id": "b1", "seconds": 8},
             {"type": "colour", "id": "b2", "seconds": 10, "colour": "#FF8800"},
             {"type": "off", "id": "b3", "seconds": 2.25},
             {"type": "effect", "id": "b4", "seconds": 30, "effect": "twinkle",
              "params": {"color": "#ffffff", "density": 30, "direction": "forward"}},
             {"type": "show", "id": "two"}]
    p = playlists.clean({"id": "p", "name": "P", "items": items})
    assert p["shows"] == ["one", "two"] and p["gap"] == 8  # the pause after the first show
    assert p["items"][2]["colour"] == "#ff8800" and p["items"][3]["seconds"] == 2.2
    assert playlists.block_ids([p]) == {"b2", "b3", "b4"}  # a pause has nothing to bake
    assert playlists.clean({"id": "p", "name": "P", "items": [{"type": "show", "id": "one"},
                                                              {"type": "off", "id": "b", "seconds": 1}]})["gap"] == 0
    for bad in ({"type": "colour", "id": "b", "seconds": 5, "colour": "red"},
                {"type": "off", "id": "b", "seconds": 0},
                {"type": "off", "id": "b", "seconds": 3601},
                {"type": "off", "id": "Bad Id", "seconds": 1},
                {"type": "disco", "id": "b", "seconds": 1},
                {"type": "effect", "id": "b", "seconds": 1, "effect": "../x", "params": {}},
                {"type": "effect", "id": "b", "seconds": 1, "effect": "twinkle", "params": {"x": [1]}},
                {"type": "effect", "id": "b", "seconds": 1, "effect": "twinkle", "params": {"on": True}}):
        assert playlists.clean({"id": "p", "name": "P", "items": [bad]}) is None, bad
        # In the file, a broken block is dropped rather than the playlist.
        assert playlists.clean({"id": "p", "name": "P", "items": [bad, items[0]]}, strict=False)["shows"] == ["one"]
    assert playlists.clean({"id": "p", "name": "P", "items": [items[2], items[2]]}) is None  # same block twice
    kept = playlists.clean({"id": "p", "name": "P", "items": [items[2], items[0], items[2]]}, strict=False)
    assert [x["id"] for x in kept["items"]] == ["b2", "one"]  # in the file, the copy goes, not the playlist


def test_taking_a_deleted_show_out_keeps_the_pauses_tidy():
    legacy = playlists.from_shows(["a", "b", "c"], 5)
    assert [x.get("id") for x in playlists.without_show(legacy, "b")] == ["a", "pause-1", "c", "pause-3"]
    assert [x.get("id") for x in playlists.without_show(legacy, "a")] == ["b", "pause-2", "c", "pause-3"]
    blocks = [{"type": "show", "id": "a"}, {"type": "off", "id": "x", "seconds": 1},
              {"type": "show", "id": "b"}, {"type": "pause", "id": "p", "seconds": 1}]
    assert [x["id"] for x in playlists.without_show(blocks, "b")] == ["a", "x", "p"]


# Scenes on a schedule ---------------------------------------------------------------------------
def scene(storage, sid, schedule):
    storage.save_scene(sid, {"name": sid.title(), "mode": "basic", "lights": {}, "schedule": schedule})
    storage.save_scene_baked(sid, baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 4))


SUNSET_TO_MIDNIGHT_ISH = {"on": True, "start": "16:00", "end": "00:00", "days": list(range(7)), "from": "", "to": ""}


async def test_a_scene_comes_on_at_its_start_and_goes_off_at_its_end(setup):
    storage, runner, sched = setup
    scene(storage, "glow", SUNSET_TO_MIDNIGHT_ISH)
    await sched.tick(at(15, 59))
    assert runner.scene is None
    await sched.tick(at(16))
    assert runner.scene_playing and runner.scene["id"] == "glow"
    assert sched.state(at(16))["scene_scheduled"] == "glow"
    await sched.tick(at(23, 59))
    assert runner.scene_playing
    await sched.tick(at(0, 0, day=26))
    assert runner.scene is None and not runner.player.playing


async def test_a_playlist_takes_over_and_the_scene_comes_back(setup):
    storage, runner, sched = setup
    scene(storage, "glow", SUNSET_TO_MIDNIGHT_ISH)
    save(storage, pl("night", {**EVENINGS, "start": "18:00", "end": "20:00"}))
    await sched.tick(at(16))
    assert runner.scene_playing
    await sched.tick(at(18))
    await started(runner)
    assert runner.status()["playlist"]["id"] == "night" and not runner.scene_playing
    assert runner.scene["id"] == "glow"  # waiting to come back
    await sched.tick(at(19))  # still the scene's time: nothing changes
    assert runner.scene["id"] == "glow"


async def test_a_scene_due_during_a_show_waits_for_it(setup):
    storage, runner, sched = setup
    scene(storage, "glow", SUNSET_TO_MIDNIGHT_ISH)
    await runner.play("one")
    await sched.tick(at(16))
    assert runner.player.show_id == "one" and runner.scene["id"] == "glow" and not runner.scene_playing


async def test_a_scene_you_turn_off_stays_off_until_its_next_start(setup):
    storage, runner, sched = setup
    scene(storage, "glow", SUNSET_TO_MIDNIGHT_ISH)
    await sched.tick(at(16))
    await runner.stop_scene()
    await sched.tick(at(17))
    assert runner.scene is None
    await sched.tick(at(16, 0, day=26))
    assert runner.scene_playing


async def test_a_scene_schedule_is_checked_like_a_playlists():
    from halidayshow import scenelib
    s = scenelib.clean_scene({"name": "Glow", "lights": {}, "schedule": SUNSET_TO_MIDNIGHT_ISH})
    assert s["schedule"]["start"] == "16:00"
    with pytest.raises(scenelib.SceneError):
        scenelib.clean_scene({"name": "Glow", "lights": {}, "schedule": {"on": True, "start": "25:00"}})
