"""Scenes (scenelib.py): saving, checking, and playing them round and round with the runner."""
import asyncio

import pytest

from halidayshow import baked, runner as runner_mod, scenelib
from halidayshow.output import Output
from halidayshow.player import Player
from halidayshow.runner import Runner, RunnerError
from halidayshow.storage import Storage


class FakeHA:
    available = True

    async def call(self, domain, service, data):
        pass

    async def state(self, entity):
        return {"state": "idle", "attributes": {}}


def _scene(storage, scene_id="glow", name="Glow"):
    storage.save_scene(scene_id, {"name": name, "mode": "basic", "lights": {"a": {"effect": "solid", "params": {}}}})
    storage.save_scene_baked(scene_id, baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 4))


def _show(storage, show_id, frames=4):
    storage.save_show(show_id, {"name": show_id.title(), "tracks": []})
    storage.save_baked(show_id, baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\xff\x00"] * frames))


async def _until(check, tries=100):
    for _ in range(tries):
        if check():
            return True
        await asyncio.sleep(0.05)
    return False


@pytest.fixture
async def runner(tmp_path, monkeypatch):
    monkeypatch.setattr(runner_mod, "SCENE_BACK_S", 0.1)
    storage = Storage(tmp_path / "config", tmp_path / "media")
    storage.save_devices([{"id": "a", "ip": "127.0.0.1", "segments": 1}])
    output = Output()
    output.start()
    r = Runner(storage, Player(output), FakeHA())
    watcher = asyncio.create_task(r.watch_scene())
    yield r
    watcher.cancel()
    await r.stop()
    await output.close()


def test_clean_scene_keeps_what_the_editor_needs():
    s = scenelib.clean_scene({"name": "  Candy   cane ", "mode": "basic", "extra": 1,
                              "lights": {"192.168.2.155": {"effect": "chase", "params": {"color": "#ff0000", "speed": 3}}},
                              "all": {"effect": "rainbow", "params": {}}})
    assert s == {"name": "Candy cane", "mode": "basic",
                 "lights": {"192.168.2.155": {"effect": "chase", "params": {"color": "#ff0000", "speed": 3}}},
                 "all": {"effect": "rainbow", "params": {}}}


@pytest.mark.parametrize("body", [
    None, {"name": ""}, {"name": "x", "mode": "fancy"}, {"name": "x", "lights": []},
    {"name": "x", "lights": {"a": {"effect": "Bad Effect"}}},
    {"name": "x", "lights": {"a": {"effect": "solid", "params": {"x": [1]}}}},
    {"name": "x", "all": {"effect": "solid", "params": "no"}},
])
def test_clean_scene_turns_down_odd_scenes(body):
    with pytest.raises(scenelib.SceneError):
        scenelib.clean_scene(body)


def test_storage_lists_saves_and_deletes_scenes(tmp_path):
    storage = Storage(tmp_path / "config", tmp_path / "media")
    assert storage.list_scenes() == []
    _scene(storage)
    [row] = storage.list_scenes()
    assert row["id"] == "glow" and row["name"] == "Glow" and row["baked"]
    storage.save_scene("glow", {"name": "Glow", "mode": "basic", "lights": {}})
    assert not storage.list_scenes()[0]["baked"]  # a changed scene waits for a new bake
    assert storage.new_scene_id("Glow") == "glow-2"
    assert storage.delete_scene("glow") and storage.list_scenes() == []


async def test_a_scene_plays_round_and_round(runner):
    _scene(runner.storage)
    await runner.play_scene("glow")
    await asyncio.sleep(0.3)  # its frames last 0.1 s
    st = runner.status()
    assert runner.player.playing and st["scene"] == {"id": "glow", "name": "Glow", "playing": True}
    assert st["name"] == "Glow" and st["duration"] == pytest.approx(0.1)
    assert runner.storage.load_settings()["last_scene"] == "glow"


async def test_a_scene_that_hasnt_been_saved_in_the_editor(runner):
    runner.storage.save_scene("bare", {"name": "Bare", "mode": "basic", "lights": {}})
    with pytest.raises(RunnerError):
        await runner.play_scene("bare")


async def test_the_scene_comes_back_after_a_show(runner):
    _scene(runner.storage)
    _show(runner.storage, "one", frames=8)
    await runner.play_scene("glow")
    await runner.play("one")
    st = runner.status()
    assert runner.player.show_id == "one" and st["scene"]["playing"] is False
    assert await _until(lambda: runner.scene_playing)  # the show ends, the scene comes back
    assert runner.player.show_id is None and runner.player.playing


async def test_the_scene_comes_back_when_a_show_is_stopped(runner):
    _scene(runner.storage)
    _show(runner.storage, "long", frames=4000)
    await runner.play_scene("glow")
    await runner.play("long")
    await runner.stop()
    assert await _until(lambda: runner.scene_playing)


async def test_stopping_the_scene_itself_turns_it_off(runner):
    _scene(runner.storage)
    await runner.play_scene("glow")
    await runner.stop()
    await asyncio.sleep(0.4)
    assert runner.scene is None and not runner.player.playing


async def test_the_editor_stopping_its_show_leaves_the_scene_alone(runner):
    _scene(runner.storage)
    await runner.play_scene("glow")
    await runner.stop(show="one")  # the editor's show ended long ago
    assert runner.scene_playing


async def test_stop_scene_while_a_show_is_on_keeps_the_show(runner):
    _scene(runner.storage)
    _show(runner.storage, "long", frames=4000)
    await runner.play_scene("glow")
    await runner.play("long")
    await runner.stop_scene("glow")
    assert runner.scene is None and runner.player.show_id == "long"
    await runner.stop()
    await asyncio.sleep(0.4)
    assert not runner.player.playing


async def test_the_scene_waits_while_a_light_is_being_previewed(runner):
    _scene(runner.storage)
    await runner.play_scene("glow")
    await runner._stop()  # as a show ending would leave it, the scene still wanted
    runner.player.output.claim("10.0.0.9", 1)  # a test or preview on a light
    await asyncio.sleep(0.4)
    assert not runner.scene_playing
    runner.player.output.release("10.0.0.9")
    assert await _until(lambda: runner.scene_playing)
