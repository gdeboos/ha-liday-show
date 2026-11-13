"""Scenes (scenelib.py): saving, checking, and playing them round and round with the runner."""
import asyncio

import pytest

from halidayshow import baked, react, runner as runner_mod, scenelib
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
    {"name": "x", "palette": "Christmas"}, {"name": "x", "palette": {"name": "", "colors": ["#ff0000"]}},
    {"name": "x", "palette": {"name": "P", "colors": []}}, {"name": "x", "palette": {"name": "P", "colors": ["red"]}},
    {"name": "x", "palette": {"name": "P", "colors": ["#ff0000"] * 13}},
])
def test_clean_scene_turns_down_odd_scenes(body):
    with pytest.raises(scenelib.SceneError):
        scenelib.clean_scene(body)


def test_a_scene_keeps_its_palette_in_either_mode():
    palette = {"name": " Candy ", "colors": ["#FF0000", "#ffffff"]}
    basic = scenelib.clean_scene({"name": "x", "lights": {}, "palette": palette})
    assert basic["palette"] == {"name": "Candy", "colors": ["#ff0000", "#ffffff"]}
    advanced = scenelib.clean_scene({"name": "x", "mode": "advanced", "loop": 20, "tracks": [], "palette": palette})
    assert advanced["palette"] == basic["palette"]
    # Scenes from before palettes have none.
    assert "palette" not in scenelib.clean_scene({"name": "x", "lights": {}})


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


def _pick(show_id):
    return {"id": f"r-{show_id}", "ticket": "t", "kind": "show", "ref": show_id, "name": show_id, "shows": [show_id], "gap": 0}


async def test_a_visitors_pick_takes_over_the_scene_and_the_scene_comes_back(runner):
    _scene(runner.storage)
    _show(runner.storage, "one", frames=8)
    await runner.play_scene("glow")
    runner.add_request(_pick("one"))
    assert await _until(lambda: runner.player.show_id == "one")  # not held back by the scene
    assert runner.scene["id"] == "glow" and not runner.scene_playing
    assert await _until(lambda: runner.scene_playing)  # the pick ends, the scene comes back
    assert runner.player.show_id is None


async def test_the_scene_comes_back_when_a_visitors_pick_is_skipped(runner):
    _scene(runner.storage)
    _show(runner.storage, "long", frames=4000)
    await runner.play_scene("glow")
    runner.add_request(_pick("long"))
    assert await _until(lambda: runner.player.show_id == "long")
    assert await runner.skip_request()
    assert await _until(lambda: runner.scene_playing)


async def test_a_scene_doesnt_count_towards_a_visitors_wait(runner):
    runner.storage.save_scene("glow", {"name": "Glow", "mode": "basic", "lights": {"a": {"effect": "solid", "params": {}}}})
    runner.storage.save_scene_baked("glow", baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 400))
    _show(runner.storage, "one", frames=400)
    await runner.play_scene("glow")  # a 10-second loop
    runner.requests.append(_pick("one"))  # waiting, without starting it
    assert runner.queue_waits() == [0]


async def test_the_scene_waits_while_visitors_votes_are_waiting(runner):
    _scene(runner.storage)
    runner.scene = {"id": "glow", "name": "Glow"}
    runner.votes["t"] = {"kind": "show", "ref": "one", "name": "One", "shows": ["one"], "gap": 0, "at": 0}
    await asyncio.sleep(1.6)  # the scene would be back by now (two of the watcher's half-second looks)
    assert not runner.scene_playing and runner.votes


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


# Scene blocks in playlists ----------------------------------------------------------------------
def test_a_scene_block_is_kept_with_its_scene():
    from halidayshow import playlists
    assert playlists.clean_item({"type": "scene", "id": "scene-1", "seconds": 60, "scene": "glow"}) == \
        {"type": "scene", "id": "scene-1", "seconds": 60.0, "scene": "glow"}
    assert playlists.clean_item({"type": "scene", "id": "scene-1", "seconds": 60}) is None
    assert playlists.clean_item({"type": "scene", "id": "scene-1", "seconds": 60, "scene": "../x"}) is None


async def test_a_playlist_plays_a_scene_block_dimmed_as_scenes_are(runner):
    _scene(runner.storage)
    runner.set_scene_level(50)
    played = await asyncio.wait_for(runner._play_block({"type": "scene", "id": "scene-1", "seconds": 0.2, "scene": "glow"}), 2)
    assert played and runner.scene is None  # a block, not the scene coming on
    _show(runner.storage, "one", frames=400)
    await runner.play("one")
    assert runner.player.level == 100


async def test_a_scene_block_whose_scene_has_gone_is_skipped(runner):
    assert await runner._play_block({"type": "scene", "id": "scene-1", "seconds": 5, "scene": "gone"}) is False


async def test_each_season_is_a_switch_in_home_assistant(runner):
    import json
    from halidayshow import mqtt, seasons
    runner.storage.save_devices([{"id": "a", "ip": "127.0.0.1", "segments": 1, "seasons": ["halloween"]}])
    bridge = mqtt.MqttBridge(runner)
    bridge.client = FakeClient()
    await bridge._publish_all()
    cfg = json.loads(bridge.client.published["homeassistant/switch/haliday_show/season_halloween/config"])
    assert cfg["name"] == "Halloween props out" and cfg["command_topic"] == "haliday_show/season/halloween/set"
    assert bridge.client.published["haliday_show/season/halloween/state"] == "ON"
    # Switched off from Home Assistant: packed away, so shows leave the prop out.
    await bridge._on_message("haliday_show/season/halloween/set", b"OFF")
    assert seasons.load(runner.storage.load_settings())[0]["out"] is False
    assert bridge.client.published["haliday_show/season/halloween/state"] == "OFF"
    assert "a" not in runner.storage.devices_by_id()
    await bridge._on_message("haliday_show/season/nope/set", b"OFF")  # not one of yours: ignored
    # A deleted season's switch goes from Home Assistant.
    settings = runner.storage.load_settings()
    settings["seasons"] = [s for s in seasons.load(settings) if s["id"] != "christmas"]
    runner.storage.save_settings(settings)
    await bridge._publish_all()
    assert bridge.client.published["homeassistant/switch/haliday_show/season_christmas/config"] == b""


class Heard:
    """A WLED with a microphone, as livemusic.LiveMusic.now() reports it."""
    def __init__(self, levels):
        self.levels, self.asked = levels, []

    def now(self, source="any"):
        self.asked.append(source)
        return self.levels


async def test_a_scene_with_react_to_music_follows_the_wled_and_stops_with_the_next_show(runner):
    _scene(runner.storage)
    _scene(runner.storage, "thump", "Thump")
    _show(runner.storage, "long", frames=4000)
    glow = runner.storage.load_scene("glow")
    glow["react"] = {**react.DEFAULTS, "on": True, "bass": "thump"}
    runner.storage.save_scene("glow", glow)
    runner.storage.save_scene_baked("glow", baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 4))
    settings = runner.storage.load_settings()
    settings["live_music"] = {"source": "10.0.0.9", "from": 15}
    runner.storage.save_settings(settings)
    runner.live = Heard({"loudness": 90, "bass": 95, "treble": 5, "beat_at": None})
    await runner.play_scene("glow")
    assert set(runner.player.variants) == {"bass"}
    assert runner.player.react().look == "bass"
    assert runner.live.asked[-1] == "10.0.0.9"
    await runner.play("long")
    assert runner.player.react is None
    await runner.stop()


async def test_a_scene_with_react_to_music_switched_off_plays_as_before(runner):
    _scene(runner.storage)
    glow = runner.storage.load_scene("glow")
    glow["react"] = {**react.DEFAULTS, "on": False}
    runner.storage.save_scene("glow", glow)
    runner.storage.save_scene_baked("glow", baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 4))
    runner.live = Heard(None)
    await runner.play_scene("glow")
    assert runner.player.react is None and runner.live.asked == []


async def test_changing_live_music_applies_to_the_scene_playing(runner, monkeypatch):
    monkeypatch.setattr(runner_mod, "LIVE_SETTINGS_EVERY_S", 0)
    _scene(runner.storage)
    glow = runner.storage.load_scene("glow")
    glow["react"] = {**react.DEFAULTS, "on": True}
    runner.storage.save_scene("glow", glow)
    runner.storage.save_scene_baked("glow", baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 4))
    runner.live = Heard({"loudness": 50, "bass": 0, "treble": 0, "beat_at": None})
    await runner.play_scene("glow")
    runner.player.react()
    settings = runner.storage.load_settings()
    settings["live_music"] = {"source": "10.0.0.7", "from": 60}
    runner.storage.save_settings(settings)
    runner.player.react()
    assert runner.live.asked[-1] == "10.0.0.7"


def test_which_lights_a_scene_hands_to_wled_s_own_effects():
    devices = {"w": {"id": "w", "kind": "wled"}, "g": {"id": "g", "kind": "govee"}}
    look = {"effect": "wled", "params": {"fx": 9, "speed": 200}}
    basic = {"mode": "basic", "lights": {"w": look, "g": look, "w#p1": look, "x": look}}
    assert scenelib.wled_looks(basic, devices) == {"w": {"fx": 9, "speed": 200}}  # only whole WLED lights
    assert scenelib.wled_looks({"mode": "basic", "lights": {"w": {"effect": "chase", "params": {}}}}, devices) == {}
    advanced = {"mode": "advanced", "loop": 10, "tracks": [
        {"device": "w", "clips": [{"effect": "wled", "start": 0, "end": 10, "fx": 3}]},
        {"device": "g", "clips": [{"effect": "wled", "start": 0, "end": 10, "fx": 3}]}]}
    assert scenelib.wled_looks(advanced, devices) == {"w": {"effect": "wled", "start": 0, "end": 10, "fx": 3}}


def test_parts_of_a_split_wled_hand_their_segments_to_wled_s_own_effects():
    devices = {"w": {"id": "w", "kind": "wled", "parts": [{"id": "w0"}, {"id": "w2"}, {"id": "p3"}]}}
    look = {"effect": "wled", "params": {"fx": 9}}
    basic = {"mode": "basic", "lights": {"w#w2": look, "w#p3": look, "w#w5": look, "w#w0": {"effect": "chase", "params": {}}}}
    assert scenelib.wled_looks(basic, devices) == {"w#w2": {"fx": 9}}  # only parts read from WLED's segments
    assert scenelib.wled_device("w#w2", devices)["segment"] == 2
    advanced = {"mode": "advanced", "loop": 10, "tracks": [{"device": "w#w0", "clips": [{"effect": "wled", "start": 0, "end": 10}]}]}
    assert list(scenelib.wled_looks(advanced, devices)) == ["w#w0"]


async def test_a_part_of_a_split_wled_on_its_own_effect(runner, monkeypatch):
    sent = []

    async def fake_set_state(ip, state, timeout=4.0):
        sent.append((ip, state))

    monkeypatch.setattr(runner_mod.wled, "set_state", fake_set_state)
    runner.storage.save_devices([
        {"id": "a", "ip": "127.0.0.1", "segments": 1},
        {"id": "w", "kind": "wled", "ip": "127.0.0.2", "segments": 4,
         "parts": [{"id": "w0", "name": "Left", "from": 1, "to": 2}, {"id": "w1", "name": "Right", "from": 3, "to": 4}]}])
    runner.storage.save_scene("mix", {"name": "Mix", "mode": "basic", "lights": {
        "a": {"effect": "solid", "params": {}}, "w#w1": {"effect": "wled", "params": {"fx": 9}},
        "w#w0": {"effect": "solid", "params": {}}}})
    runner.storage.save_scene_baked("mix", baked.encode(40, [{"device": "a", "segments": 1}, {"device": "w", "segments": 4}],
                                                        [b"\xff" * 15] * 4))
    await runner.play_scene("mix")
    assert await _until(lambda: sent)
    assert set(runner.player.devices) == {"a"}  # nothing to that WLED: frames would end the effect
    assert len(sent) == 1 and sent[0][0] == "127.0.0.2"
    assert sent[0][1]["seg"]["id"] == 1 and sent[0][1]["seg"]["fx"] == 9


async def test_a_split_wled_on_its_own_effect_plays_it_on_every_segment(runner, monkeypatch):
    sent = []

    async def fake_set_state(ip, state, timeout=4.0):
        sent.append((ip, state))

    monkeypatch.setattr(runner_mod.wled, "set_state", fake_set_state)
    runner.storage.save_devices([{"id": "w", "kind": "wled", "ip": "127.0.0.2", "segments": 4,
                                  "parts": [{"id": "w0", "name": "Left", "from": 1, "to": 2},
                                            {"id": "w1", "name": "Right", "from": 3, "to": 4}]}])
    runner.storage.save_scene("all", {"name": "All", "mode": "basic", "lights": {"w": {"effect": "wled", "params": {"fx": 9}}}})
    runner.storage.save_scene_baked("all", baked.encode(40, [{"device": "w", "segments": 4}], [b"\xff" * 12] * 4))
    await runner.play_scene("all")
    assert await _until(lambda: sent)
    assert [s["id"] for s in sent[0][1]["seg"]] == [0, 1]


async def test_a_wled_on_its_own_effect_gets_its_state_and_no_frames(runner, monkeypatch):
    sent = []

    async def fake_set_state(ip, state, timeout=4.0):
        sent.append((ip, state))

    monkeypatch.setattr(runner_mod.wled, "set_state", fake_set_state)
    runner.storage.save_devices([{"id": "a", "ip": "127.0.0.1", "segments": 1},
                                 {"id": "w", "kind": "wled", "ip": "127.0.0.2", "segments": 1},
                                 {"id": "p", "kind": "wled", "ip": "", "segments": 1}])
    look = {"effect": "wled", "params": {"fx": 9, "speed": 200, "intensity": 50, "palette": 6, "color": "#ff0000"}}
    runner.storage.save_scene("mix", {"name": "Mix", "mode": "basic", "lights": {
        "a": {"effect": "solid", "params": {}}, "w": look, "p": look}})
    runner.storage.save_scene_baked("mix", baked.encode(40, [{"device": "a", "segments": 1}, {"device": "w", "segments": 1}],
                                                        [b"\xff\x00\x00\x00\xff\x00"] * 4))
    await runner.play_scene("mix")
    assert await _until(lambda: sent)
    assert set(runner.player.devices) == {"a"}  # no frames to the WLED (or the planned one)
    ip, state = sent[0]
    assert ip == "127.0.0.2" and len(sent) == 1
    assert state["on"] is True and state["seg"]["fx"] == 9 and state["seg"]["sx"] == 200 and state["seg"]["pal"] == 6


async def test_a_wled_segment_light_on_its_own_effect_hands_over_its_whole_wled(runner, monkeypatch):
    sent = []

    async def fake_set_state(ip, state, timeout=4.0):
        sent.append((ip, state))

    monkeypatch.setattr(runner_mod.wled, "set_state", fake_set_state)
    # Three strings on one WLED, each one of its segments, plus another WLED.
    runner.storage.save_devices([
        {"id": "pillars", "kind": "wled", "ip": "127.0.0.2", "segments": 2, "segment": 0},
        {"id": "left", "kind": "wled", "ip": "127.0.0.2", "segments": 2, "first": 3, "segment": 1},
        {"id": "right", "kind": "wled", "ip": "127.0.0.2", "segments": 2, "first": 5, "segment": 2},
        {"id": "eaves", "kind": "wled", "ip": "127.0.0.3", "segments": 2}])
    runner.storage.save_scene("mix", {"name": "Mix", "mode": "basic", "lights": {
        "pillars": {"effect": "wled", "params": {"fx": 9}}, "left": {"effect": "solid", "params": {}},
        "right": {"effect": "solid", "params": {}}, "eaves": {"effect": "solid", "params": {}}}})
    tracks = [{"device": k, "segments": 2} for k in ("pillars", "left", "right", "eaves")]
    runner.storage.save_scene_baked("mix", baked.encode(40, tracks, [b"\xff\x00\x00" * 8] * 4))
    await runner.play_scene("mix")
    assert await _until(lambda: sent)
    # Frames to the other strings would put the WLED back into realtime and end the effect.
    assert set(runner.player.devices) == {"eaves"}
    ip, state = sent[0]
    assert ip == "127.0.0.2" and state["seg"]["id"] == 0 and state["seg"]["fx"] == 9


async def test_a_react_scene_s_wled_on_its_own_effect_gets_no_frames_from_it(runner):
    runner.storage.save_devices([{"id": "a", "ip": "127.0.0.1", "segments": 1},
                                 {"id": "w", "kind": "wled", "ip": "127.0.0.2", "segments": 1}])
    runner.storage.save_scene("bass", {"name": "Bass", "mode": "basic", "lights": {
        "a": {"effect": "solid", "params": {}}, "w": {"effect": "wled", "params": {"fx": 2}}}})
    runner.storage.save_scene_baked("bass", baked.encode(40, [{"device": "a", "segments": 1}, {"device": "w", "segments": 1}],
                                                         [b"\x00\x00\xff\x00\x00\xff"] * 4))

    class Live:
        def now(self, source):
            return {}

    runner.live = Live()
    runner._react({"react": {"on": True, "bass": "bass", "treble": ""}})
    assert [t.device for t in runner.player.variants["bass"].tracks] == ["a"]


async def test_a_scene_with_live_effects_hands_the_player_its_live_set(runner):
    class Live:
        def now(self, source):
            return {"loudness": 80, "bass": 60, "mid": 0, "treble": 0}

    _scene(runner.storage)
    live = baked.encode(1, [{"device": "a", "segments": 1, "kind": "level", "follows": "bass"}], [bytes(3)] * 21)
    runner.storage.save_scene_live("glow", live)
    await runner.play_scene("glow")
    assert runner.player.live is None  # nothing listening for live music: the idle glow plays
    runner.live = Live()
    await runner.play_scene("glow")
    assert runner.player.live is not None and set(runner.player.live_tracks) == {"a"}
    assert runner.player.live_step() is not None  # music heard: levels to show
    runner.storage.save_scene_live("glow", None)
    await runner.play_scene("glow")
    assert runner.player.live is None


async def test_a_playlist_carries_on_after_an_error_in_a_block_and_says_so(runner, monkeypatch, caplog):
    runner.storage.save_scene("s1", {"name": "S1", "mode": "basic", "lights": {"a": {"effect": "solid", "params": {}}}})
    runner.storage.save_scene_baked("s1", baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 40))
    real, calls = baked.Baked.track_frame, {"n": 0}

    def once_broken(self, t, i):
        calls["n"] += 1
        if calls["n"] == 3:
            raise ValueError("boom")
        return real(self, t, i)

    monkeypatch.setattr(baked.Baked, "track_frame", once_broken)
    await runner.play_playlist({"id": "p", "name": "P", "gap": 0, "items": [
        {"type": "scene", "id": "b1", "scene": "s1", "seconds": 0.5},
        {"type": "scene", "id": "b2", "scene": "s1", "seconds": 0.5}]})
    assert await _until(lambda: calls["n"] > 3)
    assert await _until(lambda: runner.player.playing)
    assert not runner._playlist.done()
    assert "boom" in caplog.text
