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


async def test_a_test_or_preview_on_a_light_pauses_the_scene_rather_than_ending_it(runner):
    _scene(runner.storage)
    await runner.play_scene("glow")
    await runner.stop(keep_scene=True)  # as Test, the lab or a live preview do
    assert runner.scene and not runner.scene_playing
    assert await _until(lambda: runner.scene_playing)


async def test_a_scene_with_one_look_for_every_light_saves_as_it_was_sent(tmp_path):
    from aiohttp.test_utils import TestClient, TestServer
    from halidayshow import server
    app = server.make_app(tmp_path / "config", tmp_path / "media", allow_all=True)
    async with TestClient(TestServer(app)) as client:
        scene_id = (await (await client.post("/api/house-scenes", json={"name": "Party"})).json())["id"]
        body = {"name": "Party", "mode": "basic", "lights": {}, "all": {"effect": "rainbow", "params": {"speed": 2}}}
        assert (await client.put(f"/api/house-scenes/{scene_id}", json=body)).status == 200
        assert await (await client.get(f"/api/house-scenes/{scene_id}")).json() == body


def test_govee_scene_cache_files_are_not_taken_for_your_scenes(tmp_path):
    # Govee's scene library caches each model's list as scenes/<SKU>.json: a list, not a scene.
    cache = tmp_path / "config" / "scenes"
    cache.mkdir(parents=True)
    (cache / "H70C5.json").write_text('[{"name": "Forest", "code": 212}]')
    storage = Storage(tmp_path / "config", tmp_path / "media")
    assert storage.list_scenes() == []
    assert (cache / "H70C5.json").exists()


def test_scenes_saved_by_0_2_205_move_to_their_own_folder(tmp_path):
    old = tmp_path / "config" / "scenes"
    old.mkdir(parents=True)
    (old / "glow.json").write_text('{"name": "Glow", "mode": "basic", "lights": {}}')
    (old / "glow.gshow").write_bytes(baked.encode(40, [{"device": "a", "segments": 1}], [b"\\x00\\x00\\x00"]))
    (old / "H70C5.json").write_text("[]")
    storage = Storage(tmp_path / "config", tmp_path / "media")
    [row] = storage.list_scenes()
    assert row["id"] == "glow" and row["baked"]
    assert not (old / "glow.json").exists() and (old / "H70C5.json").exists()


def test_an_advanced_scene_keeps_its_loop_and_tracks():
    body = {"name": "Snow", "mode": "advanced", "loop": 20, "lights": {"x": {}},
            "tracks": [{"device": "@house", "clips": [{"effect": "sweep", "start": 0, "end": 20, "color": "#ffffff"}]},
                       {"device": "pillars#l", "clips": [{"effect": "twinkle", "start": 0, "end": 12, "density": 40,
                                                          "colors": ["#fff", "#00f"]}]}]}
    s = scenelib.clean_scene(body)
    assert s == {"name": "Snow", "mode": "advanced", "loop": 20.0, "tracks": body["tracks"]}


@pytest.mark.parametrize("body", [
    {"name": "x", "mode": "advanced", "loop": 0, "tracks": []},
    {"name": "x", "mode": "advanced", "loop": 10, "tracks": [{"device": "a", "clips": [{"effect": "solid", "start": 5, "end": 11}]}]},
    {"name": "x", "mode": "advanced", "loop": 10, "tracks": [{"device": "a", "clips": [{"effect": "Bad", "start": 0, "end": 1}]}]},
    {"name": "x", "mode": "advanced", "loop": 10, "tracks": "no"},
])
def test_odd_advanced_scenes_are_turned_down(body):
    with pytest.raises(scenelib.SceneError):
        scenelib.clean_scene(body)


async def test_the_show_editor_plays_a_scene_from_its_playhead(runner):
    _scene(runner.storage)
    await runner.play_scene("glow", position=0.05)
    assert runner.scene_playing and runner.player.position() >= 0.05


# Home Assistant: the light, a scene per scene, and commands ------------------------------------
class FakeClient:
    def __init__(self):
        self.published = {}

    async def publish(self, topic, payload, retain=False):
        self.published[topic] = payload


def test_home_assistant_gets_a_light_and_a_scene_each():
    from halidayshow import mqtt
    cfgs = mqtt.scene_configs([{"id": "glow", "name": "Glow"}, {"id": "snow", "name": "Snow"}])
    light = cfgs["homeassistant/light/haliday_show/scenes/config"]
    assert light["name"] is None and light["effect_list"] == ["Glow", "Snow"] and light["brightness_scale"] == 100
    scene = cfgs["homeassistant/scene/haliday_show/glow/config"]
    assert scene["name"] == "Glow" and scene["command_topic"] == "haliday_show/scene/glow/set"
    assert "effect_list" not in mqtt.scene_configs([])["homeassistant/light/haliday_show/scenes/config"]


async def test_the_light_turns_scenes_on_and_off_and_dims_them(runner):
    import json
    from halidayshow import mqtt
    _scene(runner.storage)
    _scene(runner.storage, "snow", "Snow")
    bridge = mqtt.MqttBridge(runner)
    bridge.client = FakeClient()
    await bridge._publish_all()
    assert json.loads(bridge.client.published["haliday_show/light/state"])["state"] == "OFF"
    await bridge._on_message("haliday_show/light/set", b'{"state": "ON", "effect": "Snow", "brightness": 40}')
    state = json.loads(bridge.client.published["haliday_show/light/state"])
    assert state == {"state": "ON", "brightness": 40, "color_mode": "brightness", "effect": "Snow"}
    assert runner.scene_playing and runner.player.level == 40
    await bridge._on_message("haliday_show/light/set", b'{"state": "OFF"}')
    assert runner.scene is None and not runner.player.playing
    # On by itself plays the last scene; a scene entity plays its own.
    await bridge._on_message("haliday_show/light/set", b'{"state": "ON"}')
    assert runner.scene["id"] == "snow"
    await bridge._on_message("haliday_show/scene/glow/set", b"ON")
    assert runner.scene["id"] == "glow"
    # A deleted scene's entity goes from Home Assistant.
    runner.storage.delete_scene("snow")
    await bridge._publish_all()
    assert bridge.client.published["homeassistant/scene/haliday_show/snow/config"] == b""


async def test_a_scene_asked_for_during_a_show_waits_for_it(runner):
    _scene(runner.storage)
    _show(runner.storage, "one", frames=12)
    await runner.play("one")
    await runner.want_scene("glow")
    assert runner.player.show_id == "one" and not runner.scene_playing  # the show carries on
    assert await _until(lambda: runner.scene_playing)


async def test_shows_play_at_full_brightness_whatever_the_scenes_level(runner):
    _scene(runner.storage)
    _show(runner.storage, "one", frames=400)
    runner.set_scene_level(30)
    await runner.play_scene("glow")
    assert runner.player.level == 30
    await runner.play("one")
    assert runner.player.level == 100


def test_the_player_dims_frames_without_touching_the_bake():
    from halidayshow.player import Player
    p = Player(Output())
    p.set_level(50)
    assert bytes([255, 100, 0]).translate(p._dim) == bytes([127, 50, 0])
    p.set_level(100)
    assert p._dim is None


async def test_automations_turn_scenes_on_and_off(runner):
    from halidayshow import commands
    _scene(runner.storage, "glow", "Candy cane")
    assert commands.parse("scene Candy cane") == {"action": "scene", "scene": "Candy cane"}
    assert await commands.handle(runner, "scene candy cane") == "scene glow"
    assert runner.scene_playing
    assert await commands.handle(runner, '{"action": "scene", "scene": "off"}') == "scene off"
    assert runner.scene is None
    with pytest.raises(ValueError):
        await commands.handle(runner, "scene Nope")


async def test_mqtt_only_plays_scenes_that_are_yours(runner):
    from halidayshow import mqtt
    _scene(runner.storage)
    bridge = mqtt.MqttBridge(runner)
    bridge.client = FakeClient()
    await bridge._publish_all()
    await bridge._on_message("haliday_show/scene/../settings/set", b"ON")
    await bridge._on_message("haliday_show/scene/gone/set", b"ON")
    assert runner.scene is None
